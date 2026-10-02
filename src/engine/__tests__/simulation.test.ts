import { describe, expect, it } from 'vitest';
import { simulate } from '../simulation';
import { CAR_CAPACITY, type Scenario, type TickSnapshot } from '../types';

function eventTexts(result: ReturnType<typeof simulate>, tick: number): string[] {
  return result.ticks[tick].events.map((event) => event.message);
}

function findEvent(result: ReturnType<typeof simulate>, tick: number, requestId: string, type: string) {
  return result.ticks[tick].events.find(
    (event) => event.requestId === requestId && event.type === type
  );
}

function conservationChecks(ticks: TickSnapshot[]): void {
  const final = ticks[ticks.length - 1];
  for (const request of final.requests) {
    expect(request.people).toBe(request.completed + request.cancelled);
    expect(request.remaining).toBe(0);
    expect(request.boarded).toBe(request.completed);
  }
  for (const snapshot of ticks) {
    const requestWaiting = snapshot.requests
      .filter((request) => request.status === 'waiting' || request.status === 'riding')
      .reduce((sum, request) => sum + request.remaining, 0);
    const requestRiding = snapshot.requests
      .filter((request) => request.status === 'riding')
      .reduce((sum, request) => sum + Math.max(0, request.boarded - request.completed), 0);
    const carWaiting = snapshot.cars.reduce(
      (sum, car) => sum + car.waiting.reduce((inner, entry) => inner + entry.remaining, 0),
      0
    );
    const carRiding = snapshot.cars.reduce((sum, car) => sum + car.peopleOnboard, 0);
    const committedIds = new Set(
      snapshot.cars.flatMap((car) => car.waiting.map((entry) => entry.requestId))
    );
    const unassignedWaiting = snapshot.requests
      .filter(
        (request) =>
          (request.status === 'waiting' || request.status === 'riding') &&
          !committedIds.has(request.id)
      )
      .reduce((sum, request) => sum + request.remaining, 0);
    expect(snapshot.totalUnassignedWaiting).toBe(unassignedWaiting);
    expect(carWaiting + unassignedWaiting).toBe(requestWaiting);
    expect(carRiding).toBe(requestRiding);
    for (const car of snapshot.cars) {
      expect(car.peopleOnboard).toBeLessThanOrEqual(CAR_CAPACITY);
    }
  }
}

describe('discrete elevator reference replay', () => {
  it('breaks parallel dispatch ties by earliest ETA and then smallest car ID', () => {
    const scenario: Scenario = {
      floors: 6,
      elevators: 2,
      travelTicks: 2,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'same', arrivalTick: 4, origin: 1, destination: 6, people: 1 }
      ]
    };

    const result = simulate(scenario);
    const event = findEvent(result, 4, 'same', 'dispatch');
    expect(event).toBeDefined();
    expect(event?.carId).toBe(0);
    expect(event?.eta).toBe(5);
    const candidateSummary = event?.candidates?.map((candidate) => [candidate.carId, candidate.eta]);
    expect(candidateSummary).toEqual([[0, 5], [1, 5]]);
  });

  it('assigns two equal ETA requests on the same tick to cars in deterministic ID order', () => {
    const scenario: Scenario = {
      floors: 8,
      elevators: 2,
      travelTicks: 1,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'B', arrivalTick: 0, origin: 3, destination: 8, people: 1 },
        { id: 'A', arrivalTick: 0, origin: 2, destination: 8, people: 1 }
      ]
    };

    const result = simulate(scenario);
    const tick = result.ticks[0];
    const dispatchA = tick.events.find((event) => event.requestId === 'A' && event.type === 'dispatch');
    const dispatchB = tick.events.find((event) => event.requestId === 'B' && event.type === 'dispatch');
    expect(dispatchA?.carId).toBe(0);
    expect(dispatchB?.carId).toBe(1);
    expect(dispatchA?.eta).toBeLessThanOrEqual(dispatchB!.eta!);
  });

  it('boards only the available capacity and keeps the surplus assigned until it is served', () => {
    const scenario: Scenario = {
      floors: 10,
      elevators: 2,
      travelTicks: 3,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'BIG', arrivalTick: 1, origin: 1, destination: 3, people: 10 }
      ]
    };

    const result = simulate(scenario);
    const firstBoard = findEvent(result, 2, 'BIG', 'board');
    expect(firstBoard?.people).toBe(6);
    expect(firstBoard?.remaining).toBe(4);
    expect(firstBoard?.reason).toContain('容量不足');

    const requestAtFirst = result.ticks[2].requests.find((request) => request.id === 'BIG')!;
    expect(requestAtFirst.status).toBe('riding');
    expect(requestAtFirst.remaining).toBe(4);
    expect(requestAtFirst.boarded).toBe(6);
    expect(requestAtFirst.carId).toBe(0);

    const alight = result.ticks.find((snapshot) =>
      snapshot.events.some((event) => event.requestId === 'BIG' && event.type === 'alight')
    );
    expect(alight).toBeDefined();
    const alightEvent = alight!.events.find(
      (event) => event.requestId === 'BIG' && event.type === 'alight'
    )!;
    expect(alightEvent.people).toBe(6);

    const secondBoard = result.ticks.find((snapshot) =>
      snapshot.events.some(
        (event) => event.requestId === 'BIG' && event.type === 'board' && event.people === 4
      )
    );
    expect(secondBoard).toBeDefined();

    const requestAfterSecond = secondBoard!.requests.find((request) => request.id === 'BIG')!;
    expect(requestAfterSecond.remaining).toBe(0);
    expect(requestAfterSecond.boarded).toBe(10);
    conservationChecks(result.ticks);
  });

  it('cancels only unboarded people and refuses cancellation after boarding', () => {
    const scenario: Scenario = {
      floors: 6,
      elevators: 2,
      travelTicks: 5,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'WAIT', arrivalTick: 1, origin: 1, destination: 6, people: 3, cancelTick: 2 },
        { id: 'RIDE', arrivalTick: 1, origin: 1, destination: 6, people: 2, cancelTick: 4 }
      ]
    };

    const result = simulate(scenario);
    const waitCancel = findEvent(result, 2, 'WAIT', 'cancel');
    expect(waitCancel?.people).toBe(3);
    const waitRequest = result.ticks[2].requests.find((request) => request.id === 'WAIT')!;
    expect(waitRequest.status).toBe('cancelled');
    expect(waitRequest.cancelled).toBe(3);

    const rideReject = findEvent(result, 4, 'RIDE', 'cancel_rejected');
    expect(rideReject).toBeDefined();
    expect(rideReject?.reason).toContain('已经上车');
    const finalRide = result.ticks[result.finalTick].requests.find(
      (request) => request.id === 'RIDE'
    )!;
    expect(finalRide.completed).toBe(2);
    expect(finalRide.cancelled).toBe(0);
    conservationChecks(result.ticks);
  });

  it('never moves during opening/open/closing and emits the full deterministic basis', () => {
    const scenario: Scenario = {
      floors: 5,
      elevators: 2,
      travelTicks: 2,
      doorOpenTicks: 2,
      doorCloseTicks: 3,
      requests: [{ id: 'X', arrivalTick: 1, origin: 1, destination: 5, people: 1 }]
    };

    const result = simulate(scenario);
    const dispatchTick = result.ticks[1];
    const dispatch = dispatchTick.events.find((event) => event.type === 'dispatch')!;
    expect(dispatch.carId).toBe(0);
    expect(eventTexts(result, 1).join('\n')).toContain('派给 #0');
    expect(result.ticks[1].cars[0].phase).toBe('opening');
    expect(result.ticks[1].cars[0].floor).toBe(1);

    expect(result.ticks[2].cars[0].phase).toBe('opening');
    expect(result.ticks[2].cars[0].floor).toBe(1);

    expect(result.ticks[3].cars[0].phase).toBe('closing');
    expect(result.ticks[3].cars[0].floor).toBe(1);
    expect(result.ticks[4].cars[0].phase).toBe('closing');
    expect(result.ticks[4].cars[0].floor).toBe(1);
    expect(result.ticks[5].cars[0].phase).toBe('closing');
    expect(result.ticks[5].cars[0].floor).toBe(1);
    expect(result.ticks[6].cars[0].phase).toBe('moving');
    expect(result.ticks[6].cars[0].floor).toBe(1);
    expect(result.ticks[7].cars[0].phase).toBe('moving');
    expect(result.ticks[7].cars[0].floor).toBe(1);
    expect(result.ticks[8].cars[0].floor).toBe(2);

    const moveEvent = result.ticks[6].events.find((event) => event.type === 'move_start')!;
    expect(moveEvent.reason).toContain('SCAN');
    expect(moveEvent.message).toContain('载客 1 人');
  });

  it('logs an empty run with committed pickup rationale', () => {
    const scenario: Scenario = {
      floors: 6,
      elevators: 2,
      travelTicks: 1,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [{ id: 'FAR', arrivalTick: 0, origin: 4, destination: 6, people: 2 }]
    };

    const result = simulate(scenario);
    const move = result.ticks[0].events.find((event) => event.type === 'move_start');
    expect(move).toBeDefined();
    expect(move?.message).toContain('空驶');
    expect(move?.committedPickups).toEqual([4]);
    expect(move?.reason).toContain('已承诺接客楼层 [4]');
  });

  it('produces identical tick snapshots when re-run from the same scenario', () => {
    const scenario: Scenario = {
      floors: 12,
      elevators: 4,
      travelTicks: 2,
      doorOpenTicks: 1,
      doorCloseTicks: 2,
      requests: Array.from({ length: 30 }, (_, index) => {
        const origin = (index * 5) % 12 + 1;
        const destination = ((index * 7) % 12) + 1;
        return {
          id: `R${index}`,
          arrivalTick: index,
          origin,
          destination: destination === origin ? (destination % 12) + 1 : destination,
          people: ((index * 3) % 7) + 1,
          ...(index % 4 === 2 ? { cancelTick: index + 2 } : {})
        };
      })
    };

    const first = simulate(scenario);
    const second = simulate(scenario);
    expect(first.finalTick).toBe(second.finalTick);
    expect(second.ticks).toEqual(first.ticks);
    conservationChecks(first.ticks);
  });

  it('freezes a moving car and resumes without making up the stopped distance', () => {
    const scenario: Scenario = {
      floors: 10,
      elevators: 2,
      travelTicks: 2,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'RIDE', arrivalTick: 0, origin: 1, destination: 5, people: 2 },
        { id: 'LATE', arrivalTick: 5, origin: 1, destination: 3, people: 1 }
      ],
      outageEvents: [
        { tick: 4, carId: 0, type: 'outage' },
        { tick: 7, carId: 0, type: 'recovery' }
      ]
    };

    const result = simulate(scenario);
    const outage = result.ticks[4].events.find((event) => event.type === 'outage')!;
    expect(outage.carId).toBe(0);
    expect(outage.remainingTicks).toBe(1);
    expect(result.ticks[4].cars[0]).toMatchObject({
      floor: 1,
      phase: 'moving',
      phaseElapsed: 1,
      targetFloor: 2,
      direction: 1,
      peopleOnboard: 2,
      outOfService: true
    });

    for (const tick of [4, 5, 6]) {
      expect(result.ticks[tick].cars[0]).toMatchObject({
        floor: 1,
        phase: 'moving',
        phaseElapsed: 1,
        peopleOnboard: 2,
        outOfService: true
      });
    }

    const lateDispatch = findEvent(result, 5, 'LATE', 'dispatch');
    expect(lateDispatch?.carId).toBe(1);
    expect(result.ticks[5].requests.find((request) => request.id === 'RIDE')?.carId).toBe(0);

    const recovery = result.ticks[7].events.find((event) => event.type === 'recovery')!;
    expect(recovery.remainingTicks).toBe(1);
    // Recovery is applied before the current tick's car transition; the remaining one tick is
    // consumed normally at tick 7, with no extra movement added for ticks 4-6.
    expect(result.ticks[7].cars[0]).toMatchObject({
      floor: 2,
      phase: 'moving',
      phaseElapsed: 0,
      outOfService: false
    });
    expect(result.ticks[8].cars[0].floor).toBe(2);
    expect(result.ticks[9].events.find((event) => event.type === 'move_arrive')?.toFloor).toBe(3);
    expect(result.ticks[9].cars[0].floor).toBe(3);
    conservationChecks(result.ticks);
  });

  it('keeps boarded passengers and destination promises while redispatching a partial pickup', () => {
    const scenario: Scenario = {
      floors: 10,
      elevators: 2,
      travelTicks: 2,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'BIG', arrivalTick: 0, origin: 1, destination: 8, people: 10 },
        { id: 'OTHER', arrivalTick: 2, origin: 2, destination: 8, people: 2 }
      ],
      outageEvents: [
        { tick: 4, carId: 0, type: 'outage' },
        { tick: 6, carId: 0, type: 'recovery' }
      ]
    };

    const result = simulate(scenario);
    expect(result.ticks[1].cars[0].peopleOnboard).toBe(6);
    const requestAtOutage = result.ticks[4].requests.find((request) => request.id === 'BIG')!;
    expect(requestAtOutage).toMatchObject({
      boarded: 6,
      remaining: 4,
      status: 'riding',
      carId: 1
    });

    const withdrawn = findEvent(result, 4, 'BIG', 'commitment_withdrawn')!;
    expect(withdrawn.carId).toBe(0);
    expect(withdrawn.people).toBe(4);
    const frozenCar = result.ticks[4].cars[0];
    expect(frozenCar).toMatchObject({
      floor: 1,
      phase: 'moving',
      phaseElapsed: 1,
      peopleOnboard: 6,
      outOfService: true
    });
    expect(frozenCar.waiting).toEqual([]);
    expect(frozenCar.committedDropFloors).toEqual([8]);

    const redispatch = result.ticks[4].events.find(
      (event) => event.type === 'dispatch' && event.requestId === 'BIG'
    );
    expect(redispatch?.carId).toBe(1);
    const residualAt4 = result.ticks[4].requests.find((request) => request.id === 'BIG')!;
    expect(residualAt4.carId).toBe(1);
    expect(residualAt4.remaining).toBe(4);

    const firstAlight = result.ticks.find((snapshot) =>
      snapshot.events.some((event) => event.requestId === 'BIG' && event.type === 'alight' && event.people === 6)
    );
    expect(firstAlight).toBeDefined();
    const residualAfterFirst = firstAlight!.requests.find((request) => request.id === 'BIG')!;
    expect(residualAfterFirst).toMatchObject({ status: 'waiting', remaining: 4, carId: 1 });

    const alights = result.ticks.flatMap((snapshot) =>
      snapshot.events.filter((event) => event.requestId === 'BIG' && event.type === 'alight')
    );
    expect(alights.map((event) => event.people).sort()).toEqual([4, 6]);
    conservationChecks(result.ticks);
  });

  it('leaves all passengers waiting when the whole fleet is down, then dispatches after recovery', () => {
    const scenario: Scenario = {
      floors: 10,
      elevators: 3,
      travelTicks: 2,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'A', arrivalTick: 0, origin: 1, destination: 5, people: 2 },
        { id: 'B', arrivalTick: 0, origin: 2, destination: 5, people: 2 },
        { id: 'WAIT', arrivalTick: 5, origin: 1, destination: 3, people: 3 }
      ],
      outageEvents: [
        { tick: 5, carId: 0, type: 'outage' },
        { tick: 5, carId: 1, type: 'outage' },
        { tick: 5, carId: 2, type: 'outage' },
        { tick: 6, carId: 0, type: 'recovery' },
        { tick: 6, carId: 1, type: 'recovery' },
        { tick: 6, carId: 2, type: 'recovery' }
      ]
    };

    const result = simulate(scenario);
    expect(result.ticks[5].cars.map((car) => car.outOfService)).toEqual([true, true, true]);
    expect(result.ticks[5].cars).toEqual([
      expect.objectContaining({ phase: 'moving', phaseElapsed: 0, floor: 2, peopleOnboard: 2 }),
      expect.objectContaining({ phase: 'moving', phaseElapsed: 0, floor: 2, peopleOnboard: 2 }),
      expect.objectContaining({ phase: 'closed', phaseElapsed: 0, floor: 1, peopleOnboard: 0 })
    ]);

    const deferred = findEvent(result, 5, 'WAIT', 'dispatch_deferred');
    expect(deferred).toBeDefined();
    const waitingRequest = result.ticks[5].requests.find((request) => request.id === 'WAIT')!;
    expect(waitingRequest).toMatchObject({
      status: 'waiting',
      carId: null,
      remaining: 3
    });
    expect(result.ticks[5].totalUnassignedWaiting).toBe(3);

    const dispatch = findEvent(result, 6, 'WAIT', 'dispatch');
    expect(dispatch?.carId).toBe(2);
    expect(result.ticks[5].cars.map((car) => car.floor)).toEqual([2, 2, 1]);
    expect(result.ticks[6].cars.map((car) => car.floor)).toEqual([2, 2, 1]);
    expect(result.ticks[5].cars.map((car) => car.phaseElapsed)).toEqual([0, 0, 0]);
    expect(result.ticks[6].cars.map((car) => car.phaseElapsed)).toEqual([1, 1, 0]);
    expect(result.ticks[5].cars.map((car) => car.outOfService)).toEqual([true, true, true]);
    expect(result.ticks[6].cars.map((car) => car.outOfService)).toEqual([false, false, false]);
    expect(result.ticks[7].cars.map((car) => car.floor)).toEqual([3, 3, 1]);
    expect(result.ticks[7].cars.map((car) => car.outOfService)).toEqual([false, false, false]);
    conservationChecks(result.ticks);
  });

  it('validates deterministic outage transitions and keeps old scenarios unchanged', () => {
    const base: Scenario = {
      floors: 5,
      elevators: 2,
      travelTicks: 1,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [{ id: 'X', arrivalTick: 0, origin: 1, destination: 5, people: 1 }]
    };
    const oldResult = simulate(base);
    const newResult = simulate({ ...base, outageEvents: [] });
    expect(newResult.ticks).toEqual(oldResult.ticks);

    expect(() => simulate({
      ...base,
      outageEvents: [{ tick: 1, carId: 2, type: 'outage' }]
    })).toThrow('carId');
    expect(() => simulate({
      ...base,
      outageEvents: [{ tick: 1, carId: 0, type: 'recovery' }]
    })).toThrow('未处于停运状态');
    expect(() => simulate({
      ...base,
      outageEvents: [
        { tick: 1, carId: 0, type: 'outage' },
        { tick: 2, carId: 0, type: 'outage' }
      ]
    })).toThrow('已处于停运状态');
    expect(() => simulate({
      ...base,
      outageEvents: [{ tick: 1, carId: 0, type: 'outage' }]
    })).toThrow('对应的恢复事件');
  });
});
