---
name: clock-integration
description: 与 PolarClock 番茄钟系统集成，获取用户任务、日程、番茄状态
version: 1.0.0
requires:
  clock-backend: "http://127.0.0.1:15550"
---

# Clock Integration

## 能力

- 查询用户当前任务列表和优先级
- 查看番茄钟状态（工作中/休息中/空闲）
- 读取日程安排（今日 Block + 三餐时间）
- 获取效率统计（高效时段、完成率）
- 创建/完成任务

## 工具列表

### 只读工具（走 /api/sync/*，只需用户名 + 可选 CLOCK_SYNC_KEY）
- `clock_get_user_context`: 通过 sync snapshot 一次性获取完整上下文（状态、日程、今日工作）
- `clock_get_timer_status`: 获取番茄钟当前状态
- `clock_get_schedule`: 获取今日日程（课程 Block + 三餐时间）

### 读写工具（需要用户 session token，即 X-Token）
- `clock_get_tasks`: 获取任务列表（可含已归档）
- `clock_create_task`: 创建新任务（字段: name, deadline, pomodor_total, tags）
- `clock_complete_task`: 标记任务完成

## 调用时机

Agent 应在以下场景主动调用：

- 用户说"帮我安排XX" → 先查日程再安排
- 用户说"我现在该做什么" → 查任务列表 + 番茄状态
- 用户闲聊时 → 查番茄状态判断是否在工作，调整语气
- 主动关怀时 → 查习惯打卡 + 效率统计

## 行为增强

根据 Clock 上下文调整 Agent 行为：

| 场景 | 检测条件 | 行为 |
|------|---------|------|
| 深度工作 | timer.state = "working" | 快速简洁回复，不闲聊 |
| 休息中 | timer.state = "break" | 可以闲聊，轻松语气 |
| 工作过量 | pomodoros_today >= 8 | 主动建议休息 |
| 任务规划 | 用户要求安排 | 结合日程和高效时段推荐 |
