import { describe, expect, it } from 'vitest';
import { simulate } from '../simulation';
import type { Scenario } from '../types';

function eventsOf(result: ReturnType<typeof simulate>, tick: number) {
  return result.ticks[tick].events;
}

function alightsFor(result: ReturnType<typeof simulate>, requestId: string) {
  return result.ticks
    .flatMap((snapshot) =>
      snapshot.events
        .filter((event) => event.requestId === requestId && event.type === 'alight')
        .map((event) => ({ tick: snapshot.tick, floor: event.floor!, people: event.people! }))
    );
}

describe('waiting destination corrections', () => {
  it('changes only the still-waiting remainder; boarded batches keep their boarding-time destination, also when frozen', () => {
    const scenario: Scenario = {
      floors: 10,
      elevators: 2,
      travelTicks: 2,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'BIG', arrivalTick: 0, origin: 1, destination: 8, people: 10 }
      ],
      outageEvents: [
        { tick: 4, carId: 0, type: 'outage' },
        { tick: 8, carId: 0, type: 'recovery' }
      ],
      // #0 freezes at tick 4; its withdrawn 4 are redispatched to #1 (opening at tick 4).
      // The correction lands at tick 5, BEFORE #1's door opens, so only the waiting 4 change.
      destinationChanges: [
        { tick: 5, requestId: 'BIG', destination: 2 }
      ]
    };

    const result = simulate(scenario);

    // 6 people board car #0 at tick 1 (bound for 8); the surplus of 4 is withdrawn when #0
    // freezes at tick 4 and is redispatched to #1. The tick-5 correction steers only the
    // waiting 4 toward floor 2; the frozen batch of 6 stays bound for floor 8.
    const change = eventsOf(result, 5).find(
      (event) => event.type === 'destination_change' && event.requestId === 'BIG'
    );
    expect(change).toBeDefined();
    expect(change).toMatchObject({ people: 4, fromFloor: 8, toFloor: 2 });

    const requestAt5 = result.ticks[5].requests.find((request) => request.id === 'BIG')!;
    expect(requestAt5.destination).toBe(2);

    // The frozen car must still promise the ORIGINAL drop floor 8 for the boarded batch.
    expect(result.ticks[6].cars[0].committedDropFloors).toEqual([8]);
    const onboardFrozen = result.ticks[6].cars[0].onboard.find(
      (entry) => entry.requestId === 'BIG'
    )!;
    expect(onboardFrozen).toMatchObject({ remaining: 6, destination: 8 });

    // #1 boards the corrected remainder on tick 5; that batch is bound for floor 2.
    const onboardResidual = result.ticks[5].cars[1].onboard.find(
      (entry) => entry.requestId === 'BIG'
    )!;
    expect(onboardResidual).toMatchObject({ remaining: 4, destination: 2 });

    // After recovery #0 still goes to 8; the redispatched remainder on #1 goes to 2.
    expect(alightsFor(result, 'BIG')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ floor: 8, people: 6 }),
        expect.objectContaining({ floor: 2, people: 4 })
      ])
    );
    const final = result.ticks[result.finalTick].requests.find(
      (request) => request.id === 'BIG'
    )!;
    expect(final).toMatchObject({ people: 10, completed: 10, cancelled: 0, remaining: 0 });
  });

  it('keeps a distinct destination per car batch when one request rides split cars', () => {
    const scenario: Scenario = {
      floors: 12,
      elevators: 2,
      travelTicks: 1,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        // 6 board car #0 at tick 1 for floor 12; the remaining 4 leave later for floor 3.
        { id: 'SPLIT', arrivalTick: 0, origin: 1, destination: 12, people: 10 }
      ],
      destinationChanges: [
        { tick: 2, requestId: 'SPLIT', destination: 3 }
      ]
    };

    const result = simulate(scenario);
    expect(alightsFor(result, 'SPLIT')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ floor: 12, people: 6 }),
        expect.objectContaining({ floor: 3, people: 4 })
      ])
    );
  });

  it('applies a correction before the boarding transfer when both happen on the same tick', () => {
    const scenario: Scenario = {
      floors: 8,
      elevators: 2,
      travelTicks: 3,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'SAME', arrivalTick: 0, origin: 1, destination: 8, people: 2 }
      ],
      destinationChanges: [
        { tick: 1, requestId: 'SAME', destination: 2 }
      ]
    };

    const result = simulate(scenario);
    const tick1 = eventsOf(result, 1);
    const changeAt = tick1.findIndex((event) => event.type === 'destination_change');
    const boardAt = tick1.findIndex((event) => event.type === 'board');
    expect(changeAt).toBeGreaterThanOrEqual(0);
    expect(boardAt).toBeGreaterThan(changeAt);
    // The captured onboard destination is the corrected one.
    const onboard = result.ticks[2].cars
      .flatMap((car) => car.onboard)
      .find((entry) => entry.requestId === 'SAME')!;
    expect(onboard.destination).toBe(2);
    expect(alightsFor(result, 'SAME')).toEqual([
      expect.objectContaining({ floor: 2, people: 2 })
    ]);
  });

  it('does not reopen a finished request and records that zero people were affected', () => {
    const scenario: Scenario = {
      floors: 5,
      elevators: 2,
      travelTicks: 1,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'DONE', arrivalTick: 0, origin: 1, destination: 2, people: 1 },
        // Keeps the timeline alive past tick 9 even though DONE finishes around tick 4.
        { id: 'LATER', arrivalTick: 9, origin: 1, destination: 3, people: 1 }
      ],
      destinationChanges: [
        { tick: 9, requestId: 'DONE', destination: 4 }
      ]
    };

    const result = simulate(scenario);
    const request = result.ticks[4].requests.find((item) => item.id === 'DONE')!;
    expect(request.status).toBe('completed');
    expect(request.completed).toBe(1);
    const change = eventsOf(result, 9).find(
      (event) => event.type === 'destination_change' && event.requestId === 'DONE'
    );
    expect(change).toBeDefined();
    expect(change?.people).toBe(0);
    // The closed destination stays the one served; nobody is taken back to floor 4.
    expect(alightsFor(result, 'DONE')).toEqual([
      expect.objectContaining({ floor: 2, people: 1 })
    ]);
  });

  it('leaves the cancelled remainder out of an effective correction on the same tick', () => {
    const scenario: Scenario = {
      floors: 8,
      elevators: 2,
      travelTicks: 1,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'MIX', arrivalTick: 0, origin: 1, destination: 8, people: 10, cancelTick: 2 }
      ],
      destinationChanges: [
        { tick: 2, requestId: 'MIX', destination: 2 }
      ]
    };

    const result = simulate(scenario);
    const tick2 = eventsOf(result, 2);
    const cancelAt = tick2.findIndex((event) => event.type === 'cancel');
    const changeAt = tick2.findIndex((event) => event.type === 'destination_change');
    // Fixed same-tick order: cancellation first, then destination correction.
    expect(cancelAt).toBeGreaterThanOrEqual(0);
    expect(changeAt).toBeGreaterThan(cancelAt);
    expect(tick2.find((event) => event.type === 'destination_change')?.people).toBe(0);
    // Only the first 6 (boarded) ever alight, at the original destination; the other 4 were
    // cancelled rather than retargeted.
    expect(alightsFor(result, 'MIX')).toEqual([
      expect.objectContaining({ floor: 8, people: 6 })
    ]);
    const final = result.ticks[result.finalTick].requests.find(
      (request) => request.id === 'MIX'
    )!;
    expect(final).toMatchObject({ completed: 6, cancelled: 4 });
  });

  it('withdraws and redispatches an outage on the same tick using the corrected waiting agreement', () => {
    const scenario: Scenario = {
      floors: 10,
      elevators: 2,
      travelTicks: 2,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [
        { id: 'BIG', arrivalTick: 0, origin: 1, destination: 9, people: 10 }
      ],
      outageEvents: [
        { tick: 4, carId: 0, type: 'outage' },
        { tick: 7, carId: 0, type: 'recovery' }
      ],
      destinationChanges: [
        { tick: 4, requestId: 'BIG', destination: 2 }
      ]
    };

    const result = simulate(scenario);
    const tick4 = eventsOf(result, 4);
    const changeAt = tick4.findIndex((event) => event.type === 'destination_change');
    const outageAt = tick4.findIndex((event) => event.type === 'outage');
    const withdrawAt = tick4.findIndex((event) => event.type === 'commitment_withdrawn');
    const dispatchAt = tick4.findIndex((event) => event.type === 'dispatch');
    // Fixed order: correction -> outage -> withdrawal -> redispatch on the same tick.
    expect(changeAt).toBeGreaterThanOrEqual(0);
    expect(outageAt).toBeGreaterThan(changeAt);
    expect(withdrawAt).toBeGreaterThan(outageAt);
    expect(dispatchAt).toBeGreaterThan(withdrawAt);

    // Frozen batch keeps 9; the redispatched waiting batch is bound for 2.
    expect(result.ticks[4].cars[0].committedDropFloors).toEqual([9]);
    const redispatch = tick4.find((event) => event.type === 'dispatch' && event.requestId === 'BIG')!;
    expect(redispatch.message).toContain('1→2');
    expect(alightsFor(result, 'BIG')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ floor: 9, people: 6 }),
        expect.objectContaining({ floor: 2, people: 4 })
      ])
    );
  });

  it('rejects malformed corrections and same-tick duplicate corrections for one request', () => {
    const base = {
      floors: 5,
      elevators: 2,
      travelTicks: 1,
      doorOpenTicks: 1,
      doorCloseTicks: 1,
      requests: [{ id: 'R', arrivalTick: 0, origin: 1, destination: 5, people: 1 }]
    } satisfies Scenario;

    expect(() =>
      simulate({ ...base, destinationChanges: [{ tick: 0, requestId: 'GHOST', destination: 2 }] })
    ).toThrow('更正事件无效');
    expect(() =>
      simulate({ ...base, destinationChanges: [null as never] })
    ).toThrow('包含 tick');
    expect(() =>
      simulate({
        ...base,
        destinationChanges: [
          { tick: 2, requestId: 'R', destination: 3 },
          { tick: 2, requestId: 'R', destination: 4 }
        ]
      })
    ).toThrow('同一 tick 只能有一个');
  });
});
