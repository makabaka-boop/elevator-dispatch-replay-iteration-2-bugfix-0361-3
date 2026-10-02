<script lang="ts">
  import type { TickSnapshot } from '../engine/types';

  export let snapshot: TickSnapshot;

  const statusLabel: Record<string, string> = {
    pending: '未到达',
    waiting: '等待/余客',
    riding: '已上车',
    completed: '完成',
    cancelled: '已取消'
  };

  // Each onboard batch keeps the destination locked in at boarding time; one request
  // can therefore list several cars with different floors.
  function onboardBatches(requestId: string): string {
    const batches = snapshot.cars.flatMap((car) =>
      car.onboard
        .filter((entry) => entry.requestId === requestId)
        .map((entry) => `#${car.id}→${entry.destination}层(${entry.remaining}人)`)
    );
    return batches.length ? batches.join('，') : '—';
  }
</script>

<div class="request-panel">
  <div class="summary">
    <div><strong>{snapshot.totalWaiting}</strong><span>等待</span></div>
    <div><strong>{snapshot.totalRiding}</strong><span>轿厢中</span></div>
    <div><strong>{snapshot.totalCompleted}</strong><span>完成</span></div>
    <div><strong>{snapshot.totalCancelled}</strong><span>取消</span></div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>到达</th>
          <th>请求</th>
          <th>总数</th>
          <th>剩余</th>
          <th>车内</th>
          <th>完成</th>
          <th>取消</th>
          <th>余客派车</th>
          <th>车内批次（锁定目的层）</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {#each snapshot.requests as request}
          <tr class={request.status}>
            <td class="mono">{request.id}</td>
            <td class="mono">{request.arrivalTick}</td>
            <td class="mono">{request.origin}→{request.destination}</td>
            <td>{request.people}</td>
            <td>{request.remaining}</td>
            <td>{Math.max(0, request.boarded - request.completed)}</td>
            <td>{request.completed}</td>
            <td>{request.cancelled}</td>
            <td>{request.carId === null ? '—' : `#${request.carId}`}</td>
            <td class="mono">{onboardBatches(request.id)}</td>
            <td><span class="status">{statusLabel[request.status]}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .request-panel {
    border: 1px solid #243044;
    border-radius: 0.9rem;
    background: rgba(15, 23, 42, 0.88);
    overflow: hidden;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid #243044;
  }

  .summary div {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.65rem;
    border-right: 1px solid #243044;
  }

  .summary div:last-child {
    border-right: none;
  }

  .summary strong {
    font-size: 1.35rem;
    color: #7dd3fc;
  }

  .summary span {
    font-size: 0.78rem;
    color: #94a3b8;
  }

  .table-wrap {
    max-height: 360px;
    overflow: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }

  th,
  td {
    padding: 0.42rem 0.5rem;
    text-align: left;
    border-bottom: 1px solid rgba(51, 65, 85, 0.45);
    white-space: nowrap;
  }

  th {
    position: sticky;
    top: 0;
    background: #111827;
    color: #94a3b8;
    z-index: 1;
  }

  tr.waiting td {
    background: rgba(251, 191, 36, 0.06);
  }

  tr.riding td {
    background: rgba(74, 222, 128, 0.055);
  }

  tr.cancelled td {
    opacity: 0.62;
  }

  .status {
    border-radius: 999px;
    padding: 0.12rem 0.48rem;
    background: #334155;
    font-size: 0.74rem;
    font-weight: 800;
  }
</style>
