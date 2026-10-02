# 离线电梯群控模拟器

基于 **Svelte 4 + TypeScript + Vite + Vitest** 的纯前端离散事件模拟器。引擎先一次性计算完整 tick 时间线；页面播放、倍速、跳转都只读取预计算快照，不会重新派车或生成另一套状态。

## 功能

- 楼层 3～16；电梯 2～4；每台轿厢容量固定 6 人。
- 最多输入 100 个请求，每个请求包含：
  - `arrivalTick`：到达 tick，非负整数；
  - `origin`：出发层；
  - `destination`：目的层；
  - `people`：人数，正整数；
  - 可选 `cancelTick`：取消尚未上车乘客的 tick。
- 可选 `outageEvents`：按 tick 调度的电梯停运/恢复事件，每个事件包含：
  - `tick`：非负整数；
  - `carId`：电梯编号，从 `0` 开始；
  - `type`：`outage`（停运）或 `recovery`（恢复）；同一台电梯的停运必须按时间配对恢复。
- `travelTicks`：行驶一层耗时；`doorOpenTicks`：开门耗时；`doorCloseTicks`：关门耗时，均为正整数。
- 门未关闭前电梯不能移动。
- 新请求派车规则：
  1. 对每台电梯基于其当前状态和**已承诺停靠点**做确定性 dry-run；
  2. 计算该电梯最早可实际接到乘客的 tick；
  3. 先取最小 ETA，ETA 相同再取最小电梯 ID。
- 容量不足时按轿厢剩余空间部分上客；未上车乘客保留在同一承诺队列，不会消失。
- 未上车乘客可取消；已上车乘客不可取消。若一个大请求已经部分上车，取消只影响剩余未上车部分。
- 停运车冻结楼层、门/行驶相位和剩余耗时；已上车乘客与目的层承诺保留，未上车承诺撤回并只对其他可用车重新计算 ETA。全部电梯不可用时乘客继续等待，不取消。
- 恢复事件只解除冻结，车辆从当前相位继续，不补走停运期间路程；恢复后的车辆重新参与后续派车。
- 同一 tick 的固定顺序为：请求到达 → 取消 → 目的地更正 → 停运事件（按 carId）→ 恢复事件（按 carId）→ 新派车/撤回重派 → 轿厢推进。同一请求在同一 tick 至多允许一次目的地更正。
- 事件日志记录每次请求到达、派车候选与依据、无可派车等待、开关门、上下客、空驶/载客移动、取消、取消拒绝、停运、恢复、承诺撤回和目的地更正。

## 启动

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## 场景 JSON 示例

```json
{
  "floors": 10,
  "elevators": 3,
  "travelTicks": 2,
  "doorOpenTicks": 1,
  "doorCloseTicks": 1,
  "requests": [
    {
      "id": "R001",
      "arrivalTick": 1,
      "origin": 1,
      "destination": 8,
      "people": 6
    },
    {
      "id": "R002",
      "arrivalTick": 3,
      "origin": 6,
      "destination": 2,
      "people": 8,
      "cancelTick": 30
    }
  ],
  "outageEvents": [
    { "tick": 12, "carId": 0, "type": "outage" },
    { "tick": 15, "carId": 0, "type": "recovery" }
  ]
}
```

ID 可省略，系统按输入顺序生成 `R001`、`R002`……同 tick 新请求按 ID 升序处理，便于并列派车回放核对。

## 状态机语义

- `closed`：门关，可决定开门或开始移动。
- `opening`：开门中，持续 `doorOpenTicks`。
- 开门完成的同一 tick 执行上客/下客，并立即进入 `closing`。
- `closing`：关门中，持续 `doorCloseTicks`。
- `moving`：行驶中，持续 `travelTicks` 后只移动一层。
- 每一层移动、开门、关门都是独立、可逐 tick 回放的离散状态。
- 停运期间不执行任何相位推进；恢复时保持同一 `phase`、`phaseElapsed`、`targetFloor` 和方向。

## 测试

```bash
npm test
npm run check
```

Vitest 覆盖：

- 并列候选的 ETA 与电梯 ID tie-break；
- 同 tick 多请求的确定性派车；
- 容量 6 人时的部分上客、返回再服务余客与人数守恒；
- 仅取消未上车乘客、已上车乘客不可取消；
- 开门/关门期间不行驶；
- 行驶中停运时冻结位置、方向和剩余行驶耗时，恢复后不补行；
- 部分上客后停运时保留车内乘客，撤回余客承诺并改派给可用电梯；
- 全车停运时新乘客继续等待、恢复 tick 再派车；
- 同 tick 停运/恢复顺序确定，旧场景（无 `outageEvents`）快照逐帧不变；
- 目的地更正只改未上车乘客：已上车（含停运冻结车内）批次保留上车时目的层，同一请求可分批在不同楼层下车；
- 更正与取消、停运/撤回重派、上下客落在同一 tick 时，按固定顺序产生可归因的 `destination_change` 日志与逐批快照；
- 同一输入重复计算得到完全相同的逐 tick 快照；
- 不同播放速度、跳转、变速后仍引用同一份预计算状态。


## 候梯目的地更正
场景 JSON 可加入 destinationChanges: [{tick,requestId,destination}]。
更正只适用于事件生效时尚未上车的人；已上车的人保留上车时目的地，
同一请求可分批乘坐不同车。更正在取消之后、停运处理之前生效，终态不重新开放。

实现约定（便于调度员逐 tick 回放核对）：

- 每个请求的 `destination` 只表示“尚未上车的人”当前遵守的目的层约定；
- 乘客上车的瞬间，其目的层被冻结到该批次（车内按 `{requestId, remaining, destination}` 记录），
  之后的更正、撤单、停运/恢复都不会改写它——包括冻结在停运车内的批次；
- 因此一个请求的 6 人乘 #0 去 8 层、余客 4 人更正后乘 #1 去 2 层时，两台车的承诺下客点、
  SCAN 选层与实际下客楼层各自独立，人数合计仍守恒；
- 每次更正产生一条 `destination_change` 日志，携带 `fromFloor`/`toFloor` 与实际受影响
  （尚未上车）人数；生效时无人未上车（全部已上车或已完成/取消）则影响 0 人并说明原因；
- 请求快照新增 `onboardBatches: [{carId, people, destination}]`，逐批解释每台车内乘客实际
  遵守的目的层；车内下客层、等待乘客方向与后续派车 ETA 均以同一套批次约定为准。

播放与日志仍需逐批解释目的地和人数，保留旧场景逐帧兼容。

