import { validateScenario } from './validation';
import {
  CAR_CAPACITY,
  type Direction,
  type DoorPhase,
  type ElevatorRuntime,
  type RequestRuntime,
  type Scenario,
  type SimEvent,
  type SimulationResult,
  type TickSnapshot,
  type ValidatedScenario
} from './types';

interface RuntimeState {
  cars: ElevatorRuntime[];
  requests: RequestRuntime[];
  events: SimEvent[];
}

interface StepContext {
  events: SimEvent[];
  requestMap: Map<string, RequestRuntime>;
  tick: number;
  dryCandidateId?: string;
}

const MAX_SIMULATION_TICKS = 200_000;

function directionText(direction: Direction): string {
  if (direction > 0) return '上行至';
  if (direction < 0) return '下行至';
  return '停在';
}

function initialCar(id: number): ElevatorRuntime {
  return {
    id,
    floor: 1,
    targetFloor: null,
    direction: 0,
    phase: 'closed',
    phaseElapsed: 0,
    onboard: [],
    waiting: [],
    attempted: [],
    committedPickups: [],
    movementTickStarted: null,
    idleLogged: false,
    outOfService: false,
    outageStartedTick: null
  };
}

function initialRequest(scenario: ValidatedScenario): RequestRuntime[] {
  return scenario.requests.map((request) => ({
    id: request.id,
    arrivalTick: request.arrivalTick,
    origin: request.origin,
    destination: request.destination,
    people: request.people,
    remaining: request.people,
    boarded: 0,
    completed: 0,
    cancelled: 0,
    cancelTick: request.cancelTick,
    status: 'pending',
    carId: null,
    assignedTick: null,
    onboardCarIds: []
  }));
}

function carLoad(car: ElevatorRuntime): number {
  return car.onboard.reduce((sum, entry) => sum + entry.remaining, 0);
}

function syncCommittedPickups(car: ElevatorRuntime): void {
  car.committedPickups = car.waiting.map((entry) => entry.requestId);
}

function activeWaiting(car: ElevatorRuntime, requestMap: Map<string, RequestRuntime>) {
  return car.waiting
    .map((entry) => ({ entry, request: requestMap.get(entry.requestId)! }))
    .filter(({ request }) => request.status === 'waiting' || request.status === 'riding');
}

function waitingAtFloor(
  car: ElevatorRuntime,
  requestMap: Map<string, RequestRuntime>,
  floor: number
) {
  return activeWaiting(car, requestMap)
    .filter(({ entry, request }) => request.origin === floor && entry.remaining > 0)
    .sort((a, b) => a.request.id.localeCompare(b.request.id, 'zh-CN'));
}

function alightingAtFloor(
  car: ElevatorRuntime,
  requestMap: Map<string, RequestRuntime>,
  floor: number
) {
  // Each onboard batch alights at the destination locked in when it boarded; a later
  // destination change on the request never re-routes people already inside a car.
  return car.onboard
    .map((entry) => ({ entry, request: requestMap.get(entry.requestId)! }))
    .filter(({ entry }) => entry.destination === floor)
    .sort((a, b) => a.request.id.localeCompare(b.request.id, 'zh-CN'));
}

function uniqueFloors(floors: number[]): number[] {
  return [...new Set(floors)].sort((a, b) => a - b);
}

function pickupFloors(car: ElevatorRuntime, requestMap: Map<string, RequestRuntime>): number[] {
  return uniqueFloors(
    activeWaiting(car, requestMap).map(({ request }) => request.origin)
  );
}

function dropFloors(car: ElevatorRuntime): number[] {
  return uniqueFloors(car.onboard.map((entry) => entry.destination));
}

function emit(events: SimEvent[], event: SimEvent): void {
  events.push(event);
}

function doorReason(
  car: ElevatorRuntime,
  requestMap: Map<string, RequestRuntime>
): {
  reason: string;
  dropIds: string[];
  pickupIds: string[];
  dropFloors: number[];
  pickupFloors: number[];
} {
  const drops = alightingAtFloor(car, requestMap, car.floor);
  const pickups = waitingAtFloor(car, requestMap, car.floor)
    .filter(({ request }) => !car.attempted.includes(request.id));
  const dropIds = drops.map(({ request }) => request.id);
  const pickupIds = pickups.map(({ request }) => request.id);
  const parts: string[] = [];
  if (dropIds.length) parts.push(`下客 ${dropIds.join('、')}`);
  if (pickupIds.length) parts.push(`接客 ${pickupIds.join('、')}`);
  return {
    reason: `${parts.join('；') || '已承诺停靠'}，载重 ${carLoad(car)}/${CAR_CAPACITY}`,
    dropIds,
    pickupIds,
    dropFloors: uniqueFloors(drops.map(({ request }) => request.destination)),
    pickupFloors: uniqueFloors(pickups.map(({ request }) => request.origin))
  };
}

function startOpening(
  car: ElevatorRuntime,
  context: StepContext
): void {
  const reason = doorReason(car, context.requestMap);
  car.phase = 'opening';
  car.phaseElapsed = 0;
  car.targetFloor = null;
  car.direction = 0;
  emit(context.events, {
    tick: context.tick,
    carId: car.id,
    type: 'door_opening',
    floor: car.floor,
    message: `#${car.id} 在 ${car.floor} 层开始开门：${reason.reason}`,
    reason: reason.reason,
    committedPickups: reason.pickupFloors,
    dropOffs: reason.dropFloors,
    peopleOnboard: carLoad(car)
  });
}

/**
 * Boarding and alighting happen while the door is physically open.
 * Returns the dry-run candidate ID only on a tick where it has its first pickup chance.
 */
function transferPassengers(
  car: ElevatorRuntime,
  context: StepContext
): string | null {
  let candidatePickupTick: string | null = null;

  for (const { entry, request } of alightingAtFloor(car, context.requestMap, car.floor)) {
    const people = entry.remaining;
    // Remove only this batch; another batch of the same request may keep riding to a
    // different destination that was locked in when that batch boarded.
    car.onboard = car.onboard.filter((item) => item !== entry);
    if (!car.onboard.some((item) => item.requestId === request.id)) {
      request.onboardCarIds = request.onboardCarIds.filter((id) => id !== car.id);
    }
    request.completed += people;
    const hasPassengersOnAnyCar = request.onboardCarIds.length > 0;
    if (hasPassengersOnAnyCar || request.remaining > 0) {
      request.status = hasPassengersOnAnyCar ? 'riding' : 'waiting';
    } else {
      request.status = 'completed';
      request.carId = null;
    }
    emit(context.events, {
      tick: context.tick,
      carId: car.id,
      requestId: request.id,
      type: 'alight',
      floor: car.floor,
      people,
      destination: entry.destination,
      peopleOnboard: carLoad(car),
      message: `#${car.id}：${request.id} 一批 ${people} 人在 ${car.floor} 层下车（上车时锁定目的层 ${entry.destination}）；该请求累计完成 ${request.completed}/${request.people}。`
    });
  }

  const candidates = waitingAtFloor(car, context.requestMap, car.floor);
  for (const item of candidates) {
    const { entry, request } = item;
    if (car.attempted.includes(request.id)) continue;

    const space = CAR_CAPACITY - carLoad(car);
    const boarding = Math.max(0, Math.min(space, entry.remaining));
    if (context.dryCandidateId === request.id && boarding > 0) {
      candidatePickupTick = request.id;
    }

    if (boarding > 0) {
      entry.remaining -= boarding;
      request.remaining -= boarding;
      request.boarded += boarding;
      request.status = 'riding';
      // The destination is locked into this batch at boarding time. A destination
      // change after this tick only applies to people who have not boarded yet.
      car.onboard.push({ requestId: request.id, remaining: boarding, destination: request.destination });
      if (!request.onboardCarIds.includes(car.id)) request.onboardCarIds.push(car.id);
      if (entry.remaining === 0) {
        car.waiting = car.waiting.filter((waiting) => waiting.requestId !== request.id);
        car.attempted = car.attempted.filter((id) => id !== request.id);
      } else {
        car.attempted.push(request.id);
      }
      syncCommittedPickups(car);
      emit(context.events, {
        tick: context.tick,
        carId: car.id,
        requestId: request.id,
        type: 'board',
        floor: car.floor,
        people: boarding,
        remaining: request.remaining,
        destination: request.destination,
        peopleOnboard: carLoad(car),
        reason: entry.remaining > 0 ? '轿厢容量不足，余客继续等待同一台电梯' : '该批乘客全部上车',
        message:
          entry.remaining > 0
            ? `#${car.id}：${request.id} 在 ${car.floor} 层仅上车 ${boarding} 人（目的层 ${request.destination} 已锁定），剩余 ${request.remaining} 人继续等待。`
            : `#${car.id}：${request.id} 在 ${car.floor} 层上车 ${boarding} 人（目的层 ${request.destination} 已锁定），全部已接走。`
      });
    } else {
      if (!car.attempted.includes(request.id)) car.attempted.push(request.id);
      emit(context.events, {
        tick: context.tick,
        carId: car.id,
        requestId: request.id,
        type: 'board',
        floor: car.floor,
        people: 0,
        remaining: request.remaining,
        peopleOnboard: carLoad(car),
        reason: `轿厢满载（${carLoad(car)}/${CAR_CAPACITY}），所有 ${request.remaining} 人继续等待`,
        message: `#${car.id}：${request.id} 在 ${car.floor} 层无人上车，轿厢满载，剩余 ${request.remaining} 人等待返回后再接。`
      });
    }
  }

  return candidatePickupTick;
}

function chooseTargetFloor(car: ElevatorRuntime, requestMap: Map<string, RequestRuntime>): number | null {
  // Onboard passengers always have routing priority. Waiting pickups are considered only after
  // the car is empty; otherwise a full car returning for a residual pickup could fight against
  // onboard destination direction.
  const onboardDestinations = uniqueFloors(
    car.onboard.map((entry) => entry.destination)
  ).filter((floor) => floor !== car.floor);
  const targetFloors = onboardDestinations.length > 0
    ? onboardDestinations
    : uniqueFloors([
        ...pickupFloors(car, requestMap),
        ...dropFloors(car)
      ]).filter((floor) => floor !== car.floor);

  if (targetFloors.length === 0) return null;

  if (car.direction === 0) {
    const distances = targetFloors.map((floor) => ({
      floor,
      distance: Math.abs(floor - car.floor)
    }));
    const minimum = Math.min(...distances.map((item) => item.distance));
    // Deterministic tie: prefer the upper floor when two commitments are equally near.
    return distances
      .filter((item) => item.distance === minimum)
      .map((item) => item.floor)
      .sort((a, b) => b - a)[0];
  }

  if (car.direction > 0) {
    const ahead = targetFloors.filter((floor) => floor > car.floor);
    if (ahead.length) return Math.min(...ahead);
    return Math.max(...targetFloors);
  }

  const behind = targetFloors.filter((floor) => floor < car.floor);
  if (behind.length) return Math.max(...behind);
  return Math.min(...targetFloors);
}

function startMoving(
  car: ElevatorRuntime,
  context: StepContext,
  travelTicks: number
): void {
  const target = chooseTargetFloor(car, context.requestMap);
  if (target === null) {
    car.phase = 'closed';
    car.phaseElapsed = 0;
    car.targetFloor = null;
    car.direction = 0;
    if (!car.idleLogged) {
      car.idleLogged = true;
      emit(context.events, {
        tick: context.tick,
        carId: car.id,
        type: 'idle',
        floor: car.floor,
        peopleOnboard: 0,
        message: `#${car.id} 在 ${car.floor} 层关门待机；当前没有已承诺停靠点。`
      });
    }
    return;
  }

  const nextFloor = target > car.floor ? car.floor + 1 : car.floor - 1;
  const direction: Direction = target > car.floor ? 1 : -1;
  car.direction = direction;
  car.targetFloor = nextFloor;
  car.phase = 'moving';
  car.phaseElapsed = 0;
  car.movementTickStarted = context.tick;
  car.idleLogged = false;
  car.attempted = [];

  const load = carLoad(car);
  const pickups = pickupFloors(car, context.requestMap);
  const drops = dropFloors(car);
  const reason =
    `已承诺接客楼层 [${pickups.join(', ') || '无'}]，下客楼层 [${drops.join(', ') || '无'}]，` +
    `SCAN 方向${direction > 0 ? '向上' : '向下'}先到 ${target} 层；本层移动至 ${nextFloor} 层。`;
  emit(context.events, {
    tick: context.tick,
    carId: car.id,
    type: 'move_start',
    fromFloor: car.floor,
    toFloor: nextFloor,
    floor: car.floor,
    reason,
    committedPickups: pickups,
    dropOffs: drops,
    peopleOnboard: load,
    message: `#${car.id} ${load === 0 ? '空驶' : `载客 ${load} 人`}，从 ${car.floor} 层${directionText(direction)} ${nextFloor} 层。${reason}`
  });

  // travelTicks is consumed by the moving phase; the actual floor number changes on arrival.
  void travelTicks;
}

function actFromFloor(
  car: ElevatorRuntime,
  context: StepContext,
  scenario: ValidatedScenario
): void {
  const drops = alightingAtFloor(car, context.requestMap, car.floor);
  const pickups = waitingAtFloor(car, context.requestMap, car.floor)
    .filter(({ request }) => !car.attempted.includes(request.id));

  if (drops.length > 0 || pickups.length > 0) {
    startOpening(car, context);
  } else {
    startMoving(car, context, scenario.travelTicks);
  }
}

function stepCar(
  car: ElevatorRuntime,
  context: StepContext,
  scenario: ValidatedScenario
): string | null {
  let dryResult: string | null = null;

  if (car.outOfService) return dryResult;

  if (car.phase === 'opening') {
    car.phaseElapsed += 1;
    if (car.phaseElapsed >= scenario.doorOpenTicks) {
      car.phaseElapsed = 0;
      const loadBefore = carLoad(car);
      dryResult = transferPassengers(car, context);
      emit(context.events, {
        tick: context.tick,
        carId: car.id,
        type: 'door_open',
        floor: car.floor,
        reason: `开门耗时 ${scenario.doorOpenTicks} tick 已完成，门开瞬间上下客，随后进入关门；门未关不能行驶`,
        peopleOnboard: carLoad(car),
        message: `#${car.id} 在 ${car.floor} 层门全开，执行上下客（载重 ${loadBefore} → ${carLoad(car)}）。`
      });
      car.phase = 'closing';
      emit(context.events, {
        tick: context.tick,
        carId: car.id,
        type: 'door_closing',
        floor: car.floor,
        reason: `上下客完成后立即关门，关门耗时 ${scenario.doorCloseTicks} tick`,
        peopleOnboard: carLoad(car),
        message: `#${car.id} 在 ${car.floor} 层开始关门，关门耗时 ${scenario.doorCloseTicks} tick。`
      });
    }
    return dryResult;
  }

  if (car.phase === 'closing') {
    car.phaseElapsed += 1;
    if (car.phaseElapsed >= scenario.doorCloseTicks) {
      car.phase = 'closed';
      car.phaseElapsed = 0;
      emit(context.events, {
        tick: context.tick,
        carId: car.id,
        type: 'door_closed',
        floor: car.floor,
        peopleOnboard: carLoad(car),
        message: `#${car.id} 在 ${car.floor} 层门已关闭；只有关门后才能行驶。`
      });
      actFromFloor(car, context, scenario);
    }
    return dryResult;
  }

  if (car.phase === 'moving') {
    car.phaseElapsed += 1;
    if (car.phaseElapsed >= scenario.travelTicks) {
      const from = car.floor;
      car.floor = car.targetFloor ?? car.floor;
      car.phase = 'closed';
      car.phaseElapsed = 0;
      car.targetFloor = null;
      car.movementTickStarted = null;
      const willStop =
        alightingAtFloor(car, context.requestMap, car.floor).length > 0 ||
        waitingAtFloor(car, context.requestMap, car.floor).some(
          ({ request }) => !car.attempted.includes(request.id)
        );
      emit(context.events, {
        tick: context.tick,
        carId: car.id,
        type: 'move_arrive',
        fromFloor: from,
        toFloor: car.floor,
        floor: car.floor,
        reason: willStop ? '本层存在下客或未尝试过的承诺接客点' : '本层无承诺服务，将继续 SCAN 行驶',
        peopleOnboard: carLoad(car),
        message: `#${car.id} 用时 ${scenario.travelTicks} tick 从 ${from} 层到达 ${car.floor} 层；${willStop ? '停靠开门' : '继续下一停靠点'}。`
      });
      actFromFloor(car, context, scenario);
    }
    return null;
  }

  actFromFloor(car, context, scenario);
  return null;
}

function earliestPickupEta(
  car: ElevatorRuntime,
  request: RequestRuntime,
  requestMap: Map<string, RequestRuntime>,
  scenario: ValidatedScenario,
  now: number
): number {
  const dryCar = structuredClone(car);
  const dryRequests = structuredClone([...requestMap.values()]);
  const dryMap = new Map(dryRequests.map((item) => [item.id, item]));
  const candidate = structuredClone(request);
  candidate.status = 'waiting';
  candidate.carId = dryCar.id;
  candidate.assignedTick = now;
  dryMap.set(candidate.id, candidate);
  dryCar.waiting.push({ requestId: candidate.id, remaining: candidate.remaining });
  syncCommittedPickups(dryCar);

  // Dispatch is performed before the current-tick transition, so the dry run starts at `now`
  // rather than one tick later. A car whose opening animation ends on this tick can board at once.
  if (
    dryCar.floor === request.origin &&
    dryCar.phase === 'opening' &&
    dryCar.phaseElapsed + 1 >= scenario.doorOpenTicks
  ) {
    return now;
  }

  for (let futureTick = now; futureTick <= now + MAX_SIMULATION_TICKS; futureTick++) {
    const events: SimEvent[] = [];
    const context: StepContext = {
      events,
      requestMap: dryMap,
      tick: futureTick,
      dryCandidateId: candidate.id
    };
    const hadCandidate = dryCar.waiting.some((entry) => entry.requestId === candidate.id);
    const result = stepCar(dryCar, context, scenario);
    if (result === candidate.id) return futureTick;
    // It may have fully or partially boarded; either way the first contact is the pickup ETA.
    if (hadCandidate && !dryCar.waiting.some((entry) => entry.requestId === candidate.id)) {
      return futureTick;
    }
    if (
      dryCar.onboard.some((entry) => entry.requestId === candidate.id) &&
      dryCar.floor === request.origin
    ) {
      return futureTick;
    }
  }

  throw new Error(`无法计算请求 ${request.id} 对电梯 #${car.id} 的最早接客时刻。`);
}

function assignRequest(
  state: RuntimeState,
  request: RequestRuntime,
  scenario: ValidatedScenario,
  tick: number
): void {
  const requestMap = new Map(state.requests.map((item) => [item.id, item]));
  const availableCars = state.cars.filter((car) => !car.outOfService);
  if (availableCars.length === 0) {
    emit(state.events, {
      tick,
      requestId: request.id,
      type: 'dispatch_deferred',
      floor: request.origin,
      people: request.remaining,
      reason: '当前没有可用电梯；未上车乘客继续等待，不会取消',
      message: `请求 ${request.id} 暂时无可用电梯，${request.remaining} 人继续等待；恢复后再派车。`
    });
    return;
  }

  const candidates = availableCars
    .map((car) => ({
      carId: car.id,
      eta: earliestPickupEta(car, request, requestMap, scenario, tick),
      floor: car.floor,
      phase: car.phase,
      load: carLoad(car)
    }));

  const selected = [...candidates].sort((a, b) => a.eta - b.eta || a.carId - b.carId)[0];
  const car = state.cars.find((item) => item.id === selected.carId)!;
  request.carId = car.id;
  request.assignedTick = tick;
  car.waiting.push({ requestId: request.id, remaining: request.remaining });
  car.idleLogged = false;
  syncCommittedPickups(car);

  emit(state.events, {
    tick,
    carId: car.id,
    requestId: request.id,
    type: 'dispatch',
    eta: selected.eta,
    candidates,
    floor: request.origin,
    reason:
      `按已承诺停靠点分别推演最早开门接客时刻；最小 ETA=${selected.eta}，` +
      `ETA 相同则选择电梯 ID 最小者。候选：${candidates
        .map((candidate) => `#${candidate.carId}@${candidate.floor}层/${candidate.phase}/ETA${candidate.eta}`)
        .join('，')}`,
    message: `请求 ${request.id}（${request.origin}→${request.destination}，${request.remaining} 人）派给 #${car.id}；最早可接客 tick=${selected.eta}。`
  });
}

function cancelUnboarded(state: RuntimeState, request: RequestRuntime, tick: number): void {
  if (request.status === 'completed') return;

  if (request.status === 'riding' && request.remaining === 0) {
    emit(state.events, {
      tick,
      requestId: request.id,
      carId: request.carId ?? undefined,
      type: 'cancel_rejected',
      people: 0,
      peopleOnboard: request.boarded - request.completed,
      reason: '乘客已经上车，不可取消',
      message: `请求 ${request.id} 的取消被拒绝：${request.boarded} 名已上车乘客不可取消。`
    });
    return;
  }

  const cancelledPeople = request.remaining;
  if (
    cancelledPeople <= 0 ||
    (request.status !== 'pending' && request.status !== 'waiting' && request.status !== 'riding')
  ) {
    return;
  }

  const carId = request.carId;
  if (carId !== null) {
    const car = state.cars.find((item) => item.id === carId);
    if (car) {
      car.waiting = car.waiting.filter((entry) => entry.requestId !== request.id);
      car.attempted = car.attempted.filter((id) => id !== request.id);
      syncCommittedPickups(car);
    }
  }

  request.cancelled += cancelledPeople;
  request.remaining = 0;
  if (request.boarded > 0) {
    request.status = 'riding';
  } else {
    request.status = 'cancelled';
    request.carId = null;
  }

  emit(state.events, {
    tick,
    requestId: request.id,
    carId: carId ?? undefined,
    type: 'cancel',
    people: cancelledPeople,
    peopleOnboard: request.boarded - request.completed,
    reason: '仅取消尚未上车的乘客；已上车部分继续运送',
    message:
      request.boarded > 0
        ? `请求 ${request.id} 取消 ${cancelledPeople} 名未上车乘客；已上车 ${request.boarded - request.completed} 人继续乘坐。`
        : `请求 ${request.id} 取消 ${cancelledPeople} 名未上车乘客，请求从等待队列移除。`
  });
}

/**
 * Destination corrections take effect between cancellations and outage handling.
 * Only people who have not boarded yet (request.remaining) follow the new floor;
 * every onboard batch keeps the destination it locked in at boarding time, including
 * batches frozen inside an out-of-service car. Terminal requests never reopen.
 */
function applyDestinationChanges(
  state: RuntimeState,
  scenario: ValidatedScenario,
  tick: number
): void {
  for (const change of scenario.destinationChanges.filter((event) => event.tick === tick)) {
    const request = state.requests.find((item) => item.id === change.requestId);
    if (!request) continue; // validation guarantees the request exists

    const previous = request.destination;
    const onboardBatches = state.cars.flatMap((car) =>
      car.onboard
        .filter((entry) => entry.requestId === request.id)
        .map((entry) => ({ carId: car.id, people: entry.remaining, destination: entry.destination }))
    );
    const onboardPeople = onboardBatches.reduce((sum, batch) => sum + batch.people, 0);
    const batchText = onboardBatches.length
      ? onboardBatches.map((batch) => `#${batch.carId} 车 ${batch.people} 人→${batch.destination} 层`).join('、')
      : '无';
    const terminal = request.status === 'completed' || request.status === 'cancelled';
    const affected = terminal ? 0 : request.remaining;

    if (affected > 0) {
      request.destination = change.destination;
    }

    emit(state.events, {
      tick,
      requestId: request.id,
      type: 'destination_change',
      fromFloor: previous,
      toFloor: change.destination,
      people: affected,
      destination: change.destination,
      peopleOnboard: onboardPeople,
      reason:
        '目的地更正只适用于生效时刻仍未上车的人；已上车各批保留上车时锁定的目的层，终态不重新开放。',
      message:
        affected > 0
          ? `请求 ${request.id} 目的层 ${previous} → ${change.destination}：对尚未上车的 ${affected} 人生效；` +
            `已上车 ${onboardPeople} 人保留原约定（${batchText}）。`
          : `请求 ${request.id} 目的层更正 ${previous} → ${change.destination} 不影响任何在运乘客：` +
            (terminal
              ? `请求已终态（${request.status === 'completed' ? '完成' : '取消'}），不重新开放；`
              : '当前没有未上车乘客；') +
            `已上车 ${onboardPeople} 人保留原约定（${batchText}）。`
    });
  }
}

function phaseRemainingTicks(
  car: ElevatorRuntime,
  scenario: ValidatedScenario
): number | null {
  if (car.phase === 'moving') return Math.max(0, scenario.travelTicks - car.phaseElapsed);
  if (car.phase === 'opening') return Math.max(0, scenario.doorOpenTicks - car.phaseElapsed);
  if (car.phase === 'closing') return Math.max(0, scenario.doorCloseTicks - car.phaseElapsed);
  return null;
}

function applyOutageEvents(
  state: RuntimeState,
  scenario: ValidatedScenario,
  tick: number
): void {
  const events = scenario.outageEvents.filter((event) => event.tick === tick);

  for (const outage of events.filter((event) => event.type === 'outage')) {
    const car = state.cars[outage.carId];
    if (!car || car.outOfService) continue;

    car.outOfService = true;
    car.outageStartedTick = tick;
    const withdrawnPeople = car.waiting.reduce((sum, entry) => sum + entry.remaining, 0);
    emit(state.events, {
      tick,
      carId: car.id,
      type: 'outage',
      floor: car.floor,
      peopleOnboard: carLoad(car),
      withdrawnPeople,
      remainingTicks: phaseRemainingTicks(car, scenario) ?? undefined,
      reason:
        `冻结位置 ${car.floor} 层、门/行驶相位 ${car.phase} 及剩余耗时；` +
        `已上车 ${carLoad(car)} 人与目的层承诺保留，未上车 ${withdrawnPeople} 人撤回。`,
      message:
        `#${car.id} 在 tick ${tick} 停运，冻结在 ${car.floor} 层（${car.phase}）；` +
        `车内 ${carLoad(car)} 人保留，${withdrawnPeople} 名未上车乘客撤回并重新参与派车。`
    });

    for (const entry of [...car.waiting]) {
      const request = state.requests.find((item) => item.id === entry.requestId);
      if (!request) continue;
      const people = entry.remaining;
      request.assignedTick = null;
      // A single request may already have passengers on the frozen car while its surplus is
      // redispatched. The car ID tracks the active waiting commitment; onboard counts remain
      // explicit in every car snapshot.
      request.carId = null;
      const onboardCarIds = state.cars
        .filter((item) => item.onboard.some((onboard) => onboard.requestId === request.id))
        .map((item) => item.id);
      request.status = onboardCarIds.length === 0 ? 'waiting' : 'riding';
      emit(state.events, {
        tick,
        carId: car.id,
        requestId: request.id,
        type: 'commitment_withdrawn',
        floor: car.floor,
        people,
        remaining: request.remaining,
        peopleOnboard: carLoad(car),
        reason: '停运车只保留已上车乘客及其目的层；未上车承诺撤回，由其他可用车重新计算 ETA',
        message:
          `#${car.id} 停运：撤回请求 ${request.id} 的 ${people} 名未上车乘客承诺；` +
          (onboardCarIds.length === 0
            ? '当前没有可用承诺时乘客继续等待。'
            : `已上车部分仍由 ${onboardCarIds.map((id) => `#${id}`).join('、')} 运送。`)
      });
    }
    car.waiting = [];
    car.attempted = [];
    syncCommittedPickups(car);
  }

  for (const recovery of events.filter((event) => event.type === 'recovery')) {
    const car = state.cars[recovery.carId];
    if (!car || !car.outOfService) continue;

    car.outOfService = false;
    car.outageStartedTick = null;
    emit(state.events, {
      tick,
      carId: car.id,
      type: 'recovery',
      floor: car.floor,
      peopleOnboard: carLoad(car),
      remainingTicks: phaseRemainingTicks(car, scenario) ?? undefined,
      reason:
        `从冻结相位 ${car.phase} 继续，不补走停运期间路程；剩余 ${phaseRemainingTicks(car, scenario) ?? 0} tick 后才完成当前相位。`,
      message:
        `#${car.id} 在 tick ${tick} 恢复：仍位于 ${car.floor} 层，从冻结的 ${car.phase} 相位继续，` +
        `不补走停运期间路程，并重新参与派车。`
    });
  }
}

function uncommittedRequests(state: RuntimeState): RequestRuntime[] {
  const committedIds = new Set(state.cars.flatMap((car) => car.waiting.map((entry) => entry.requestId)));
  return state.requests.filter(
    (request) =>
      request.remaining > 0 &&
      !committedIds.has(request.id) &&
      (request.status === 'waiting' || request.status === 'riding')
  );
}

function makeSnapshot(
  state: RuntimeState,
  scenario: ValidatedScenario,
  tick: number,
  active: boolean
): TickSnapshot {
  const requestMap = new Map(state.requests.map((request) => [request.id, request]));
  const totalUnassignedWaiting = uncommittedRequests(state)
    .reduce((sum, request) => sum + request.remaining, 0);
  return {
    tick,
    active,
    cars: state.cars.map((car) => ({
      id: car.id,
      floor: car.floor,
      targetFloor: car.targetFloor,
      direction: car.direction,
      phase: car.phase,
      phaseElapsed: car.phaseElapsed,
      peopleOnboard: carLoad(car),
      capacity: CAR_CAPACITY,
      outOfService: car.outOfService,
      outageStartedTick: car.outageStartedTick,
      waiting: car.waiting.map((entry) => ({ ...entry })),
      onboard: car.onboard.map((entry) => ({ ...entry })),
      attempted: [...car.attempted],
      committedPickupFloors: pickupFloors(car, requestMap),
      committedDropFloors: dropFloors(car)
    })),
    requests: state.requests.map((request) => ({
      id: request.id,
      arrivalTick: request.arrivalTick,
      origin: request.origin,
      destination: request.destination,
      people: request.people,
      remaining: request.remaining,
      boarded: request.boarded,
      completed: request.completed,
      cancelled: request.cancelled,
      cancelTick: request.cancelTick,
      status: request.status,
      carId: request.carId,
      onboardCarIds: [...request.onboardCarIds]
    })),
    events: structuredClone(state.events),
    totalWaiting: state.requests
      .filter((request) => request.status === 'waiting' || request.status === 'riding')
      .reduce((sum, request) => sum + request.remaining, 0),
    totalUnassignedWaiting,
    totalRiding: state.requests
      .filter((request) => request.status === 'riding')
      .reduce((sum, request) => sum + Math.max(0, request.boarded - request.completed), 0),
    totalCompleted: state.requests.reduce((sum, request) => sum + request.completed, 0),
    totalCancelled: state.requests.reduce((sum, request) => sum + request.cancelled, 0)
  };
}

function isFinished(state: RuntimeState, scenario: ValidatedScenario, tick: number): boolean {
  const unfinishedRequest = state.requests.some(
    (request) => request.status === 'pending' || request.status === 'waiting' || request.status === 'riding'
  );
  if (unfinishedRequest) return false;
  return state.cars.every((car) => {
    if (!car.outOfService) {
      return car.phase === 'closed' && car.onboard.length === 0 && car.waiting.length === 0;
    }
    // A frozen car with retained riders has a pending destination. A car with a future recovery
    // must also keep participating in the timeline; a permanently parked empty car can end here.
    const willRecover = scenario.outageEvents.some(
      (event) => event.type === 'recovery' && event.carId === car.id && event.tick > tick
    );
    return car.onboard.length === 0 && car.waiting.length === 0 && !willRecover;
  });
}

function processTick(
  state: RuntimeState,
  scenario: ValidatedScenario,
  tick: number
): void {
  state.events = [];

  // Arrivals are visible at the beginning of the tick; an open car at that floor may serve them.
  for (const request of state.requests) {
    if (request.arrivalTick === tick && request.status === 'pending') {
      request.status = 'waiting';
      emit(state.events, {
        tick,
        requestId: request.id,
        type: 'arrival',
        floor: request.origin,
        people: request.people,
        reason: `${request.people} 人在 ${request.origin} 层登记，目的层 ${request.destination}`,
        message: `请求 ${request.id} 到达：${request.origin} → ${request.destination}，${request.people} 人。`
      });
    }
  }

  // Scheduled cancellation is applied before elevator motion/door transfer.
  for (const request of state.requests) {
    if (request.cancelTick === tick) {
      cancelUnboarded(state, request, tick);
    }
  }

  // Destination corrections take effect after cancellations but before outage handling,
  // so a same-tick cancel shrinks the affected crowd first and a frozen car's riders are
  // never re-routed. Boarding/alighting later this tick sees the corrected destination.
  applyDestinationChanges(state, scenario, tick);

  // Scheduled outages take effect after arrivals/cancellations but before this tick's dispatch
  // and car transitions. At one tick, all outages precede recoveries; cars are then ordered by ID.
  applyOutageEvents(state, scenario, tick);

  // Dispatch every not-yet-assigned live request before updating cars. This includes both new
  // arrivals and commitments withdrawn from a car that became unavailable. Same-tick ties use
  // request ID ascending. The selected car sees the new commitment in this tick's transition.
  const unassigned = uncommittedRequests(state)
    .sort((a, b) => a.arrivalTick - b.arrivalTick || a.id.localeCompare(b.id, 'zh-CN'));
  for (const request of unassigned) {
    assignRequest(state, request, scenario, tick);
  }

  const requestMap = new Map(state.requests.map((request) => [request.id, request]));
  for (const car of state.cars) {
    const context: StepContext = { events: state.events, requestMap, tick };
    stepCar(car, context, scenario);
  }
}

export function simulate(input: Scenario | ValidatedScenario): SimulationResult {
  const { value: scenario } = validateScenario(input as Partial<Scenario>);
  const state: RuntimeState = {
    cars: Array.from({ length: scenario.elevators }, (_, index) => initialCar(index)),
    requests: initialRequest(scenario),
    events: []
  };

  const ticks: TickSnapshot[] = [];

  let finalTick = 0;
  for (let tick = 0; tick <= MAX_SIMULATION_TICKS; tick++) {
    processTick(state, scenario, tick);
    const finished = isFinished(state, scenario, tick);
    finalTick = tick;
    ticks.push(makeSnapshot(state, scenario, tick, !finished));
    if (finished) break;
  }

  if (!isFinished(state, scenario, finalTick)) {
    throw new Error(`仿真在 ${MAX_SIMULATION_TICKS} tick 后仍未结束，请检查场景参数。`);
  }

  return {
    scenario,
    maxTick: finalTick,
    finalTick,
    ticks,
    events: ticks.flatMap((snapshot) => snapshot.events)
  };
}

export { CAR_CAPACITY, MAX_SIMULATION_TICKS };
