# 面向外部 AI 工具的 MCP 服务器

> **前置条件：** 先完成[安装步骤](getting-started/installation.md)。你需要安装并配置了 ABAP FS、且至少有一个 SAP 系统连接的 VS Code。

> **注意：** ABAP FS 有 40+ 个 AI 工具。使用 VS Code 中的 GitHub Copilot 时，连接 SAP 系统后所有工具都可原生使用——不需要 MCP 服务器。MCP 服务器只用于外部 AI 客户端。

## 这是什么，为什么需要它？

**MCP（模型上下文协议）** 是一个开放标准，让 AI 工具可以调用外部服务。ABAP FS 通过本地 MCP 服务器暴露其 39 个 SAP 工具（搜索、读代码、跑测试、查询数据等），让 VS Code 之外的 AI 助手也能使用。

> **注意：** MCP 现在同时支持读取和写入 ABAP 代码。详见[写支持](#写支持)。

**如果你使用** Cursor、Claude Desktop、Claude Code 或 Windsurf 等 AI 工具，并希望它们拥有与 VS Code 内 GitHub Copilot 相同的 SAP 访问权限，请使用此功能。
也适用于 Cline/Continue/Roo code 等 VS Code AI 代理插件……除非它们支持[虚拟文件系统 API](https://code.visualstudio.com/api/extension-guides/virtual-workspaces)——据我所知目前只有 Copilot 支持。

**如果你只用 VS Code 中的 GitHub Copilot，则不需要** ——工具已原生可用。

```text
┌─────────────────┐     MCP 协议      ┌──────────────────┐     VS Code API     ┌─────────────┐
│  Cursor/Claude  │ ◄───────────────► │  MCP 服务器      │ ◄─────────────────► │  ABAP FS    │
│  桌面端等       │   localhost:4847  │  （在 VS Code 中）│                     │  工具       │
└─────────────────┘                   └──────────────────┘                     └─────────────┘
```

**VS Code 必须保持打开。** MCP 服务器在 VS Code 内运行——关闭 VS Code 会停止服务器。

## 设置

### 1. 启动 MCP 服务器

按 `Ctrl+Shift+P` 并运行：**ABAP FS: Start MCP Server**

就这样——服务器在默认端口（4847）上立即启动。通知会确认它正在运行。

> 如果你安装了 GitHub Copilot，ABAP FS 会询问你是否真的需要 MCP 服务器（Copilot 已原生拥有所有工具）。你可以选择照常启动或取消。

### 2.（可选）更改端口或添加 API 密钥

运行该命令会自动启用 `autoStart`——以后每次启动 VS Code 都会启动 MCP 服务器。你不需要为此修改设置。

如果需要更改端口或用 API 密钥保护服务器：

打开 VS Code 设置（`Ctrl+,`）并搜索 `abapfs.mcpServer`：

| 设置 | 描述 |
| ---------------------------- | --------------------------------------------------------------------------- |
| `abapfs.mcpServer.port` | 默认 `4847`——端口冲突时更改 |
| `abapfs.mcpServer.apiKey` | 可选。共享机器上建议设置，防止未授权的 SAP 访问 |

或直接添加到 `settings.json`：

```json
{
  "abapfs.mcpServer.port": 4847,
  "abapfs.mcpServer.apiKey": "your-secret-key"
}
```

### 2. 连接你的 SAP 系统

使用命令 `ABAP FS: Connect to an SAP system`（`Ctrl+Shift+P` 打开命令面板）。MCP 服务器需要活动的 SAP 连接才能服务工具请求。

### 3. 配置你的 AI 工具

在 AI 工具的 MCP 配置中添加以下内容。所有客户端的 URL 相同：

**Cursor** — `~/.cursor/mcp.json` 或工程 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "abap-fs": {
      "url": "http://localhost:4847/mcp"
    }
  }
}
```

**Claude Desktop** — 参见 Claude 文档了解配置文件位置，然后添加同样的配置块。

**其他 MCP 客户端** — 使用 Streamable HTTP 端点：`http://localhost:4847/mcp`

#### 使用 API 密钥认证

如果你设置了 `abapfs.mcpServer.apiKey`，客户端必须将其作为 Bearer token 发送：

```json
{
  "mcpServers": {
    "abap-fs": {
      "url": "http://localhost:4847/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-key"
      }
    }
  }
}
```

没有匹配的密钥时请求返回 `401 Unauthorized`。`/health` 端点始终无需认证即可访问。

### 4. 验证

在 AI 工具中问一些 SAP 相关的问题，例如：

- _“搜索包含 'USER' 的类”_
- _“显示 CL_ABAP_TYPEDESCR 的代码”_
- _“为 ZCL_MY_CLASS 运行单元测试”_

## 可用工具

暴露全部 40 个 ABAP FS 工具，包括：

| 工具 | 作用 |
| --------------------------- | ---------------------------------- |
| `search_abap_objects` | 按名称模式搜索对象 |
| `get_abap_object_lines` | 读取源代码 |
| `find_where_used` | Where-used 分析 |
| `run_unit_tests` | 执行 ABAP 单元测试 |
| `run_atc_analysis` | 运行 ATC 代码检查 |
| `execute_data_query` | 对 SAP 表运行 SQL 查询 |
| `manage_transport_requests` | 读取传输数据 |
| `abap_activate` | 激活 ABAP 对象 |
| `replace_string_in_abap_object` | 编辑 ABAP 源代码（查找并替换） |
| `get_abap_diagnostics` | 获取文件的语法错误/警告 |

## 写支持

MCP 客户端现在可以直接编辑 ABAP 源代码。工作流：

1. **获取文件 URI** — 用对象名称/类型/连接调用 `get_abap_object_workspace_uri`
2. **读取当前代码** — 调用 `get_abap_object_lines` 或 `search_abap_object_lines`
3. **编辑** — 用 URI、旧文本和新文本调用 `replace_string_in_abap_object`
4. **验证** — 用相同 URI 调用 `get_abap_diagnostics` 检查语法错误

编辑会立即同步到 SAP（ABAP FS 自动处理锁定、保存和解锁）。没有 keep/undo 界面——变更直接生效。

## 限制

- **VS Code 必须保持打开** — 服务器在 VS Code 内运行
- **需要活动 SAP 连接** — 工具需要已连接的系统
- **WebView 输出出现在 VS Code 中** — 数据查询或 Mermaid 图表等工具的结果作为 VS Code 面板打开，而不是在外部工具中
- **无导航功能** — 转到定义、查找引用和悬停文档需要 VS Code ABAP FS 集成
- **调试需要 VS Code** — ABAP 调试器是 VS Code 专属功能

## 故障排查

### 服务器无法启动

- 从命令面板运行 `ABAP FS: Start MCP Server` 手动启动
- 如果你之前选择了“禁用 MCP”，重新运行该命令——它会启动并重新启用自动启动
- 打开 VS Code 输出面板（`Ctrl+Shift+U`）并选择“ABAP FS”查看错误消息
- 如果 4847 已被占用，换一个端口（设置中的 `abapfs.mcpServer.port`）

### 工具不工作

- 确认 VS Code 已连接 SAP 系统
- 检查 VS Code 启动时是否出现了启动通知
- 确认 AI 工具配置中的 URL 与配置的端口匹配

### 401 未授权

- 检查 MCP 客户端是否配置了 `Authorization: Bearer <key>`
- 确认客户端中的密钥与 VS Code 设置中的 `abapfs.mcpServer.apiKey` 完全一致
