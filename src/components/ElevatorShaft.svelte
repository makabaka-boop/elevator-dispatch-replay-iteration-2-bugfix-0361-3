<script lang="ts">
  import type { TickSnapshot } from '../engine/types';

  export let snapshot: TickSnapshot;
  export let floors: number;

  const floorNumbers = Array.from({ length: floors }, (_, index) => floors - index);

  const doorLabel: Record<string, string> = {
    closed: '关',
    opening: '开中',
    open: '开',
    closing: '关中',
    moving: '移动'
  };

  function waitingOnFloor(floor: number) {
    return snapshot.requests
      .filter((request) => request.status === 'waiting' && request.origin === floor && request.remaining > 0)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
</script>

<div class="shaft-wrap">
  <div class="floor-list" style="--cars: {snapshot.cars.length};">
    {#each floorNumbers as floor}
      <div class="floor-row">
        <div class="floor-label">
          <strong>{floor}F</strong>
          {#if waitingOnFloor(floor).length}
            <span class="waiting-dot" title={waitingOnFloor(floor)
              .map((request) => `${request.id}:${request.remaining}`)
              .join(', ')}>
              ● {waitingOnFloor(floor).reduce((sum, request) => sum + request.remaining, 0)}
            </span>
          {/if}
        </div>
        {#each snapshot.cars as car}
          <div class="lane" class:service={car.floor === floor}>
            {#if car.floor === floor}
              <div
                class="car"
                class:open={car.phase === 'open'}
                class:moving={car.phase === 'moving'}
                class:outage={car.outOfService}
              >
                <div class="car-head">
                  <span>#{car.id}{car.outOfService ? ' 停运' : ''}</span>
                  <span class="phase">{doorLabel[car.phase]}</span>
                </div>
                <div class="people">
                  {#each Array.from({ length: car.capacity }, (_, index) => index) as index}
                    <span class={index < car.peopleOnboard ? 'occupied' : 'empty'}></span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if car.committedPickupFloors.includes(floor) && car.floor !== floor}
              <span class="commit pickup">P</span>
            {/if}
            {#if car.committedDropFloors.includes(floor) && car.floor !== floor}
              <span class="commit drop">D</span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .shaft-wrap {
    overflow-x: auto;
    padding: 0.25rem 0 0.5rem;
  }

  .floor-list {
    min-width: max-content;
    border: 1px solid #243044;
    border-radius: 0.75rem;
    overflow: hidden;
    background: rgba(15, 23, 42, 0.82);
  }

  .floor-row {
    display: grid;
    grid-template-columns: 74px repeat(var(--cars), minmax(118px, 1fr));
    min-height: 48px;
    border-bottom: 1px solid rgba(51, 65, 85, 0.55);
  }

  .floor-row:last-child {
    border-bottom: none;
  }

  .floor-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-right: 1px solid rgba(51, 65, 85, 0.7);
    background: rgba(15, 23, 42, 0.92);
  }

  .waiting-dot {
    color: #fbbf24;
    font-size: 0.72rem;
    font-weight: 800;
  }

  .lane {
    position: relative;
    border-right: 1px solid rgba(51, 65, 85, 0.35);
    min-height: 48px;
  }

  .lane:last-child {
    border-right: none;
  }

  .lane.service {
    background: rgba(56, 189, 248, 0.06);
  }

  .car {
    position: absolute;
    inset: 4px 8px;
    border: 2px solid #38bdf8;
    border-radius: 0.45rem;
    background: linear-gradient(180deg, rgba(14, 116, 144, 0.35), rgba(15, 23, 42, 0.94));
    padding: 0.2rem 0.45rem;
    box-shadow: 0 0 18px rgba(56, 189, 248, 0.28);
  }

  .car.open {
    border-color: #4ade80;
    box-shadow: 0 0 20px rgba(74, 222, 128, 0.35);
  }

  .car.moving {
    border-color: #c084fc;
  }

  .car.outage {
    border-color: #f97316;
    box-shadow: 0 0 20px rgba(249, 115, 22, 0.38);
    opacity: 0.78;
  }

  .car-head {
    display: flex;
    justify-content: space-between;
    gap: 0.4rem;
    font-size: 0.75rem;
    font-weight: 800;
  }

  .phase {
    color: #bae6fd;
  }

  .people {
    display: flex;
    gap: 3px;
    margin-top: 3px;
  }

  .people span {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
  }

  .people .occupied {
    background: #fbbf24;
    box-shadow: 0 0 6px rgba(251, 191, 36, 0.7);
  }

  .people .empty {
    background: #334155;
  }

  .commit {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: inline-grid;
    place-items: center;
    font-size: 0.68rem;
    font-weight: 900;
  }

  .commit.pickup {
    background: rgba(251, 191, 36, 0.18);
    color: #fbbf24;
    border: 1px solid #f59e0b;
  }

  .commit.drop {
    background: rgba(74, 222, 128, 0.15);
    color: #4ade80;
    border: 1px solid #22c55e;
  }
</style>
