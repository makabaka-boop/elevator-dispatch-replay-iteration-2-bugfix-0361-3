import {
  CAR_CAPACITY,
  MAX_CARS,
  MAX_FLOORS,
  MAX_REQUESTS,
  MIN_CARS,
  MIN_FLOORS,
  type DestinationChange,
  type Scenario,
  type ScenarioOutageEvent,
  type ValidatedRequest,
  type ValidatedScenario
} from './types';

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Number.isFinite(value);
}

export function validateScenario(input: Partial<Scenario> | null | undefined): {
  ok: true;
  value: ValidatedScenario;
} {
  const errors: string[] = [];
  const floors = input?.floors;
  const elevators = input?.elevators;
  const travelTicks = input?.travelTicks;
  const doorOpenTicks = input?.doorOpenTicks;
  const doorCloseTicks = input?.doorCloseTicks;
  const requests = Array.isArray(input?.requests) ? input!.requests : null;
  const outageInput = input?.outageEvents;
  const hasOutageEvents = outageInput !== undefined && outageInput !== null;
  const outageEvents = Array.isArray(outageInput) ? outageInput : null;

  if (!isFiniteInteger(floors) || floors < MIN_FLOORS || floors > MAX_FLOORS) {
    errors.push(`楼层数必须是 ${MIN_FLOORS} 到 ${MAX_FLOORS} 的整数。`);
  }
  if (!isFiniteInteger(elevators) || elevators < MIN_CARS || elevators > MAX_CARS) {
    errors.push(`电梯台数必须是 ${MIN_CARS} 到 ${MAX_CARS} 的整数。`);
  }
  if (!isFiniteInteger(travelTicks) || travelTicks < 1) {
    errors.push('行驶一层耗时必须是正整数。');
  }
  if (!isFiniteInteger(doorOpenTicks) || doorOpenTicks < 1) {
    errors.push('开门耗时必须是正整数。');
  }
  if (!isFiniteInteger(doorCloseTicks) || doorCloseTicks < 1) {
    errors.push('关门耗时必须是正整数。');
  }
  if (!requests) {
    errors.push('requests 必须是数组。');
  } else if (requests.length > MAX_REQUESTS) {
    errors.push(`请求数量最多为 ${MAX_REQUESTS} 个，当前为 ${requests.length} 个。`);
  }

  const floorCount = isFiniteInteger(floors) ? floors : 0;
  const seenIds = new Set<string>();
  const validRequests: ValidatedRequest[] = [];

  if (requests) {
    requests.forEach((raw, index) => {
      const fallbackId = `R${String(index + 1).padStart(3, '0')}`;
      const id = raw && raw.id !== undefined && raw.id !== null && String(raw.id).trim() !== ''
        ? String(raw.id)
        : fallbackId;
      const prefix = `请求 ${id}`;

      if (seenIds.has(id)) {
        errors.push(`${prefix}: ID 重复。`);
      }
      seenIds.add(id);

      if (!raw || !isFiniteInteger(raw.arrivalTick) || raw.arrivalTick < 0) {
        errors.push(`${prefix}: 到达 tick 必须是非负整数。`);
      }
      if (!isFiniteInteger(raw?.origin) || raw.origin < 1 || raw.origin > floorCount) {
        errors.push(`${prefix}: 出发层必须在 1 到 ${floorCount || MAX_FLOORS} 之间。`);
      }
      if (!isFiniteInteger(raw?.destination) || raw.destination < 1 || raw.destination > floorCount) {
        errors.push(`${prefix}: 目的层必须在 1 到 ${floorCount || MAX_FLOORS} 之间。`);
      }
      if (raw && isFiniteInteger(raw.origin) && isFiniteInteger(raw.destination) && raw.origin === raw.destination) {
        errors.push(`${prefix}: 出发层和目的层不能相同。`);
      }
      if (!raw || !isFiniteInteger(raw.people) || raw.people < 1) {
        errors.push(`${prefix}: 人数必须是正整数。`);
      }

      let cancelTick: number | null = null;
      if (raw && raw.cancelTick !== undefined && raw.cancelTick !== null) {
        if (!isFiniteInteger(raw.cancelTick) || raw.cancelTick < 0) {
          errors.push(`${prefix}: 取消 tick 必须是非负整数或 null。`);
        } else {
          cancelTick = raw.cancelTick;
        }
      }

      if (
        raw && isFiniteInteger(raw.arrivalTick) && cancelTick !== null && cancelTick < raw.arrivalTick
      ) {
        errors.push(`${prefix}: 取消 tick 不能早于到达 tick。`);
      }

      if (raw && isFiniteInteger(raw.arrivalTick) && isFiniteInteger(raw.people)) {
        validRequests.push({
          ...raw,
          id,
          arrivalTick: raw.arrivalTick,
          origin: raw.origin,
          destination: raw.destination,
          people: raw.people,
          cancelTick
        } as ValidatedRequest);
      }
    });
  }

  const carCount = isFiniteInteger(elevators) ? elevators : 0;
  if (hasOutageEvents && !outageEvents) {
    errors.push('outageEvents 必须是数组。');
  }

  const validOutageEvents: ScenarioOutageEvent[] = [];
  if (outageEvents) {
    outageEvents.forEach((raw, index) => {
      const prefix = `停运事件 ${index + 1}`;
      if (!raw || typeof raw !== 'object') {
        errors.push(`${prefix}: 必须是包含 tick、carId、type 的对象。`);
        return;
      }

      const tickValid = isFiniteInteger(raw.tick) && raw.tick >= 0;
      const carValid = isFiniteInteger(raw.carId) && raw.carId >= 0 &&
        (carCount === 0 || raw.carId < carCount);
      const typeValid = raw.type === 'outage' || raw.type === 'recovery';

      if (!tickValid) errors.push(`${prefix}: tick 必须是非负整数。`);
      if (!carValid) {
        errors.push(
          carCount > 0
            ? `${prefix}: carId 必须在 0 到 ${carCount - 1} 之间。`
            : `${prefix}: carId 必须是非负整数且不能超过电梯编号范围。`
        );
      }
      if (!typeValid) errors.push(`${prefix}: type 必须是 outage 或 recovery。`);

      if (tickValid && carValid && typeValid) {
        validOutageEvents.push({ tick: raw.tick, carId: raw.carId, type: raw.type });
      }
    });
  }

  if (carCount > 0) {
    const byCar = new Map<number, ScenarioOutageEvent[]>();
    validOutageEvents
      .slice()
      .sort((a, b) => a.tick - b.tick || a.carId - b.carId ||
        (a.type === b.type ? 0 : a.type === 'outage' ? -1 : 1))
      .forEach((event) => {
        const list = byCar.get(event.carId) ?? [];
        list.push(event);
        byCar.set(event.carId, list);
      });

    byCar.forEach((events, carId) => {
      let outOfService = false;
      for (const event of events) {
        if (event.type === 'outage' && outOfService) {
          errors.push(`电梯 #${carId} 在 tick ${event.tick} 已处于停运状态，不能重复停运。`);
        }
        if (event.type === 'recovery' && !outOfService) {
          errors.push(`电梯 #${carId} 在 tick ${event.tick} 未处于停运状态，不能恢复。`);
        }
        outOfService = event.type === 'outage';
      }
      if (outOfService) {
        errors.push(`电梯 #${carId} 的最后一次停运必须有对应的恢复事件。`);
      }
    });
  }

  const destinationChangeInput = input?.destinationChanges;
  const hasDestinationChanges = destinationChangeInput !== undefined && destinationChangeInput !== null;
  const destinationChangeList = Array.isArray(destinationChangeInput) ? destinationChangeInput : null;
  if (hasDestinationChanges && !destinationChangeList) {
    errors.push('destinationChanges 必须是数组。');
  }

  const validDestinationChanges: DestinationChange[] = [];
  destinationChangeList?.forEach((raw, index) => {
    const prefix = `目的地更正 ${index + 1}`;
    if (!raw || typeof raw !== 'object') {
      errors.push(`${prefix}: 必须是包含 tick、requestId、destination 的对象。`);
      return;
    }
    const request = validRequests.find((item) => item.id === raw.requestId);
    const tickValid = isFiniteInteger(raw.tick) && raw.tick >= 0;
    const destinationValid =
      isFiniteInteger(raw.destination) && raw.destination >= 1 && raw.destination <= floorCount;

    if (!request) errors.push(`${prefix}: 引用的请求 ${String(raw.requestId)} 不存在。`);
    if (!tickValid) errors.push(`${prefix}: tick 必须是非负整数。`);
    if (!destinationValid) {
      errors.push(`${prefix}: 目的层必须在 1 到 ${floorCount || MAX_FLOORS} 之间。`);
    }
    if (request && tickValid && raw.tick < request.arrivalTick) {
      errors.push(`${prefix}: tick 不能早于请求 ${request.id} 的到达 tick。`);
    }
    if (request && destinationValid && raw.destination === request.origin) {
      errors.push(`${prefix}: 目的层不能与请求 ${request.id} 的出发层相同。`);
    }

    if (request && tickValid && destinationValid && raw.tick >= request.arrivalTick &&
        raw.destination !== request.origin) {
      validDestinationChanges.push({
        tick: raw.tick,
        requestId: request.id,
        destination: raw.destination
      });
    }
  });
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  const scenario: ValidatedScenario = {
    // Stable sort: same-tick corrections keep input order and apply deterministically.
    destinationChanges: validDestinationChanges.slice().sort((a, b) => a.tick - b.tick),
    floors: floors as number,
    elevators: elevators as number,
    travelTicks: travelTicks as number,
    doorOpenTicks: doorOpenTicks as number,
    doorCloseTicks: doorCloseTicks as number,
    // Errors above guarantee valid request shape; sorting keeps same-tick tie-break deterministic.
    requests: validRequests
      .sort((a, b) => a.arrivalTick - b.arrivalTick || a.id.localeCompare(b.id, 'zh-CN'))
      .map((request, index) => ({
        ...request,
        id: request.id || `R${String(index + 1).padStart(3, '0')}`
      })),
    outageEvents: validOutageEvents.slice().sort((a, b) =>
      a.tick - b.tick ||
      a.carId - b.carId ||
      (a.type === b.type ? 0 : a.type === 'outage' ? -1 : 1)
    )
  };

  return { ok: true, value: scenario };
}
