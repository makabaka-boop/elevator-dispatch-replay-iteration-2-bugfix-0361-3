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
- 同一 tick 的固定顺序为：请求到达 → 取消 → 停运事件（按 carId）→ 恢复事件（按 carId）→ 新派车/撤回重派 → 轿厢推进。
- 事件日志记录每次请求到达、派车候选与依据、无可派车等待、开关门、上下客、空驶/载客移动、取消、取消拒绝、目的地更正、停运、恢复和承诺撤回。

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
- 目的地更正只改派未上车乘客：已上车批次（含停运冻结车内）按上车时锁定的目的层下车，
  同 tick 的取消/上下客/恢复与更正的先后顺序确定，快照可逐批核对；
- 同一输入重复计算得到完全相同的逐 tick 快照；
- 不同播放速度、跳转、变速后仍引用同一份预计算状态。


## 候梯目的地更正
场景 JSON 可加入 `destinationChanges: [{tick, requestId, destination}]`。

- 上车时该批乘客的目的层即被锁定进车内批次；更正只适用于生效时刻仍未上车的人，
  已上车的人（包括冻结在停运车内的）始终在上车时的目的层下车。
- 同一请求可分批乘坐不同车、遵守不同目的层；快照中每台车的 `onboard` 条目都带
  `destination`，`committedDropFloors`、行驶目标与派车 dry-run 均按批次锁定值计算。
- 更正在取消之后、停运/恢复之前生效；同 tick 的上下客发生在更正之后，因此当 tick
  上车的人锁定新目的层，当 tick 下车的人仍按旧约定下车。终态（完成/取消）不重新开放。
- 每次更正产生 `destination_change` 事件，记录原目的层、新目的层、受影响的未上车
  人数与保留原约定的车内批次，日志与逐 tick 快照可逐批核对目的地与人数。
- 旧场景（无 `destinationChanges`）逐帧兼容。

