<script lang="ts">
  import ElevatorShaft from './ElevatorShaft.svelte';
  import EventLog from './EventLog.svelte';
  import PlaybackControls from './PlaybackControls.svelte';
  import RequestTable from './RequestTable.svelte';
  import type { SimulationResult } from '../engine/types';
  import type { TimelinePlayer } from '../player/TimelinePlayer';

  export let result: SimulationResult;
  export let player: TimelinePlayer;

  const current = player.current;
  const playing = player.playing;
  const speed = player.speed;
  const events = player.events;
</script>

{#if $current}
  <div class="simulation-view">
    <section class="card">
      <PlaybackControls
        snapshot={$current}
        maxTick={result.finalTick}
        playing={$playing}
        speed={$speed}
        onPlay={() => player.play()}
        onPause={() => player.pause()}
        onStep={(delta) => (delta < 0 ? player.stepBackward() : player.stepForward())}
        onJump={(tick) => player.jumpTo(tick)}
        onSpeed={(speed) => player.setSpeed(speed)}
      />
    </section>

    <section class="card elevators">
      <div class="section-head">
        <h2>井道与已承诺停靠点</h2>
        <p class="small">P=承诺接客，D=承诺下客；轿厢圆点表示 6 人容量。</p>
      </div>
      <ElevatorShaft snapshot={$current} floors={result.scenario.floors} />
      <div class="car-grid">
        {#each $current.cars as car}
          <article class="car-card">
            <h3># {car.id} · {car.floor}F · {car.phase}{car.outOfService ? ' · 停运冻结' : ''}</h3>
            <dl>
              <div><dt>载重</dt><dd>{car.peopleOnboard}/{car.capacity}</dd></div>
              <div><dt>方向</dt><dd>{car.direction === 1 ? '上行' : car.direction === -1 ? '下行' : '停'}</dd></div>
              <div><dt>接客层</dt><dd>{car.committedPickupFloors.join(', ') || '—'}</dd></div>
              <div><dt>下客层</dt><dd>{car.committedDropFloors.join(', ') || '—'}</dd></div>
              <div><dt>余客请求</dt><dd>{car.waiting.map((item) => item.requestId).join(', ') || '—'}</dd></div>
            </dl>
          </article>
        {/each}
      </div>
    </section>

    <section class="card">
      <RequestTable snapshot={$current} />
    </section>

    <section class="card">
      <EventLog events={$events} />
    </section>
  </div>
{/if}

<style>
  .card {
    background: rgba(15, 23, 42, 0.62);
    border: 1px solid rgba(51, 65, 85, 0.72);
    border-radius: 1rem;
    padding: 1rem;
    margin-bottom: 1rem;
    box-shadow: 0 18px 50px rgba(2, 6, 23, 0.28);
  }

  .section-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  h2,
  h3 {
    margin: 0 0 0.25rem;
  }

  .car-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 0.7rem;
    margin-top: 0.75rem;
  }

  .car-card {
    border: 1px solid #334155;
    background: rgba(30, 41, 59, 0.65);
    border-radius: 0.75rem;
    padding: 0.75rem;
  }

  dl {
    margin: 0.55rem 0 0;
    display: grid;
    gap: 0.32rem;
  }

  dl div {
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  dt {
    color: #94a3b8;
  }

  dd {
    margin: 0;
  }

  @media (max-width: 760px) {
    .section-head {
      flex-direction: column;
    }
  }
</style>
