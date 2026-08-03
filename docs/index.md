# ABAP FS — 在 VS Code 中进行 ABAP 开发

**ABAP FS** 是一个 VS Code 扩展，直接连接到你的 SAP 系统——让你（和你的 AI 助手）在不离开编辑器的情况下实时访问：读取代码、查询数据表、运行测试、调试和管理对象。

问 Copilot “BAPI_USER_GET_DETAIL 是怎么工作的？”，它会找到该函数、阅读代码、检查它在哪些地方被使用，并查看相关对象——全程自动，使用 40 个专用 SAP 工具。

如果你习惯使用 SE38、SE24 或 Eclipse 中的 ADT，ABAP FS 将同样的直接系统连接带入 VS Code——并加上 AI 辅助、现代化工具和完整的 VS Code 扩展生态。

> **GitHub 仓库：** [github.com/marcellourbani/vscode_abap_remote_fs](https://github.com/marcellourbani/vscode_abap_remote_fs)

---

## 你可以做什么

> **注意：** ABAP FS 有 40+ 个 AI 工具，但在你连接 SAP 系统之前，只有文档工具可用。使用连接管理器添加 SAP 连接，然后从命令面板运行 `ABAP FS: Connect to an ABAP system` 解锁所有工具。

这里是高层概览。完整功能页面请参阅左侧导航。

| 领域 | 能力 |
|------|-------------|
| **AI 驱动开发** | 40 个工具让 Copilot 深入了解 SAP——搜索对象、读代码、跑测试、解释 Dump，全部通过自然语言完成 |
| **编辑与激活** | 在真实系统上浏览、打开、编辑和激活 ABAP 对象 |
| **编辑器体验** | 增强的悬停信息、自定义编辑器、对象属性、专用 ABAP 视图/面板 |
| **调试** | 完整 ABAP 调试器，支持断点、变量检查、单步执行和调试录制 |
| **测试** | 运行单元测试、创建测试类、生成测试文档 |
| **代码质量** | ATC 分析、语法验证、where-used、ABAP Cleaner 格式化 |
| **传输** | 直接查看和管理传输请求 |
| **版本控制** | abapGit 集成、修订历史、blame 侧边注释 |
| **数据与 SQL** | 对 SAP 表运行 SQL 查询，构建多步骤数据工作簿 |
| **SAP GUI** | 从编辑器中启动嵌入式、原生或浏览器版 SAP GUI |
| **图表与文档** | 在 VS Code 内生成 Mermaid 图表和 ABAP 文档 |
| **开发者工具** | REPL、Dump/跟踪分析、正则搜索、依赖关系图、Feed 阅读器、通信日志、RAP 生成器 |

---

## 刚接触 ABAP FS？

1. [安装](getting-started/installation.md) — 安装扩展并连接你的 SAP 系统
2. [引导](getting-started/walkthrough.md) — 主要功能的引导式参观
3. [连接管理器](getting-started/connection-manager.md) — 管理多个 SAP 连接

---

## 使用非 GitHub Copilot 的 AI 工具？

支持 **Cursor、Claude Code、Windsurf、Claude Desktop** 以及任何兼容 MCP 的客户端。
参见 [MCP 服务器](mcp-server.md) 进行设置。

---

> **提示：** GitHub Copilot（以及任何通过 MCP 连接的 AI）都可以访问本文档。直接向你的 AI 助手询问任何功能，它就能引导你。
