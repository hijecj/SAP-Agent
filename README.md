# ABAP FS 🚀

**一个 VS Code 扩展，让 AI 助手能够真实、实时地访问你的 SAP 系统——读取实际代码、查询线上数据表、运行测试、调试，并理解你的自定义对象。**

> 问一句“BAPI_USER_GET_DETAIL 是怎么工作的？”，AI 会自动找到该函数、阅读代码、检查它在哪些地方被使用，并查看相关对象——你完全不用手动打开任何东西。

- 40 个专用 AI 工具，让 Copilot 深入了解 SAP
- 支持 GitHub Copilot、Cursor、Claude Code、Windsurf 等（通过 MCP）
- 完整开发工作流：编码、调试、测试、ATC、传输、Dump 分析——全部在 VS Code 内完成

## 演示

<video src="https://github.com/user-attachments/assets/2907690f-ba75-461e-9f54-c5832bbfde3c" width="600" controls></video>

- [🎯 这个项目有什么不同？](#这个项目有什么不同)

- [📖 文档](#文档)

- [🚀 安装](#安装)

- [前置条件](#前置条件)

- [安装步骤（自定义构建需要略有不同）](#安装步骤自定义构建需要略有不同)

- [✨ 主要功能](#主要功能)

- [🤖 AI 集成与聊天](#ai-集成与聊天)

- [📚 MCP 服务器（面向非 GitHub Copilot 用户）](#mcp-服务器面向非-github-copilot-用户)

- [🔍 对象管理](#对象管理)

- [🖥️ SAP GUI 集成](#sap-gui-集成)

- [📊 数据与分析](#数据与分析)

- [🧪 调试与测试](#调试与测试)

- [🧹 代码质量](#代码质量)

- [📦 传输与版本控制](#传输与版本控制)

- [🔧 开发者工具](#开发者工具)

- [📚 工作原理](#工作原理)

- [⚠️ 局限性](#局限性)

- [第三方库](#第三方库)

## 🎯 这个项目有什么不同？

**上下文感知**：直接连接到你的 SAP 系统。当你寻求帮助时，它会在你的真实系统中搜索、读取真实的函数签名、查询实际的数据表，并理解你的自定义对象。AI 不做猜测——它真的知道。

**自主调查**：AI 可以独立探索你的代码库。问一句“BAPI_USER_GET_DETAIL 是怎么工作的？”，它就会找到该函数、阅读代码、检查引用位置、查看相关对象——你无需手动打开任何东西。

**一体化工作流**：所有内容集中在一个地方——代码、SAP GUI 执行、调试、ATC 检查结果、运行时 Dump、性能跟踪、传输管理——无需在多个工具之间来回切换。AI 因为能接触到这一切，所以能帮助处理这一切。

**自然交互**：无需记忆命令或浏览菜单，直接用自然语言提问。“这个 BAPI 用在哪里？”“把所有名称中包含 'pricing' 的 Z 类列出来。”“运行 ATC 并解释结果。”AI 会自动选择合适的工具。

**面向现实**：针对老旧 SAP 系统的自动降级、可选的基于白名单的访问控制、遥测等特性，反映了真实世界的开发需求。

## 📖 文档

有关所有功能的详细文档，请参阅[文档站点](https://marcellourbani.github.io/vscode_abap_remote_fs/)。

它由 [docs](./docs/) 文件夹中的源文件生成。

要在本地查看，运行 `npm run docs`，然后在浏览器中打开生成的地址。

这需要安装 python 和 [uv](https://docs.astral.sh/uv/)。

## 🚀 安装

### 前置条件

- VS Code 1.90.0 或更高版本

- 已启用 ADT（ABAP Development Tools）的 SAP 系统

- GitHub Copilot 订阅（用于 AI 功能）

**注意：** 除非你的 SAP 系统相对较新（NetWeaver 7.51 或更高），否则写操作支持需要在开发服务器上安装 [abapfs_extensions 插件](https://github.com/marcellourbani/abapfs_extensions)。浏览和读取不需要它。

### 安装步骤（自定义构建需要略有不同）

1. **从 VS Code Marketplace 安装** — `Ctrl+Shift+X` → 搜索 “ABAP remote filesystem” → 安装

2. **配置连接** — `Ctrl+Shift+P` → **ABAP FS: Connection Manager** → 添加你的 SAP 系统

3. **连接** — `Ctrl+Shift+P` → **ABAP FS: Connect to an SAP system**

4. **跟随引导** — 首次安装时会出现，或通过 `Ctrl+Shift+P` → **Get Started: Open Walkthrough** → 搜索 “ABAP”

详细设置请参阅[安装指南](https://marcellourbani.github.io/vscode_abap_remote_fs/getting-started/installation/)。AI 子代理配置请参阅[子代理指南](https://marcellourbani.github.io/vscode_abap_remote_fs/ai/subagents/)。

## ✨ 主要功能

### 🤖 AI 集成与聊天

- **40 个语言模型工具** - Copilot 自动使用的后端工具

- **自主代理模式** - AI 独立探索你的代码库，无需手动导航

- **AI 子代理** - 将 ABAP 任务委派给专用代理（discoverer、reader、creator、code-reviewer 等），可通过配置模型来优化成本

- **上下文感知协助** - AI 理解你的 SAP 系统结构和对象

- **心跳监控** - 后台监控服务，监视 SAP 系统并发送提醒（Dump 告警、传输监视、定时提醒）

- **AI 技能包** - Copilot 在相关场景自动加载的专业知识包：

- **Clean ABAP** - SAP 官方编码规范，为 AI 提炼而成

- **代码编写流程** - 构建 ABAP 解决方案的结构化 6 步流程

- **性能（ECC/HANA）** - 系统特定的优化规则

- **SAP 研究** - 如何在 SAP 系统中导航和查找任何内容

- **SAP 定制** - 导航 SPRO/IMG 并将定制内容追溯到存储表

- **SAP 数据工作簿** - 创建多步骤数据分析笔记本

- **系统画像报告** - 分析并刻画任意已连接的 SAP 系统

- 可以这样提问：

- “BAPI_USER_GET_DETAIL 用在哪里？”

- “给我看看 ZCL_MY_CLASS 的代码”

- “查找所有名称中包含 'pricing' 的类”

- “运行 ATC 并解释结果”

- “创建一个带单元测试的新类”

### 📚 MCP 服务器（面向非 GitHub Copilot 用户）

- **兼容 Cursor、Claude Code、Windsurf、Claude Desktop** - 任何支持 MCP 的 AI 工具

- **暴露全部 40+ 工具** - 读代码、搜索、编辑代码、运行测试、分析 Dump 等

- **写支持** - MCP 客户端可以直接通过 `replace_string_in_abap_object` 编辑 ABAP 源码，并用 `get_abap_diagnostics` 验证

- **VS Code 作为宿主** - VS Code 保持打开，作为 SAP 连接桥

- 参见 [MCP 服务器文档](https://marcellourbani.github.io/vscode_abap_remote_fs/mcp-server/) 了解设置和完整限制

### 🔍 对象管理

- **统一对象搜索** - 支持通配符搜索所有 SAP 对象类型（支持 30+ 种类型）

- **编程式对象创建** - 创建类、程序、函数组、表、CDS 视图等

- **Where-Used 分析** - 查找所有对对象、方法、变量的引用，支持过滤

- **批量激活** - 一起激活多个相关对象

- **收藏夹** - 快速访问常用对象

### 🖥️ SAP GUI 集成

- **嵌入式 WebView GUI** - SAP GUI 直接嵌入 VS Code

- **桌面 GUI 集成** - 启动原生 SAP GUI 应用

- **Web 浏览器 GUI** - 在外部浏览器中打开 SAP GUI

- **事务执行** - 从 VS Code 运行任意 SAP 事务码

### 📊 数据与分析

- **SQL 查询浏览器** - 执行 ABAP SQL，带交互式结果（排序、过滤、导出）。生产系统在向 Copilot 发送数据前会弹出保护提示

- **SAP 数据工作簿** - VS Code 笔记本（`.sapwb` 文件），支持 ABAP SQL、JavaScript 和 Markdown 单元格，用于多步骤数据分析

- **运行时 Dump 分析** - AI 辅助错误调查，带根因分析

- **性能跟踪分析** - 自动检测瓶颈并给出优化建议

- **依赖关系图** - 交互式可视化 where-used 图，支持节点展开、过滤和导出

- **流程图** - 生成 Mermaid 图表（流程图、时序图、ER 图等）

### 🧪 调试与测试

- **ABAP 调试器** - 完整调试功能，支持断点、变量检查、多线程会话。生产环境防护会警告安全/稳定性风险

- **调试录制与回放** - 录制实时调试会话并离线回放，支持完整回退——就像调试界的 DVR。与同事分享 `.abaprecord` 文件

- **高级变量检查** - 基于模式的过滤（`LT_*`）、自动展开、作用域检查

- **单元测试运行器** - 执行并查看单元测试结果

- **测试类创建** - 为类生成测试 include

- **测试文档生成器** - 从 Playwright 测试截图生成专业的 Word 文档

### 🧹 代码质量

- **ATC 集成** - 运行代码质量检查，带 AI 辅助分析

- **ABAP Cleaner** - 自动化代码格式化和清理

- **语法验证** - 实时语法检查

- **文本元素管理器** - 读取/创建/更新可翻译的文本元素

### 📦 传输与版本控制

- **传输管理** - 查看、比较、释放传输请求，支持 AI 辅助

- **abapGit 集成** - ABAP 对象的 Git 版本控制

- **修订历史** - 查看和比较对象版本

- **Blame 侧边注释** - GitLens 风格的内联注释，显示每一行是谁在哪个传输中修改的（`Ctrl+Alt+B`）

### 🔧 开发者工具

- **SAP 连接管理器** - 现代化的 WebView 界面，用于管理连接，支持导入/导出、批量操作和 BTP 云支持

- **ADT 通信日志** - 捕获并可视化 VS Code 与 SAP 之间的所有 HTTP 流量，用于故障排查

- **ADT Feed 阅读器** - 实时监控 SAP 系统事件（Dump、ATC 结果、消息）

- **消息类编辑器** - 基于可视化表格的消息类编辑器

- **正则代码搜索** - 使用正则表达式在源码中进行高级搜索

- **跨系统比较** - 并排比较不同 SAP 系统中的 ABAP 对象

- **入门引导** - 从基础到高级 AI 功能的 4 阶段交互式指南

- **自定义编辑器** - HTTP 服务和消息类的专用编辑器

## 📚 工作原理

ABAP FS 提供两种交互模式：

| 模式 | 方式 | 示例 |
|---|---|---|
| **AI 工具**（40 个） | 在聊天中问 Copilot（`Ctrl+Shift+I`） | “BAPI_USER_GET_DETAIL 用在哪里？” |
| **命令** | 命令面板（`Ctrl+Shift+P`） | ABAP FS: 搜索对象 |

AI 工具由 Copilot 自动调用——你只需用自然语言提问。命令用于手动操作，例如连接系统、运行事务或激活代码。

参见[完整文档](https://marcellourbani.github.io/vscode_abap_remote_fs/)了解所有工具和命令的详细信息。

希望在企业内部署 ABAP FS（带访问控制、遥测或自定义构建）的组织，请参阅完整的[组织管理指南](docs/reference/org-admin.md)。

涵盖：

- SAP 系统白名单（限制用户可以连接的系统）

- Azure Application Insights 遥测（可选的中心化分析）

- 构建和分发自定义 VSIX 包

- 代理支持

**注意：** VS Code Marketplace 上的扩展不会向外部服务器发送任何遥测。所有使用数据仅存储在本地。

## ⚠️ 局限性

- **文本元素** - CREATE/UPDATE 仅适用于支持 ADT API 的新版 SAP 系统；旧系统降级到 GUI 操作

- **传输管理** - 旧系统上可能需要直接查询表（自动降级）

- **Copilot 代码搜索** - 只搜索已提交的代码，不包含未保存的本地修改

- **保存/激活** - 代码更改仅在用户手动保存（Ctrl+S、Keep 按钮等）或激活（激活按钮）时才保存到 SAP。不再随输入自动保存到 SAP

### 第三方库

- **[Mermaid](https://github.com/mermaid-js/mermaid)** (MIT) - 图表生成和可视化

- **[Tabulator](https://github.com/olifolkerd/tabulator)** (MIT) - 交互式数据表

- **[docx](https://github.com/dolanmiu/docx)** (MIT) - Word 文档生成

- **[Application Insights](https://github.com/Microsoft/ApplicationInsights-node.js)** (MIT) - 遥测 SDK

- **[Cytoscape.js](https://github.com/cytoscape/cytoscape.js)** (MIT) - 依赖关系图

- **[GitLens](https://github.com/gitkraken/vscode-gitlens)** (MIT) - `gitlens` blame 渲染模式借鉴了 MIT 许可的 GitLens 项目中非 Plus 版本的 blame 侧边注释样式和默认配置

- **[SAP Clean ABAP Style Guide](https://github.com/SAP/styleguides)** (CC BY 3.0) - Clean ABAP 编码规则（为 AI 提炼）

完整的许可信息请参阅 THIRD_PARTY_LICENSES.md。

**许可证：** MIT（见 LICENSE）
