<script lang="ts">
  import { onDestroy } from 'svelte';
  import SimulationView from './components/SimulationView.svelte';
  import { simulate } from './engine/simulation';
  import type { SimulationResult } from './engine/types';
  import { TimelinePlayer } from './player/TimelinePlayer';
  import { sampleScenario, stressScenario } from './sample';

  let scenarioText = JSON.stringify(sampleScenario, null, 2);
  let result: SimulationResult | null = null;
  let player: TimelinePlayer | null = null;
  let errorMessage = '';
  let stats = '';

  function runSimulation(): void {
    try {
      errorMessage = '';
      const parsed = JSON.parse(scenarioText);
      const nextResult = simulate(parsed);
      player?.destroy();
      result = nextResult;
      player = new TimelinePlayer(nextResult.ticks);
      const requestCount = nextResult.scenario.requests.length;
      stats =
        `${nextResult.scenario.floors} 层 / ${nextResult.scenario.elevators} 台 / ` +
        `${requestCount} 个请求 / ${nextResult.finalTick} ticks；一次性预计算，播放只读取索引。`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  function loadSample(): void {
    scenarioText = JSON.stringify(sampleScenario, null, 2);
  }

  function loadStress(): void {
    scenarioText = JSON.stringify(stressScenario, null, 2);
  }

  onDestroy(() => player?.destroy());
</script>

<main>
  <header>
    <div>
      <h1>离线电梯群控模拟器</h1>
      <p>
        3–16 层、2–4 台电梯、每台固定 6 人。离散事件引擎一次性计算全部 tick；
        播放、倍速、跳转均读取同一份不可变快照。
      </p>
    </div>
  </header>

  <section class="card editor">
    <div class="editor-head">
      <div>
        <h2>场景 JSON</h2>
        <p class="small">
          参数：travelTicks（行驶一层）、doorOpenTicks（开门耗时）、doorCloseTicks（关门耗时）。
          门全开瞬间完成上下客并立即关门，未关门前不能行驶。
          可给请求设置 cancelTick 取消未上车部分；也可用 outageEvents 按 tick 指定电梯停运与恢复。
        </p>
      </div>
      <div class="editor-actions">
        <button on:click={loadSample}>样例</button>
        <button on:click={loadStress}>压测样例</button>
        <button class="primary" on:click={runSimulation}>计算并生成时间线</button>
      </div>
    </div>
    <textarea bind:value={scenarioText} spellcheck="false"></textarea>
    {#if errorMessage}
      <pre class="error">{errorMessage}</pre>
    {/if}
    {#if stats}
      <p class="stats">✓ {stats}</p>
    {/if}
  </section>

  {#if result && player}
    <SimulationView {result} {player} />
  {:else}
    <section class="card placeholder">
      <h2>不可变时间线播放</h2>
      <p>
        点击“计算并生成时间线”后，所有派车、开关门、上下客和空驶依据都会按 tick 固定。
        之后任意跳转或改变播放速度，都不会触发第二套状态推导。
      </p>
    </section>
  {/if}

  <footer>
    Svelte + TypeScript + 纯前端离散事件仿真。运行 <code>npm test</code> 查看逐 tick 参考回放测试。
  </footer>
</main>

<style>
  main {
    width: min(1440px, calc(100vw - 2rem));
    margin: 0 auto;
    padding: 1.5rem 0 2.5rem;
  }

  header {
    padding: 1rem 0 1.25rem;
  }

  h1 {
    margin: 0;
    font-size: clamp(1.7rem, 3vw, 2.7rem);
    background: linear-gradient(135deg, #e0f2fe, #7dd3fc 45%, #c084fc);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  header p {
    max-width: 950px;
    color: #94a3b8;
    line-height: 1.65;
    margin: 0.55rem 0 0;
  }

  .card {
    background: rgba(15, 23, 42, 0.62);
    border: 1px solid rgba(51, 65, 85, 0.72);
    border-radius: 1rem;
    padding: 1rem;
    margin-bottom: 1rem;
    box-shadow: 0 18px 50px rgba(2, 6, 23, 0.28);
  }

  .editor-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  h2 {
    margin: 0 0 0.25rem;
  }

  .editor-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  textarea {
    margin-top: 0.75rem;
  }

  .error {
    white-space: pre-wrap;
    color: #fecaca;
    background: rgba(127, 29, 29, 0.35);
    border: 1px solid #ef4444;
    border-radius: 0.6rem;
    padding: 0.75rem;
    line-height: 1.5;
  }

  .stats {
    color: #86efac;
    margin: 0.65rem 0 0;
    font-weight: 700;
  }

  .placeholder {
    padding: 2rem;
    text-align: center;
    color: #cbd5e1;
  }

  footer {
    color: #64748b;
    text-align: center;
    padding: 1rem;
  }

  code {
    background: #1e293b;
    padding: 0.12rem 0.35rem;
    border-radius: 0.3rem;
  }

  @media (max-width: 760px) {
    .editor-head {
      flex-direction: column;
    }
  }
</style>
