# ABAP FS 设置参考

本文档提供所有 ABAP FS 扩展设置的完整参考，供 AI 代理使用。AI 代理可以用它来帮助用户理解、配置和排查扩展问题。

---

## 目录

1. [SAP 系统连接设置](#1-sap-系统连接设置)
2. [趣味通知](#2-趣味通知)
3. [MCP 服务器设置](#3-mcp-服务器设置)
4. [嵌入式 GUI 设置](#4-嵌入式-gui-设置)
5. [ABAP Cleaner 集成](#5-abap-cleaner-集成)
6. [本地文件存储](#6-本地文件存储)
7. [AI 子代理](#7-ai-子代理)
8. [心跳服务](#8-心跳服务)
9. [Feed 订阅](#9-feed-订阅)
10. [Blame 注释](#10-blame-注释)
11. [编辑器默认值](#11-编辑器默认值)

---

## 1. SAP 系统连接设置

### 管理连接

**推荐：使用 SAP 连接管理器界面**

运行命令：`ABAP FS: Connection Manager`（或按 `Ctrl+Shift+P` 搜索它）

连接管理器提供可视化界面，可以：
- **添加**带引导表单的新 SAP 系统连接
- **编辑**现有连接
- **删除**连接（单个或批量）
- **导出**连接为 JSON 与团队成员共享
- **导入**来自 JSON 文件的连接
- 从服务密钥或端点**创建 BTP/云连接**
- **批量修改**多个连接的用户名
- **选择存储位置**：用户设置（全局）或工作区设置（工程专属）

**注意：** 密码**绝不**存储在设置文件中。首次连接时系统会提示用户输入密码，然后安全存储在操作系统的凭据管理器中。

---

### `abapfs.remote`

配置 SAP 系统连接的主要设置。这是一个对象，每个键是一个连接 ID（例如 `dev100`、`prod`），值包含连接详情。

| 属性 | 类型 | 默认值 | 最小/最大 | 描述 |
|----------|------|---------|---------|-------------|
| `url` | string | `"https://myserver:44300"` | - | SAP 开发服务器的 HTTP(S) URL。必须包含协议和端口。 |
| `username` | string | `"developer"` | - | 认证用 SAP 用户名。密码在运行时请求并安全存储。 |
| `client` | string | `"001"` | 3 个字符 | SAP client 编号（3 位数字）。 |
| `language` | string | `"en"` | 2 个字符 | 登录语言代码（ISO 639-1）。 |
| `atcapprover` | string | `""` | - | 豁免申请使用的默认 ATC（ABAP Test Cockpit）审批人用户名。 |
| `atcVariant` | string | `""` | - | 代码质量检查使用的默认 ATC 检查变式。 |
| `allowSelfSigned` | boolean | `false` | - | 接受自签名 SSL 证书。**降低连接安全性。** 仅用于开发服务器。 |
| `customCA` | string | `"/secrets/myCA.pem"` | - | 企业 CA 的自定义证书颁发机构证书文件（PEM 格式）路径。 |
| `diff_formatter` | string | `"ADT formatter"` | 枚举：`ADT formatter`、`AbapLint`、`simple` | 比较版本时使用的代码格式化器。 |
| `maxDebugThreads` | integer | `4` | 1-20 | 每个调试会话的最大并发调试线程数。 |

#### OAuth 子属性（用于 BTP/云系统）

| 属性 | 类型 | 必填 | 描述 |
|----------|------|----------|-------------|
| `oauth.clientId` | string | 是 | BTP 服务密钥中的 OAuth 2.0 客户端 ID。 |
| `oauth.clientSecret` | string | 是 | OAuth 2.0 客户端密钥。 |
| `oauth.loginUrl` | string | 是 | OAuth token 端点 URL。 |
| `oauth.saveCredentials` | boolean | 否 | 是否持久化 OAuth token。 |

#### SAP GUI 子属性

| 属性 | 类型 | 默认值 | 描述 |
|----------|------|---------|-------------|
| `sapGui.disabled` | boolean | `false` | 完全禁用 SAP GUI 集成。 |
| `sapGui.guiType` | enum | `"SAPGUI"` | GUI 类型：`SAPGUI`（桌面）、`WEBGUI_CONTROLLED`（浏览器，不暴露密码）、`WEBGUI_UNSAFE`（外部浏览器）、`WEBGUI_UNSAFE_EMBEDDED`（嵌入式 WebView）。 |
| `sapGui.server` | string | - | 应用服务器主机名（直接 SAP GUI 连接）。 |
| `sapGui.systemNumber` | string | - | 系统编号（2 位数字，用于直接连接）。 |
| `sapGui.group` | string | - | 登录组名称（负载均衡）。 |
| `sapGui.messageServer` | string | - | 消息服务器主机名（负载均衡）。 |
| `sapGui.messageServerPort` | string | `"3600"` | 消息服务器端口。 |
| `sapGui.routerString` | string | - | 用于防火墙连接的 SAP Router 字符串。 |

**GUI 类型选项：**
- `SAPGUI` - 使用桌面 SAP GUI（默认，最安全）
- `WEBGUI_CONTROLLED` - 在默认浏览器中使用 WebGUI（安全，不暴露密码）
- `WEBGUI_UNSAFE` - 在默认浏览器中使用 WebGUI（⚠️ 可能在 URL 中暴露密码）
- `WEBGUI_UNSAFE_EMBEDDED` - 在 VS Code 中使用嵌入式 WebGUI（⚠️ 可能暴露密码）。如果显示空白页，参见下面的 `abapfs.sapGui.useIntegratedBrowser`。

**示例配置：**
```json
{
  "abapfs.remote": {
    "dev100": {
      "url": "https://dev-server.company.com:44300",
      "username": "DEVELOPER",
      "client": "100",
      "language": "en",
      "allowSelfSigned": false
    }
  }
}
```

---

## 2. 趣味通知

### `abapfs.copilot.professionalNotifications`

| 属性 | 类型 | 默认值 | 描述 |
|----------|------|---------|-------------|
| `professionalNotifications` | boolean | `false` | 为 `true` 时，禁用通知上的趣味表情前缀，显示简洁的专业消息。默认禁用时，通知包含 "🎉 Activated!"、"✅ Tests passed!" 等俏皮表情。 |

**示例：**
```json
{
  "abapfs.copilot.professionalNotifications": true
}
```

---

## 3. MCP 服务器设置

MCP（模型上下文协议）服务器允许 Cursor、Claude Desktop、Eclipse ADT 等外部 AI 工具使用 ABAP FS 工具。

### `abapfs.mcpServer.autoStart`

| 属性 | 类型 | 默认值 | 描述 |
|----------|------|---------|-------------|
| `autoStart` | boolean | `false` | 扩展激活时自动启动 MCP 服务器。 |

### `abapfs.mcpServer.port`

| 属性 | 类型 | 默认值 | 最小/最大 | 描述 |
|----------|------|---------|---------|-------------|
| `port` | integer | `4847` | 1024-65535 | MCP HTTP 服务器的端口号。默认端口与其他服务冲突时更改。 |

### `abapfs.mcpServer.apiKey`

| 属性 | 类型 | 默认值 | 描述 |
|----------|------|---------|-------------|
| `apiKey` | string | `""` | MCP 服务器认证的 API 密钥。客户端必须将其作为 `Authorization: Bearer <key>` 发送。空值 = 无认证（共享机器上不推荐）。 |

**示例：**
```json
{
  "abapfs.mcpServer.autoStart": true,
  "abapfs.mcpServer.port": 4847,
  "abapfs.mcpServer.apiKey": "your-secret-api-key"
}
```

---

## 4. 嵌入式 GUI 设置

### `abapfs.autoOpenUnsupportedInGui`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `autoOpenUnsupportedInGui` | boolean | `true` | application | 在 SAP GUI 中自动打开不支持的对象类型（如仅 SAPGUI 的对象）。为 `false` 时，改为显示带手动选项的消息。 |

**示例：**
```json
{
  "abapfs.autoOpenUnsupportedInGui": true
}
```

### `abapfs.sapGui.useIntegratedBrowser`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `useIntegratedBrowser` | boolean | `true` | resource | 对 SAP GUI 使用 VS Code 的集成浏览器（Simple Browser）而不是嵌入式 WebView。如果嵌入式 WebView 因 SAP 点击劫持框架保护显示空白页，请启用此设置。默认启用 |

启用后，所有嵌入式 SAP GUI 操作（工具栏按钮、命令面板、运行事务）都会在 VS Code 的 Simple Browser 中打开，而不是 webview iframe。这可以避免某些 SAP 系统强制执行的点击劫持限制。

> **相关 VS Code 设置：** `simpleBrowser.useIntegratedBrowser`（实验性，仅桌面端）— 控制 VS Code 的 Simple Browser 本身是否使用集成浏览器引擎而不是 webview。两个设置一起启用可能提供最佳兼容性。

**示例：**
```json
{
  "abapfs.sapGui.useIntegratedBrowser": true
}
```

---

## 5. ABAP Cleaner 集成

与 [SAP ABAP Cleaner](https://github.com/SAP/abap-cleaner) 集成，用于自动代码格式化。

### `abapfs.cleaner`

| 子属性 | 类型 | 默认值 | 最小/最大 | 描述 |
|--------------|------|---------|---------|-------------|
| `enabled` | boolean | `false` | - | 启用 ABAP Cleaner 集成。还必须设置 `executablePath`。 |
| `executablePath` | string | `""` | - | `abap-cleanerc.exe`（命令行版本）的完整路径。**必填。** 示例：`C:\tools\abap-cleaner\abap-cleanerc.exe` |
| `profilePath` | string | `""` | - | 自定义清理配置文件（`.cfj` 文件）的路径。留空使用默认规则。 |
| `targetRelease` | enum | `"latest"` | `7.02`-`7.57`、`latest` | 目标 ABAP 版本。决定清理器可以使用哪些语言特性。使用较低版本可向后兼容。 |
| `showStatistics` | boolean | `true` | - | 处理后显示清理统计信息（修改数量）。 |
| `showAppliedRules` | boolean | `false` | - | 显示应用了哪些具体清理规则（详细输出）。 |
| `cleanOnSave` | boolean | `false` | - | 保存文件时自动清理 ABAP 代码。 |
| `lineRange.enabled` | boolean | `false` | - | 启用行范围清理（只清理选中的行）。 |
| `lineRange.expandRange` | boolean | `true` | - | 自动扩展范围以包含完整语句。 |
| `timeout` | number | `30000` | 5000-300000 | 清理操作的超时时间（毫秒）（30000ms = 30 秒）。 |

**示例：**
```json
{
  "abapfs.cleaner": {
    "enabled": true,
    "executablePath": "C:\\tools\\abap-cleaner\\abap-cleanerc.exe",
    "targetRelease": "7.57",
    "cleanOnSave": false,
    "showStatistics": true
  }
}
```

---

## 6. 本地文件存储

### `abapfs.localfs.preferGlobal`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `preferGlobal` | boolean | `false` | resource | 把非 ABAP 文件（如 AI 代理配置、以 `.` 开头的隐藏文件）存储在由所有工作区共享的全局文件夹中，而不是按工作区存储。便于跨工程共享 AI 代理配置。 |

**示例：**
```json
{
  "abapfs.localfs.preferGlobal": true
}
```

---

## 7. AI 子代理

子代理把专门的 ABAP 任务委派给更便宜/更快的 AI 模型，以降低成本并保留主代理的上下文窗口。

### `abapfs.subagents.enabled`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `enabled` | boolean | `false` | resource | 启用 AI 子代理以优化 ABAP 分析。Copilot 把任务委派给已配置的模型以降低成本。 |

### `abapfs.subagents.models`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `models` | object | `{}` | resource | 每个子代理的模型分配。使用 `manage_subagents` 工具配置（让 Copilot：“configure subagent models”）。 |

**注意：** 不先配置模型就无法启用子代理。请使用内置配置工具。

---

## 8. 心跳服务

后台监控服务，定期运行 LLM 检查 SAP 系统并发送提醒。

### `abapfs.heartbeat.enabled`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `enabled` | boolean | `false` | resource | 启用心跳服务。**必须先配置 `model`。** |

### `abapfs.heartbeat.every`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `every` | string | `"30m"` | resource | 心跳检查间隔。格式：数字 + 单位（`5m` = 5 分钟，`1h` = 1 小时，`30s` = 30 秒）。最小 1m，推荐 5-30m。 |

### `abapfs.heartbeat.model`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `model` | string | `""` | resource | **必填。** 心跳使用的语言模型。示例：`"GPT-4o mini"`、`"Claude Haiku 4"`。**用便宜模型以最小化成本！** |

### `abapfs.heartbeat.prompt`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `prompt` | string | `""` | resource | 自定义心跳提示。为空时使用工作区中的 `heartbeat.json` 监控列表自动构建提示。 |

### `abapfs.heartbeat.ackMaxChars`

| 属性 | 类型 | 默认值 | 最小/最大 | 作用域 | 描述 |
|----------|------|---------|---------|-------|-------------|
| `ackMaxChars` | number | `300` | 0-1000 | resource | `HEARTBEAT_OK` 响应后允许的最大字符数，超过则视为告警。防止误报。 |

### `abapfs.heartbeat.maxHistory`

| 属性 | 类型 | 默认值 | 最小/最大 | 作用域 | 描述 |
|----------|------|---------|---------|-------|-------------|
| `maxHistory` | number | `100` | 10-1000 | resource | 保留的最大心跳历史条数。较早的条目会被清理。 |

### `abapfs.heartbeat.maxConsecutiveErrors`

| 属性 | 类型 | 默认值 | 最小/最大 | 作用域 | 描述 |
|----------|------|---------|---------|-------|-------------|
| `maxConsecutiveErrors` | number | `20` | 1-50 | resource | 连续这么多错误后自动暂停心跳。防止反复失败导致成本失控。 |

### `abapfs.heartbeat.activeHours`

把心跳限制在活跃时段，节省非工作时间的成本。

| 属性 | 类型 | 默认值 | 描述 |
|----------|------|---------|-------------|
| `activeHours` | object | `null` | 把心跳限制在指定时段。 |
| `activeHours.start` | string | - | 开始时间，24 小时制（例如 `"08:00"`）。 |
| `activeHours.end` | string | - | 结束时间，24 小时制（例如 `"22:00"` 或 `"24:00"`）。 |
| `activeHours.timezone` | string | - | 时区：`"local"`、`"utc"` 或 IANA 时区（例如 `"America/New_York"`）。 |

### `abapfs.heartbeat.notifyOnAlert`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `notifyOnAlert` | boolean | `true` | resource | 心跳发现需要注意的内容时显示 VS Code 通知。 |

### `abapfs.heartbeat.notifyOnError`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `notifyOnError` | boolean | `true` | resource | 心跳遇到错误时显示 VS Code 通知。 |

**示例：**
```json
{
  "abapfs.heartbeat.enabled": true,
  "abapfs.heartbeat.model": "GPT-4o mini",
  "abapfs.heartbeat.every": "15m",
  "abapfs.heartbeat.activeHours": {
    "start": "08:00",
    "end": "18:00",
    "timezone": "local"
  },
  "abapfs.heartbeat.maxConsecutiveErrors": 10
}
```

---

## 9. Feed 订阅

用于监控 SAP 系统事件（传输、Dump 等）的 ADT feed 订阅。

**通过命令配置：** `ABAP FS: Configure Feeds`

### `abapfs.feedSubscriptions`

| 属性 | 类型 | 默认值 | 描述 |
|----------|------|---------|-------------|
| `feedSubscriptions` | object | `{}` | 按系统 ID → feed ID 组织的 feed 订阅。使用 Configure Feeds 命令便于设置。 |

#### 每个 feed 的属性

| 属性 | 类型 | 默认值 | 最小/最大 | 描述 |
|----------|------|---------|---------|-------------|
| `enabled` | boolean | `false` | - | 此 feed 是否被主动轮询。 |
| `pollingInterval` | number | `300` | 120-86400 | 轮询间隔（秒）（最小 2 分钟，最大 24 小时）。 |
| `notifications` | boolean | `true` | - | 为新 feed 条目显示通知。 |
| `notificationLevel` | enum | `"all"` | `all`、`error`、`warning`、`info` | 按严重级别过滤通知。 |
| `query` | string | `""` | - | 此 feed 的自定义查询过滤。 |
| `useDefaultQuery` | boolean | `true` | - | 使用 feed 的默认查询而不是自定义查询。 |

**示例：**
```json
{
  "abapfs.feedSubscriptions": {
    "dev100": {
      "runtime_errors": {
        "enabled": true,
        "pollingInterval": 300,
        "notifications": true,
        "notificationLevel": "error",
        "useDefaultQuery": true
      }
    }
  }
}
```

---

## 10. Blame 注释

GitLens 风格的文件 blame 注释可以用两种布局显示。渲染模式设置仅限全局，所以在用户设置中更改会影响所有工作区。

### `abapfs.blame.renderMode`

| 属性 | 类型 | 默认值 | 作用域 | 描述 |
|----------|------|---------|-------|-------------|
| `renderMode` | enum | `"gitlens"` | application | 控制文件 blame 注释的渲染方式。`classic` 保持原有的代码后内联布局。`gitlens` 在代码前使用固定的 GitLens 风格 blame 通道。 |

**允许的值：**
- `classic` - 现有 ABAP FS blame 布局，注释对齐在代码之后
- `gitlens` - GitLens 风格的固定 blame 通道，位于代码之前，带分组块和热力图边缘着色

**示例：**
```json
{
  "abapfs.blame.renderMode": "gitlens"
}
```

---

## 11. 编辑器默认值

ABAP FS 为 ABAP 文件设置推荐的编辑器默认值：

| 设置 | 默认值 | 描述 |
|---------|---------------|-------------|
| `editor.formatOnSave` | `true` | 保存时自动格式化 ABAP 代码（适用于 `[abap]` 文件）。 |
| `editor.hover.delay` | `700` | 显示悬停信息前的延迟（毫秒）。 |
| `editor.hover.above` | `false` | 在光标下方显示悬停内容。 |

这些设置会自动应用，但可以在用户设置中覆盖。

---

## 快速设置指南

### 第 1 步：添加 SAP 连接（最简单的方式）

1. 按 `Ctrl+Shift+P`
2. 运行 `ABAP FS: Connection Manager`
3. 点击“添加连接”
4. 填写服务器详情
5. 点击“保存”

### 第 2 步：连接 SAP

1. 按 `Ctrl+Shift+P`
2. 运行 `ABAP FS: Connect to an ABAP system`
3. 选择连接
4. 提示时输入密码（安全存储在操作系统凭据管理器中）

### 最小手动设置

```json
{
  "abapfs.remote": {
    "myserver": {
      "url": "https://your-sap-server:44300",
      "username": "YOUR_USERNAME",
      "client": "100",
      "language": "en"
    }
  }
}
```

### 启用心跳监控

```json
{
  "abapfs.heartbeat.enabled": true,
  "abapfs.heartbeat.model": "GPT-4o mini (copilot)",
  "abapfs.heartbeat.every": "15m"
}
```

### 启用 ABAP Cleaner

```json
{
  "abapfs.cleaner": {
    "enabled": true,
    "executablePath": "C:\\tools\\abap-cleaner\\abap-cleanerc.exe",
    "targetRelease": "latest"
  }
}
```

---

## 故障排查

| 问题 | 要检查的设置 | 解决方案 |
|-------|------------------|----------|
| 无法连接 SAP | `abapfs.remote.*.url`、`*.username` | 确认 URL 包含协议/端口、用户名正确。密码在运行时输入。 |
| SSL 证书错误 | `abapfs.remote.*.allowSelfSigned`、`*.customCA` | 开发环境设置 `allowSelfSigned: true`，或为企业 CA 提供 `customCA` 路径。 |
| 心跳无法启动 | `abapfs.heartbeat.model` | 必须先设置才能启用。使用 "GPT-4o mini" 等便宜模型。 |
| ABAP Cleaner 不工作 | `abapfs.cleaner.enabled`、`*.executablePath` | 两者都必须设置。确认 `abap-cleanerc.exe` 存在于该路径。 |
| 子代理被自动禁用 | `abapfs.subagents.models` | 为每个代理配置模型。用户可以让 Copilot“configure subagent models”。 |
| MCP 服务器连接被拒绝 | `abapfs.mcpServer.autoStart`、`*.port` | 确保 autoStart 为 true，确认端口未被其他应用占用。 |
| 密码未保存在设置中 | （设计如此） | 密码存储在操作系统凭据管理器中，而不是设置文件。 |

---

## 常用命令

| 命令 | 描述 |
|---------|-------------|
| `ABAP FS: Connection Manager` | 打开可视化连接管理界面 |
| `ABAP FS: Connect to an ABAP system` | 连接已配置的 SAP 系统 |
| `ABAP FS: Disconnect` | 断开所有 SAP 系统 |
| `ABAP FS: Configure Feeds` | 配置 ADT feed 订阅 |
| `ABAP FS: Search` | 搜索 ABAP 对象 |
| `ABAP FS: Show Blame` | 切换活动 ABAP 编辑器的文件 blame 注释 |
| `ABAP FS: Run in GUI` | 在 SAP GUI 中打开当前对象 |
| `ABAP FS: Run in Embedded GUI` | 在嵌入式 WebGUI 中打开事务 |

---

*本文档供 AI 助手使用，帮助用户配置 ABAP FS。*
