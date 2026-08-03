# 组织管理

要在企业内部部署 ABAP FS，请先配置以下可选功能，然后再构建和分发你自己的 VSIX。

---

## SAP 系统白名单（可选）

限制哪些 SAP 系统和用户可以连接——例如，阻止生产连接或限制为经过审批的开发人员。

### 1. 创建白名单文件

以 `client/src/services/whitelist.example.json` 为基础：

```json
{
  "version": {
    "minimumExtensionVersion": "1.0.0"
  },
  "allowedDomains": ["*dev*", "*test*", "*qa*"],
  "developers": [
    {
      "manager": "Team_Lead_Name",
      "userIds": ["developer1", "dev1_alt_id"]
    },
    {
      "manager": "Another_Manager",
      "userIds": ["developer2"]
    }
  ]
}
```

**`developers` 结构：** 每个对象代表**一个人**。把同一个人的所有 SAP 用户 ID（跨不同系统）列在同一个 `userIds` 数组中——在遥测中它们被视为同一个人。不要把不同的人混在一个对象里。

### 2. 托管文件

部署到内网 HTTP/HTTPS 地址，不需要认证。用户只需要读权限。

### 3. 配置 URL

编辑 `client/src/services/sapSystemValidator.ts`：

```typescript
private readonly WHITELIST_URL = 'https://your-internal-server.com/whitelist.json';
```

### 4. 启用校验

两个标志默认都是 `true`（跳过白名单）。设为 `false` 以强制限制：

```typescript
private readonly ALLOW_ALL_SYSTEMS = true;  // false = 按 allowedDomains 校验
private readonly ALLOW_ALL_USERS = true;    // false = 按 developers.userIds 校验
```

### 工作原理

- 扩展在启动时获取白名单，之后每 2 小时获取一次。
- `allowedDomains` 模式使用通配符（例如 `*dev*`），与 SAP 系统主机名匹配。
- `userIds` 会在所有开发者条目中检查。系统和用户都必须通过，连接才能成功。
- 如果获取失败，使用硬编码的备份白名单。
- 在公司 VPN 上，扩展启动后会重试最多 10 分钟；重试期间会显示状态栏通知。

---

## 使用 Application Insights 的遥测（可选）

**VS Code Marketplace 版本不向任何地方发送遥测。** 所有使用数据只写入本地 CSV 文件（扩展存储中的 `telemetry-YYYY-MM-DD.csv`）。数据不会离开机器。

本节仅适用于想为组织做**中心化分析**的情况。

### 收集什么

每个事件是一个动作字符串（例如 `command_activate_called`、`tool_search_abap_objects_called`），外加：

| 字段 | 描述 |
|---|---|
| 匿名用户 ID | `主机名 + 用户名 + 平台` 的 SHA 哈希——不可逆 |
| 会话 ID | 每次 VS Code 会话的随机 ID |
| 扩展版本 | 版本号 |
| VS Code 版本 | 版本号 |
| 平台 | Windows / Linux / Mac |
| SAP 系统 | 访问的系统（如适用） |
| 经理 / 团队 | 来自白名单 `developers` 映射（如配置） |

**不收集：** 凭证、源代码、对象名、业务数据、错误消息、性能指标、HTTP 请求、依赖或控制台日志。所有 Application Insights 自动收集功能默认禁用。

### 设置步骤

1. 在 GitHub 上 **fork 本仓库**。

2. 在你的 Azure 订阅中**创建 Azure Application Insights 资源**。

3. 从 Azure 门户**复制连接字符串**：Application Insights → 概述 → 连接字符串。

4. 在 `client/src/services/appInsightsService.ts` 中**设置连接字符串**：

   ```typescript
   const connectionString = "InstrumentationKey=YOUR-KEY;IngestionEndpoint=https://..."
   ```

5. **构建并分发**你的 VSIX（见下方[构建与分发](#构建与分发)）。

### 启用额外的自动收集

所有自动收集默认关闭。要启用以下任何一项，请编辑 `client/src/services/appInsightsService.ts` 中的 `initialize()` 方法：

| 功能 | 修改 |
|---|---|
| 异常跟踪 | `.setAutoCollectExceptions(false)` → `(true)` |
| 性能指标（CPU/内存） | `.setAutoCollectPerformance(false, false)` → `(true, true)` |
| HTTP 请求跟踪 | `.setAutoCollectRequests(false)` → `(true)` |
| 依赖跟踪 | `.setAutoCollectDependencies(false)` → `(true)` |

你也可以在代码的任何位置添加自定义跟踪：

```typescript
appInsights.defaultClient.trackEvent({ name: 'my_event' });
appInsights.defaultClient.trackException({ exception: error });
appInsights.defaultClient.trackMetric({ name: 'my_metric', value: 42 });
```

### 遥测与白名单集成

配置了白名单 `developers` 结构后，遥测会自动把属于同一个人的多个 SAP 用户 ID 分组。`manager` 字段支持团队级分析（例如“哪个团队调试用得最多？”），同时保持个人匿名。

### 事件如何存储和发送

- 事件首先记录到本地 CSV 文件。
- 如果配置了 App Insights 连接字符串，事件也会发送到 Azure（每 30 秒批量发送一次）。
- 如果网络不可用，事件存储在本地并重试。
- 本地存储每 5 分钟刷新一次，或缓冲区达到 25 条时刷新。

---

## 构建与分发

完成以上配置后：

1. **安装依赖：**

   ```bash
   npm install
   ```

2. **构建并打包：**

   ```bash
   # Windows（推荐）
   build-and-install.bat

   # 或手动：
   npm run compile
   npx vsce package
   ```

3. **分发**生成的 `.vsix` 文件给你的用户。他们可以通过扩展 → `...` → **从 VSIX 安装...** 安装。
