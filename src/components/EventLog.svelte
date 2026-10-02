<script lang="ts">
  import type { SimEvent } from '../engine/types';

  export let events: SimEvent[];

  const typeClass: Record<string, string> = {
    arrival: 'arrival',
    dispatch: 'dispatch',
    dispatch_deferred: 'dispatch',
    door_opening: 'door',
    door_open: 'door',
    door_closing: 'door',
    door_closed: 'door',
    alight: 'alight',
    board: 'board',
    move_start: 'move',
    move_arrive: 'move',
    cancel: 'cancel',
    cancel_rejected: 'cancel',
    outage: 'outage',
    recovery: 'outage',
    commitment_withdrawn: 'outage',
    destination_change: 'change',
    idle: 'idle'
  };

  const typeLabel: Record<string, string> = {
    arrival: '到达',
    dispatch: '派车',
    dispatch_deferred: '等待派车',
    door_opening: '开门',
    door_open: '门开',
    door_closing: '关门',
    door_closed: '门关',
    alight: '下客',
    board: '上客',
    move_start: '驶离',
    move_arrive: '到达',
    cancel: '取消',
    cancel_rejected: '取消拒绝',
    outage: '停运',
    recovery: '恢复',
    commitment_withdrawn: '撤回承诺',
    destination_change: '目的地更正',
    idle: '待机'
  };
</script>

<div class="event-log">
  <div class="header">
    <strong>本 tick 离散事件依据</strong>
    <span>{events.length} 条</span>
  </div>
  {#if events.length === 0}
    <p class="empty">本 tick 无事件；时间线仍保留确定性状态快照。</p>
  {:else}
    <ol>
      {#each events as event}
        <li class={typeClass[event.type] ?? ''}>
          <div class="meta">
            <span class="badge">{typeLabel[event.type] ?? event.type}</span>
            {#if event.carId !== undefined}<span># {event.carId}</span>{/if}
            {#if event.requestId}<span>{event.requestId}</span>{/if}
            {#if event.eta !== undefined}<span>ETA {event.eta}</span>{/if}
          </div>
          <p>{event.message}</p>
          {#if event.reason}<small>依据：{event.reason}</small>{/if}
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .event-log {
    border: 1px solid #243044;
    border-radius: 0.9rem;
    background: rgba(15, 23, 42, 0.88);
    padding: 0.85rem;
    min-height: 260px;
    max-height: 560px;
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.55rem;
    color: #e5e7eb;
  }

  .header span {
    color: #94a3b8;
    font-size: 0.82rem;
  }

  ol {
    list-style: none;
    padding: 0;
    margin: 0;
    overflow: auto;
    display: grid;
    gap: 0.55rem;
  }

  li {
    border-left: 3px solid #64748b;
    background: rgba(30, 41, 59, 0.72);
    border-radius: 0.45rem;
    padding: 0.5rem 0.6rem;
  }

  p {
    margin: 0.25rem 0;
    font-size: 0.88rem;
    line-height: 1.45;
  }

  small {
    color: #94a3b8;
    line-height: 1.4;
    display: block;
  }

  .meta {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .meta span {
    font-size: 0.72rem;
    color: #cbd5e1;
    background: rgba(51, 65, 85, 0.82);
    border-radius: 999px;
    padding: 0.1rem 0.42rem;
  }

  .badge {
    font-weight: 900;
  }

  .dispatch { border-color: #38bdf8; }
  .move { border-color: #c084fc; }
  .door { border-color: #60a5fa; }
  .board { border-color: #fbbf24; }
  .alight { border-color: #4ade80; }
  .cancel { border-color: #fb7185; }
  .outage { border-color: #f97316; }
  .change { border-color: #22d3ee; }
  .arrival { border-color: #94a3b8; }
  .idle { border-color: #475569; }

  .empty {
    color: #94a3b8;
    font-size: 0.9rem;
  }
</style>
