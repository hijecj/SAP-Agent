### MCP 服务器设置

**Ctrl+,** → 工作区选项卡 → 搜索 `abapfs.mcpServer`

1. 启用 `autoStart`，设置端口（默认：4847）
2. 在 AI 客户端配置中：
```json
{
  "mcpServers": {
    "abap-fs": { "url": "http://localhost:4847/mcp" }
  }
}
```

**支持：** Cursor、Claude Desktop、Claude Code、Windsurf。与 Copilot 相同的工具。

**安全：** 设置 `abapfs.mcpServer.apiKey` 进行认证访问。
