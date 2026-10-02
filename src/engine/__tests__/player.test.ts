import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { simulate } from '../simulation';
import type { Scenario } from '../types';
import { TimelinePlayer } from '../../player/TimelinePlayer';

const scenario: Scenario = {
  floors: 8,
  elevators: 3,
  travelTicks: 2,
  doorOpenTicks: 1,
  doorCloseTicks: 1,
  requests: [
    { id: 'A', arrivalTick: 0, origin: 2, destination: 7, people: 6 },
    { id: 'B', arrivalTick: 3, origin: 1, destination: 8, people: 7, cancelTick: 20 },
    { id: 'C', arrivalTick: 8, origin: 6, destination: 1, people: 2 }
  ]
};

const outageScenario: Scenario = {
  floors: 6,
  elevators: 2,
  travelTicks: 2,
  doorOpenTicks: 1,
  doorCloseTicks: 1,
  requests: [{ id: 'OUT', arrivalTick: 0, origin: 1, destination: 6, people: 1 }],
  outageEvents: [
    { tick: 3, carId: 0, type: 'outage' },
    { tick: 5, carId: 0, type: 'recovery' }
  ]
};

function playThrough(speed: number, steps: number) {
  const result = simulate(scenario);
  const player = new TimelinePlayer(result.ticks);
  player.setSpeed(speed);
  player.play();
  vi.advanceTimersByTime((1000 / speed) * steps);
  const tick = get(player.currentTick);
  const snapshot = get(player.current);
  player.destroy();
  return { tick, snapshot, result };
}

describe('TimelinePlayer speed and jumping consistency', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lands on the same immutable snapshot regardless of playback speed', () => {
    const slow = playThrough(1, 10);
    const fast = playThrough(8, 10);
    expect(slow.tick).toBe(10);
    expect(fast.tick).toBe(10);
    expect(fast.snapshot).toEqual(slow.snapshot);
    expect(fast.snapshot).toBe(fast.result.ticks[10]);
  });

  it('jumping forwards and backwards reads stored snapshots without recomputing', () => {
    const result = simulate(scenario);
    const player = new TimelinePlayer(result.ticks);
    player.jumpTo(17);
    const at17 = get(player.current);
    expect(at17).toBe(result.ticks[17]);
    player.jumpTo(4);
    expect(get(player.current)).toBe(result.ticks[4]);
    player.jumpTo(99999);
    expect(get(player.currentTick)).toBe(result.finalTick);
    player.destroy();
  });

  it('speed changes during playback only alter interval timing, not referenced states', () => {
    const result = simulate(scenario);
    const player = new TimelinePlayer(result.ticks);
    player.play();
    vi.advanceTimersByTime(2000);
    expect(get(player.currentTick)).toBe(2);
    player.setSpeed(4);
    vi.advanceTimersByTime(1000);
    expect(get(player.currentTick)).toBe(6);
    expect(get(player.current)).toBe(result.ticks[6]);
    player.destroy();
  });

  it('jumps directly to frozen and recovered outage snapshots without deriving another state', () => {
    const result = simulate(outageScenario);
    const player = new TimelinePlayer(result.ticks);

    player.jumpTo(4);
    const frozen = get(player.current)!;
    expect(frozen).toBe(result.ticks[4]);
    expect(frozen.cars[0].outOfService).toBe(true);
    expect(frozen.cars[0].floor).toBe(1);
    expect(frozen.cars[0].phaseElapsed).toBe(0);
    expect(frozen.events.some((event) => event.type === 'outage')).toBe(false);

    player.jumpTo(3);
    expect(get(player.current)).toBe(result.ticks[3]);
    expect(get(player.current)!.events.some((event) => event.type === 'outage')).toBe(true);

    player.jumpTo(5);
    const recovered = get(player.current)!;
    expect(recovered).toBe(result.ticks[5]);
    expect(recovered.cars[0].outOfService).toBe(false);
    expect(recovered.events.some((event) => event.type === 'recovery')).toBe(true);
    player.destroy();
  });
});
