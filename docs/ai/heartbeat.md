# 心跳服务 — 后台监控与提醒

> ⚠️ **测试版功能** — 如有问题请报告。

心跳是一个后台服务，按设定间隔运行 AI 代理来监控你的 SAP 系统并发送提醒。你配置要监控的内容；代理在后台安静地检查，只在有事发生时通知你。

**常见用途：**

- “DEV 中出现新的 ST22 Dump 时提醒我”
- “盯着传输 DEVK900001，直到它被释放”
- “明天上午 10 点提醒我审查批处理作业”

---

## 设置

心跳设置存储在工作区级别（`.vscode/settings.json`），不是全局的。每个工程可以有独立配置。

### 第 1 步：用 Copilot 配置（推荐）

大多数情况下你不需要手动编辑设置。让 Copilot 执行：

```
Set up heartbeat with model GPT-4o mini, every 5 minutes, and start it
```

Copilot 会用心跳工具为你配置并启动服务。

### 第 2 步：手动设置（可选）

打开 VS Code 设置（`Ctrl+,`）并添加：

```json
{
  "abapfs.heartbeat.model": "GPT-4o mini",
  "abapfs.heartbeat.every": "5m",
  "abapfs.heartbeat.enabled": true
}
```

| 设置 | 描述 | 默认 |
|---------|-------------|---------|
| `abapfs.heartbeat.enabled` | 启用/禁用服务 | `false` |
| `abapfs.heartbeat.model` | 后台检查用的 AI 模型——用便宜模型 | 必填 |
| `abapfs.heartbeat.every` | 检查间隔（`"5m"`、`"1h"`、`"30s"`） | `"5m"` |
| `abapfs.heartbeat.activeHours` | 只在这些时段运行 | `"08:00-18:00"` |
| `abapfs.heartbeat.maxConsecutiveErrors` | 连续 N 次错误后自动暂停 | `20` |

**推荐模型（经济高效）：**

- `GPT-4o mini` ⭐ 后台任务最可靠
- `Claude Haiku 4`
- `GPT-4o`

### 第 3 步：启动服务

让 Copilot：`"Start the heartbeat service"`

或在设置中把 `abapfs.heartbeat.enabled` 设为 `true`——服务自动启动。

### 第 4 步：添加任务

用自然语言让 Copilot 执行：

```
"Remind me tomorrow at 10am to review transport K900123"
"Monitor DEV100 for new ST22 dumps and alert me"
"Watch transport DEVK900001 until it's released"
```

Copilot 创建任务定义并保存到工作区根目录的 `heartbeat.json`。

---

## 状态栏

心跳运行时，VS Code 状态栏会出现一颗心 ❤️。

| 状态 | 含义 |
|--------|---------|
| ❤️（脉冲） | 运行中，等待下次检查 |
| ❤️ beat... | 正在执行检查 |
| ❤️ zzz | 已暂停（出错或在非活跃时段） |
| （隐藏） | 已停止 |

**点击这颗心**直接打开 `heartbeat.json`。

---

## 任务类型

### 提醒（一次性）

在预定时间通知一次，然后自动移除。

```
"Remind me in 2 hours to check the batch job"
"Remind me tomorrow at 9am about the deployment"
```

使用 `reminderOnly: true` 和 `startAt` 时间戳。心跳代理在 `startAt` 之前忽略该任务。

### 监控任务（循环）

每个间隔检查一次条件，只在发现**新**内容时提醒。

```
"Monitor for new ST22 dumps in QA100"
"Alert me when transport K900123 is released"
```

代理把已报告的内容存储在 `lastNotifiedFindings` 中，只对变化触发新提醒。

---

## 任务属性参考

| 属性 | 描述 |
|----------|-------------|
| `id` | 唯一标识 |
| `description` | 此任务监控或提醒的内容 |
| `connectionId` | SAP 系统 ID（例如 `"dev100"`） |
| `enabled` | 任务是否激活 |
| `category` | `transport`、`dump`、`job`、`reminder`、`custom` |
| `priority` | `high`、`medium`、`low` |
| `sampleQuery` | 代理要运行的 SQL 查询 |
| `checkInstructions` | 给代理的分步指令 |
| `startAt` | ISO 时间戳——此时间之前不检查 |
| `reminderOnly` | 通知一次后自动移除 |
| `removeWhenDone` | 条件满足时自动移除 |
| `cooldownMinutes` | 此时间段内不重复通知 |
| `alertThreshold` | 只有计数超过此值才提醒 |

---

## 示例任务定义

这些是存储在 `heartbeat.json` 中的 JSON 条目。可以让 Copilot 生成，也可以手动编写。

### 监控 ST22 Dump

```json
{
  "id": "task-st22-dumps",
  "description": "Monitor for new ST22 runtime dumps",
  "connectionId": "your-system-id",
  "category": "dump",
  "priority": "high",
  "checkInstructions": [
    "Use analyze_abap_dumps tool with action 'list_dumps'",
    "Compare dump IDs against lastNotifiedFindings",
    "Only alert for genuinely new dumps",
    "Update lastNotifiedFindings with current dump IDs"
  ],
  "cooldownMinutes": 30
}
```

### 盯传输直到释放

```json
{
  "id": "task-watch-transport",
  "description": "Watch transport DEVK900001 for release",
  "connectionId": "your-system-id",
  "category": "transport",
  "sampleQuery": "SELECT trkorr, trstatus FROM e070 WHERE trkorr = 'DEVK900001'",
  "checkInstructions": [
    "Execute the SQL query",
    "If trstatus = 'R', notify user and remove task",
    "If still 'D', update lastResult silently"
  ],
  "removeWhenDone": true
}
```

### 定时提醒

```json
{
  "id": "task-reminder-123",
  "description": "Review transport release process",
  "category": "reminder",
  "startAt": "2026-02-05T10:00:00.000Z",
  "reminderOnly": true
}
```

---

## 通过 Copilot 管理心跳

| 你想做什么 | 让 Copilot |
|---------------|-------------|
| 查看状态 | `"What's the heartbeat status?"` |
| 列出任务 | `"Show me the heartbeat watchlist"` |
| 添加任务 | `"Monitor DEV for stuck jobs"` |
| 移除任务 | `"Remove the transport monitoring task"` |
| 立即运行检查 | `"Trigger a heartbeat check now"` |
| 停止服务 | `"Stop the heartbeat service"` |

---

## 时区处理

当你说“明天上午 10 点提醒我”时，Copilot：

1. 用 `get_sap_system_info` 查询 SAP 系统的时区
2. 把你的本地时间转换为正确的 UTC 时间戳
3. 把结果存储在 `startAt`（例如 UTC+2 对应 `"2026-02-05T08:00:00.000Z"`）

这确保提醒相对于你的 SAP 系统在正确时间触发。

---

## 去重

代理会跟踪已提醒过的内容，避免重复通知：

- `cooldownMinutes` — 同一任务两次提醒之间的最小间隔
- `lastNotifiedFindings` — 已报告的 ID 或摘要

**Dump 监控示例流程：**

- 检查 1：5 个 Dump → 提醒：“发现 5 个新 Dump”
- 检查 2：同样 5 个 → 不提醒（已报告）
- 检查 3：7 个 Dump → 提醒：“发现 2 个新 Dump”

---

## 故障排查

**服务无法启动**

- 确认工作区设置中已设置 `abapfs.heartbeat.model`
- 确认 `abapfs.heartbeat.enabled` 为 `true`
- 检查 VS Code 输出面板 → “ABAP FS”查看错误

**任务未被检查**

- 确认工作区根目录存在 `heartbeat.json`（添加第一个任务时自动创建）
- 确认任务 `"enabled": true`
- 检查 `startAt` 是否在未来
- 检查当前时间是否在 `activeHours` 内

**提醒太多**

- 增加任务的 `cooldownMinutes`
- 设置 `alertThreshold` 过滤低数量问题
- 在 `checkInstructions` 中添加更具体的条件

**模型错误**

- 试试 `GPT-4o mini`——后台任务最可靠
- 某些模型在后台模式下调用工具不稳定
