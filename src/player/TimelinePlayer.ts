import { get, writable } from 'svelte/store';
import type { SimEvent, TickSnapshot } from '../engine/types';

export class TimelinePlayer {
  readonly snapshots: TickSnapshot[];
  readonly maxTick: number;
  currentTick = writable(0);
  playing = writable(false);
  speed = writable(1);
  current = writable<TickSnapshot | null>(null);
  events = writable<SimEvent[]>([]);

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(snapshots: TickSnapshot[]) {
    if (snapshots.length === 0) throw new Error('时间线为空，无法播放。');
    this.snapshots = snapshots;
    this.maxTick = snapshots[snapshots.length - 1].tick;
    this.jumpTo(0);
  }

  jumpTo(tick: number): void {
    const clamped = Math.max(0, Math.min(this.maxTick, Math.floor(tick)));
    // Playback reads a precomputed snapshot. It never derives another state set.
    const snapshot = this.snapshots[clamped];
    this.currentTick.set(clamped);
    this.current.set(snapshot);
    this.events.set(snapshot.events);
    if (clamped === this.maxTick) this.playing.set(false);
  }

  play(): void {
    if (get(this.currentTick) === this.maxTick) this.jumpTo(0);
    this.playing.set(true);
    this.schedule();
  }

  pause(): void {
    this.playing.set(false);
    this.clearTimer();
  }

  toggle(): void {
    if (get(this.playing)) this.pause();
    else this.play();
  }

  stepForward(): void {
    this.pause();
    this.jumpTo(get(this.currentTick) + 1);
  }

  stepBackward(): void {
    this.pause();
    this.jumpTo(get(this.currentTick) - 1);
  }

  setSpeed(speed: number): void {
    this.speed.set(speed);
    if (get(this.playing)) {
      this.clearTimer();
      this.schedule();
    }
  }

  destroy(): void {
    this.clearTimer();
  }

  private schedule(): void {
    this.clearTimer();
    if (!get(this.playing)) return;
    const speed = get(this.speed);
    const interval = 1000 / speed;
    this.timer = globalThis.setInterval(() => {
      const next = get(this.currentTick) + 1;
      if (next >= this.maxTick) {
        this.jumpTo(this.maxTick);
        this.pause();
      } else {
        this.jumpTo(next);
      }
    }, interval);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      globalThis.clearInterval(this.timer);
      this.timer = null;
    }
  }
}
