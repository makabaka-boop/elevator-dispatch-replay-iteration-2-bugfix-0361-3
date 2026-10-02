<script lang="ts">
  import { DEFAULT_SPEEDS, type TickSnapshot } from '../engine/types';

  export let snapshot: TickSnapshot;
  export let maxTick: number;
  export let playing: boolean;
  export let speed: number;
  export let onPlay: () => void;
  export let onPause: () => void;
  export let onStep: (delta: number) => void;
  export let onJump: (tick: number) => void;
  export let onSpeed: (speed: number) => void;

  let tickValue = 0;
  $: tickValue = snapshot.tick;
</script>

<div class="controls">
  <div class="buttons">
    <button class="primary" on:click={playing ? onPause : onPlay}>
      {playing ? '暂停' : '播放'}
    </button>
    <button on:click={() => onStep(-1)} disabled={snapshot.tick === 0}>◀ 单 tick</button>
    <button on:click={() => onStep(1)} disabled={snapshot.tick === maxTick}>单 tick ▶</button>
    <button on:click={() => onJump(0)}>开头</button>
    <button on:click={() => onJump(maxTick)}>结尾</button>
  </div>

  <div class="timeline">
    <input
      type="range"
      min="0"
      max={maxTick}
      step="1"
      bind:value={tickValue}
      on:input={() => onJump(tickValue)}
    />
    <div class="time-row">
      <span class="mono">tick {snapshot.tick} / {maxTick}</span>
      <span class={snapshot.active ? 'active' : 'finished'}>
        {snapshot.active ? '仿真中' : '已完成'}
      </span>
    </div>
  </div>

  <div class="speeds">
    <span>速度</span>
    {#each DEFAULT_SPEEDS as candidate}
      <button class={speed === candidate ? 'selected' : ''} on:click={() => onSpeed(candidate)}>
        ×{candidate}
      </button>
    {/each}
  </div>
</div>

<style>
  .controls {
    display: grid;
    grid-template-columns: auto minmax(260px, 1fr) auto;
    gap: 1rem;
    align-items: center;
    padding: 0.9rem;
    border: 1px solid #243044;
    border-radius: 0.9rem;
    background: rgba(15, 23, 42, 0.88);
  }

  .buttons,
  .speeds {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .speeds span {
    color: #94a3b8;
    font-size: 0.82rem;
    font-weight: 700;
  }

  .selected {
    border-color: #38bdf8;
    background: #075985;
  }

  .time-row {
    display: flex;
    justify-content: space-between;
    margin-top: 0.25rem;
    font-size: 0.86rem;
  }

  .active {
    color: #fbbf24;
    font-weight: 800;
  }

  .finished {
    color: #4ade80;
    font-weight: 800;
  }

  input[type='range'] {
    accent-color: #38bdf8;
  }

  @media (max-width: 980px) {
    .controls {
      grid-template-columns: 1fr;
    }
  }
</style>
