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

1. [安装](#安装步骤) — 安装扩展并连接你的 SAP 系统
2. [引导](#入门引导) — 主要功能的引导式参观
3. [连接管理器](#sap-连接管理器) — 管理多个 SAP 连接

---

## 使用非 GitHub Copilot 的 AI 工具？

支持 **Cursor、Claude Code、Windsurf、Claude Desktop** 以及任何兼容 MCP 的客户端。
参见 [MCP 服务器](#面向外部-ai-工具的-mcp-服务器) 进行设置。

---

> **提示：** GitHub Copilot（以及任何通过 MCP 连接的 AI）都可以访问本文档。直接向你的 AI 助手询问任何功能，它就能引导你。

# 安装步骤

在继续之前，请确保满足[前置条件](prerequisite.md)。

> **注意：** ABAP FS 为 Copilot 注册了 40+ 个 AI 工具，但在你连接 SAP 系统之前，只有文档工具可用。先连接 SAP 才能解锁所有工具。

## 1. 安装扩展

1. 按 `Ctrl+Shift+X` 或点击活动栏上的扩展图标，打开**扩展**面板（左侧边栏）
2. 搜索 **murbani.vscode-abap-remote-fs** 或 **ABAP remote filesystem**
3. 点击**安装**，然后重启 VS Code

![安装说明](installationImage.png)

## 2. 配置 SAP 系统连接

1. 按 `Ctrl+Shift+P` 打开**命令面板**（VS Code 命令搜索栏）
2. 输入并运行：**ABAP FS: Connection Manager**
3. 在连接管理器窗口中，点击**添加 SAP 系统**并填写：
   - **URL** — 你的 SAP 系统 URL
   - **Client**、**Username**、**Language**
   - SAP GUI 设置（可选）
4. 选择连接保存的位置：
   - **用户设置** — 在你所有的 VS Code 工作区中可用
   - **工作区设置** — 仅存储在当前的工程目录中

**提示：**

- 密码存储在操作系统凭据管理器中，而不是设置文件中。
- 如果同事已经配置了连接，请让他们通过**导入/导出**导出并把 JSON 发给你。导出不包含用户 ID 和密码。你可以导入后用**批量操作**批量更新自己的凭证。
- 对于 SAP BTP 系统，使用**云支持**通过 BTP Service Key 或 Endpoint 创建连接。

## 3. 连接 SAP 系统

1. 按 `Ctrl+Shift+P` 并运行：**ABAP FS: Connect to an SAP system**
2. 选择你配置好的系统
3. 提示时输入密码
4. 稍等片刻，等待 VS Code 建立连接

## 密码管理

- **修改密码：** `Ctrl+Shift+P` → **ABAP FS: Change Connection Password** — 选择一个系统并输入新密码。
- **忘记密码：** `Ctrl+Shift+P` → **ABAP FS: Forget connection password** — 删除已存储的密码，下次连接时重新提示。

## 4. 验证连接

- 在**活动栏**（最左侧的垂直图标条）中查找 **ABAP FS** 图标
- 展开视图：**传输**、**Dump**、**ATC 结果**、**跟踪**、**abapGit**
- 测试对象搜索：`Ctrl+Shift+P` → **ABAP FS: Search for object**

## 更新

如果从 VS Code Marketplace 安装且启用了自动更新，扩展会自动更新。检查方法：打开扩展面板（`Ctrl+Shift+X`），找到该扩展，确认**自动更新**已开启。

# 入门引导

安装 ABAP FS 时，VS Code 会自动打开一个交互式引导。它以结构化的分步形式带你了解扩展的功能。

## 引导阶段

引导覆盖四个递进阶段：

1. **连接入门** — 激活扩展、连接 SAP 系统、浏览对象、搜索、运行事务、启动 SAP GUI。

2. **核心功能** — ABAP Cleaner、ATC 代码分析、Blame 注释、调试、Dump 分析、性能跟踪、传输管理、单元测试。

3. **AI 与 Copilot** — AI 驱动的搜索、数据查询、图表、where-used 分析、版本历史比较、AI 辅助单元测试和技能包。

4. **高级功能** — 通信日志、跨系统比较、调试录制与回放、依赖关系图、Feed 收件箱、心跳监控、MCP 设置、子代理、文本元素。

## 重新打开引导

引导只在首次自动显示一次。要再次打开：

1. 按 `Ctrl+Shift+P`（Windows/Linux）或 `Cmd+Shift+P`（Mac）打开**命令面板** — 所有 VS Code 命令的搜索栏。
2. 输入 **ABAP FS:Show Walkthrough** 并按 `Enter`。
3. 搜索 **ABAP** 并选择你想要的引导。

或者，从菜单栏打开**帮助 → 欢迎**，然后从列表中选择 ABAP FS 引导。

# SAP 连接管理器

> **重要：** ABAP FS 为 Copilot 提供了 40+ 个 AI 工具，但只有连接 SAP 系统后才能使用。使用连接管理器添加你的第一个系统。

连接管理器是一个用于添加、编辑和组织 SAP 系统连接的可视化界面。从命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`）输入 **ABAP FS: Connection Manager** 打开它。

## 添加连接

1. 打开命令面板（`Ctrl+Shift+P`）并运行 **ABAP FS: Connection Manager**。
2. 点击**添加连接**。
3. 填写必填字段（见下方[配置字段](#配置字段)）。
4. 选择保存位置：**用户设置**（在所有工作区可用）或**工作区设置**（仅当前工程）。
5. 点击**保存**。首次连接时会提示输入密码——密码安全存储在操作系统凭据管理器中，绝不在设置文件中。

## 配置字段

| 部分 | 字段 |
|---|---|
| **基本** | ADT URL、用户名、SAP client、语言 |
| **SSL** | 允许自签名证书、自定义 CA 证书 |
| **SAP GUI** | 服务器、系统编号、路由字符串、消息服务器、GUI 类型（桌面 / 嵌入式 WebGUI / 浏览器） |
| **OAuth** | Client ID、密钥、登录 URL |
| **高级** | ATC 审批人、ATC 检查变式、最大调试线程数、diff 格式化器 |

## 导入 / 导出

- **导出** — 将所有连接保存为 JSON 文件（不含密码），用于备份或与同事共享。
- **导入** — 合并来自之前导出的 JSON 文件的连接。
- **BTP Service Key** — 从 BTP Service Key JSON 文件创建连接。
- **BTP Endpoint** — 通过交互式 Cloud Foundry 登录流程创建连接。

## 批量操作

使用复选框选择多个连接，可以：

- **批量删除** — 一次移除多个连接。
- **批量修改用户名** — 同时更新多个连接的用户名。

任何批量操作执行前都会出现确认对话框。

## 密码管理

密码安全存储在操作系统凭据管理器中（绝不在设置文件中）。

| 命令 | 作用 |
|---|---|
| **ABAP FS: Change Connection Password** | 选择一个系统并输入新密码 |
| **ABAP FS: Forget connection password** | 删除已存储的密码，下次连接时重新提示 |

## 用户设置 vs 工作区设置

保存到**用户设置**的连接是全局的——会出现在你机器上的每个 VS Code 工作区中。保存到**工作区设置**的连接存储在工程目录的 `.vscode/settings.json` 中，方便按工程提交或共享。

# 面向外部 AI 工具的 MCP 服务器

> **前置条件：** 先完成[安装步骤](#安装步骤)。你需要安装并配置了 ABAP FS、且至少有一个 SAP 系统连接的 VS Code。

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

# ABAP 语言模型工具（AI 助手功能）

语言模型工具是 GitHub Copilot 在你于聊天中提问时自动使用的内置能力。你不直接调用这些工具——Copilot 根据你的问题选择并运行正确的工具。

**如何打开 Copilot 聊天：** `Ctrl+Shift+I`（新聊天）或 `Ctrl+L`（内联聊天）

确保你处于**代理模式**（不是 Ask 或 Edit）以获得完整工具访问。

## 连接要求

大多数工具需要活动中的 SAP 连接。未连接 SAP 系统时，工具会从 Copilot 隐藏以节省上下文 token。**abap_fs_documentation** 工具无论连接状态如何始终可用——用它询问功能和设置。

连接 SAP 系统（`Ctrl+Shift+P` → **ABAP FS: Connect to an ABAP system**）启用全部 40+ 个工具。

## 工作原理

输入问题时，Copilot 在后台选择合适的工具：

| 你问什么 | Copilot 使用的工具 |
|---|---|
| “BAPI_USER_GET_DETAIL 用在哪里？” | `find_where_used` |
| “给我看看 ZCL_MY_CLASS 的代码” | `get_abap_object_lines` |
| “查找所有名称含 'pricing' 的类” | `search_abap_objects` |
| “创建一个新类 ZCL_TEST” | `create_object_programmatically` |
| “对 ZTEST_PROG 运行 ATC” | `run_atc_analysis` |

## 可用工具

### 搜索与导航

1. **search_abap_objects** — 使用通配符按名称模式搜索对象（例如 `Z*PRICING*`、`BAPI_USER*`）
2. **get_abap_object_lines** — 从任意 ABAP 对象读取源代码。用 `methodName` 提取单个方法（例如 “显示 CL_SALV_TABLE 的 FACTORY 方法”）
3. **search_abap_object_lines** — 在源代码中搜索文本；支持正则，可列出类中的所有方法
4. **get_abap_object_info** — 获取对象元数据（类型、行数、缓存状态）
5. **get_batch_lines** — 一次调用读取多个对象的源代码
6. **get_object_by_uri** — 用 ADT URI 路径直接访问对象
7. **find_where_used** — 查找对象、方法或符号被引用的所有位置
8. **get_connected_systems** — 列出当前在 VS Code 中活动的 SAP 系统连接 ID

### 对象管理

9. **create_object_programmatically** — 创建新的 ABAP 对象（类、报表、函数组等）。注意：创建时仍会出现传输对话框。
10. **get_abap_object_url** — 为对象生成 SAP GUI WebGUI URL（对浏览器自动化有用）
11. **get_abap_object_workspace_uri** — 获取对象的 VS Code `adt://` URI（编辑前需要）
12. **open_object** — 在 VS Code 编辑器中打开对象
13. **abap_activate** — 编辑后激活 ABAP 对象（类似按 SE80 中的激活按钮）

### 代码质量与测试

14. **run_unit_tests** — 运行 ABAP 单元测试并在测试面板显示结果
15. **create_test_include** — 为现有类创建单元测试类 include
16. **run_atc_analysis** — 对对象运行 ATC（ABAP Test Cockpit）代码质量检查
17. **get_atc_decorations** — 读取编辑器中当前可见的 ATC 警告/错误高亮

### 传输与文本

18. **manage_transport_requests** — 获取传输详情、列出用户传输、比较传输。旧系统自动降级为直接 SQL。
19. **manage_text_elements** — 在程序、类或函数组中读取、创建或更新文本元素。所有系统支持 READ；CREATE/UPDATE 需要新版系统。

### 数据与 SQL

20. **execute_data_query** — 运行 ABAP SQL 查询并在交互式表格视图中显示结果
21. **get_abap_sql_syntax** — 获取 ABAP SQL 语法规则（Copilot 在编写查询前调用，避免语法错误）

### 图表

22. **create_mermaid_diagram** — 生成并显示流程图、时序图、ER 图等
23. **validate_mermaid_syntax** — 检查 Mermaid 图表代码的语法错误
24. **get_mermaid_documentation** — 获取特定图表类型的 Mermaid 语法参考
25. **detect_mermaid_diagram_type** — 从代码自动检测 Mermaid 图表类型

### 运行时分析

26. **analyze_abap_dumps** — 列出并分析 ST22 运行时错误
27. **analyze_abap_traces** — 分析性能跟踪；自动检测瓶颈
28. **get_version_history** — 查看版本历史、获取过去版本的源代码，或比较对象的两个版本

### 调试

29. **abap_debug_session** — 启动或停止 ABAP 调试会话
30. **abap_debug_breakpoint** — 设置或移除断点（支持条件）
31. **abap_debug_step** — 单步跳过、单步进入、单步返回或继续执行
32. **abap_debug_variable** — 在调试会话中检查变量值和内表内容
33. **abap_debug_stack** — 查看当前调用栈
34. **abap_debug_status** — 检查调试会话是否活动

### 系统与扩展

35. **get_sap_system_info** — 获取 SAP 系统详情：client、版本、系统类型（S/4HANA vs ECC）、时区。结果缓存 24 小时。用**刷新 SAP 系统信息缓存**命令清除缓存。
36. **abap_fs_documentation** — 搜索 ABAP FS 扩展文档和设置参考
37. **adt_discovery_export** — 把已连接 SAP 系统的完整 ADT 发现树导出为 markdown 文件，用于 API 调研
38. **manage_subagents** — 配置 AI 子代理，把任务委派给更便宜/更快的模型以降低 API 成本
39. **manage_heartbeat** — 控制后台心跳监控服务（添加监控任务、设置提醒、查看状态）

### 文档

40. **create_test_documentation** — 从 Playwright 测试截图生成 Word 文档，按场景组织

# 用于优化 ABAP 开发的 AI 子代理

AI 子代理是专用的 AI 助手，每个专注于一种 ABAP 任务（查找对象、读取代码、运行分析等）。不同于让一个通用 AI 做所有事，子代理将工作拆分给专注的专家。

**为什么重要：**

- **更好的结果** — 专门的代码审查者比同时处理多个目标的通用助手能发现更多问题
- **更长的对话** — 重操作在独立的上下文中运行，你的主聊天保持流畅
- **更低的成本** — 简单任务（搜索、读取）使用更便宜/更快的模型；复杂任务使用更聪明的模型

## 可用子代理

| 代理 | 职责 | 层级 |
|-------|-------------|------|
| `abap-orchestrator` | 任务路由、编写所有代码、协调其他代理 | 3（高级） |
| `abap-code-reviewer` | 深度代码审查——安全、性能、最佳实践 | 3（高级） |
| `abap-usage-analyzer` | Where-used 分析、依赖、变更影响 | 2（中级） |
| `abap-quality-checker` | ATC 分析、单元测试、代码健康度 | 2（中级） |
| `abap-historian` | 版本历史、传输请求 | 2（中级） |
| `abap-debugger` | 运行时调试——断点、单步执行 | 2（中级） |
| `abap-troubleshooter` | 分析 Dump、跟踪、性能问题 | 2（中级） |
| `abap-data-analyst` | 查询 SAP 表、分析数据模式 | 2（中级） |
| `abap-discoverer` | 按名称/模式查找 ABAP 对象 | 1（便宜/快速） |
| `abap-reader` | 读取并从源码中提取信息 | 1（便宜/快速） |
| `abap-creator` | 创建新的 ABAP 对象（骨架） | 1（便宜/快速） |
| `abap-visualizer` | 从代码创建图表 | 1（便宜/快速） |
| `abap-documenter` | 生成技术文档 | 1（便宜/快速） |

## 如何使用子代理

在 GitHub Copilot 聊天中输入 `@abap-orchestrator` 开始。orchestrator 是唯一直接在聊天下拉框中暴露的代理——它会按需自动调用其他代理。

```
@abap-orchestrator analyze ZCL_ARTICLE_HANDLER and suggest improvements
```

例如，orchestrator 可能会：

1. 委派“查找相关类” → `abap-discoverer`（便宜、快速）
2. 委派“读取代码” → `abap-reader`（便宜、快速）
3. 委派“用量分析” → `abap-usage-analyzer`（中级）
4. 自己综合发现并编写建议（高级）

需要时你也可以直接用 `@agent-name` 调用其他子代理。让 Copilot 把某个代理加到下拉框中——它可以更新该代理的 `.agent.md` 文件来启用。

## 设置

> 子代理配置存储在工作区级别的 `.vscode/settings.json` 和 `.github/agents/` 中。每个工程可以有独立配置。

正常使用中，你不需要手动编辑这些文件。Copilot 可以通过聊天命令配置模型、生成/更新代理文件、校验它们，以及启用/禁用子代理。

### 第 1 步 — 配置模型

让 Copilot 执行：

```
Configure subagents for ABAP development
```

Copilot 会为每个层级建议模型，并在应用前征求确认。推荐分配：

| 层级 | 代理 | 示例模型 |
|------|--------|---------------|
| 1 — 便宜/快速 | discoverer、reader、creator、visualizer、documenter | Claude Haiku 4.5、Gemini 3 Flash |
| 2 — 中级 | usage-analyzer、quality-checker、historian、debugger、troubleshooter、data-analyst | GPT-4o、Claude Sonnet 4 |
| 3 — 高级 | orchestrator、code-reviewer | Claude Sonnet/Opus 4.6、GPT-5.4 |

**避免给第 1 层代理分配高级模型**——这会消除成本优势，且对简单任务没有效果提升。

### 第 2 步 — 启用子代理

让 Copilot 执行：

```
Enable subagents
```

这会在 `.github/agents/` 中创建代理文件并验证它们。

### 第 3 步 — 允许代理委派（如果提示）

你可能会看到要求启用 `chat.customAgentInSubagent.enabled` 的通知。点击**启用设置**——这允许 orchestrator 调用其他代理。

## 管理子代理

所有管理都通过 Copilot 聊天完成：

| 你想做什么 | 怎么问 |
|---------------|-------------|
| 查看当前状态 | `Show subagent status` |
| 禁用所有代理 | `Disable subagents` |
| 重新启用代理 | `Enable subagents` |
| 更换模型 | `Change abap-discoverer to use GPT-4o` |
| 查看可用模型 | `What models can I use for subagents?` |
| 查看可用工具 | `List available tools for subagents` |

禁用子代理时，代理文件会移到 `agents_disabled/`（不会删除）。重新启用会恢复它们并保留你的自定义配置。

## 自定义代理工具

`.github/agents/` 中每个代理的 `.agent.md` 文件定义了它能使用的工具。你可以直接编辑这些文件，或让 Copilot 来做：

```
Add the abap-trace tool to abap-troubleshooter
```

修改在禁用/重新启用循环中保留——更换模型时只会更新 `model:` 行。

✅ **用户控制**：你决定每个代理层级使用哪些模型

## 需要注意的事

⚠️ **模型可用性**：列表中显示的某些模型可能不可用（例如 “GPT-4o mini”）。系统会验证，检测到错误时自动禁用。

⚠️ **需要 VS Code 设置**：委派必须启用 `chat.customAgentInSubagent.enabled`，否则主代理的模型可能被用于所有子代理，导致大量高级请求用量。

⚠️ **工作区专属**：设置和代理文件是按工作区的，不是全局的。

⚠️ **代理文件在 Git 中**：`.github/agents/` 文件夹会出现在你的版本控制中——不想共享就加入 `.gitignore`。

⚠️ **常用代理**：像 `abap-discoverer` 和 `abap-reader` 这样的代理调用频繁——给它们用昂贵模型会抵消成本优势。

## 故障排查

### “无法启用子代理 - 缺少模型”
所有 13 个代理都必须配置模型。让 Copilot 配置缺失的代理。

### 代理文件显示验证错误
某些模型名称对代理文件无效。换一个模型试试（例如用 `Claude Haiku 4.5` 代替 `GPT-4o mini`）。

### 子代理被自动禁用
当配置的模型不可用时会发生。用可用模型重新配置。

### 禁用后资源管理器中仍有幽灵文件
这是 VS Code 刷新问题。扩展会自动刷新资源管理器，但偶尔你可能需要折叠/展开文件夹。

### 委派没有使用自定义代理
确保你的 VS Code 设置中 `chat.customAgentInSubagent.enabled` 为 `true`。

# AI 技能包

技能包是内置的“速查表”，当你的问题或任务与其领域匹配时，Copilot 会自动读取它们。它们包含 ABAP 专属知识——编码规范、性能规则、SAP 导航技巧——这样你就不必自己解释这些上下文。

Copilot 只在相关时加载技能包的完整内容，所以技能包再多也不会拖慢无关对话。

## 使用技能包

**自动：** 当 Copilot 检测到匹配时，技能包会自动加载。无需任何操作。

**手动：** 在 Copilot 聊天输入框中输入 `/`，查看所有技能包的斜杠命令。选择其中一个显式调用，例如：

- `/clean-abap review this method`
- `/abap-research find the transaction for this screen`

## 可用技能包

| 技能包 | 斜杠命令 | 何时加载 |
|---|---|---|
| [Clean ABAP](#clean-abap) | `/clean-abap` | 编写或审查 ABAP 代码时 |
| [代码编写流程](#代码编写流程) | `/abap-code-writing` | 构建任何 ABAP 解决方案时 |
| [性能（ECC）](#性能ecc) | `/abap-performance-ecc` | 非 HANA 系统（Oracle、DB2、MSSQL） |
| [性能（HANA）](#性能hana) | `/abap-performance-hana` | S/4HANA / HANA DB 系统 |
| [SAP 研究](#sap-研究) | `/abap-research` | 搜索对象、事务、消息时 |
| [系统画像报告](#系统画像报告) | `/sap-system-personality-report` | 分析系统的自定义代码版图时 |
| [SAP 定制](#sap-定制) | `/sap-customizing` | SPRO/IMG 设置和配置表 |
| [SAP 数据工作簿](#sap-数据工作簿) | `/sap-data-workbook` | 多步骤 SAP 数据分析 |

---

### Clean ABAP

SAP 官方的 [Clean ABAP 风格指南](https://github.com/SAP/styleguides) 浓缩为 AI 优化规则。涵盖命名规范、现代语法、类/方法设计、错误处理、格式化和单元测试模式。

### 代码编写流程

构建 ABAP 解决方案的结构化流程：验证需求 → 探索系统 → 规划架构 → 调研现有对象 → 设计 → 编写代码。防止 AI 猜测参数，或重新实现 SAP 标准中已存在的功能。

### 性能（ECC）

传统数据库（Oracle、DB2、MSSQL、MaxDB）的性能模式。涵盖简单 SQL、缓冲、索引使用和内部表优化。Copilot 会自动检查系统类型，只在非 HANA 系统上加载此技能包。

### 性能（HANA）

S/4HANA 的性能模式。涵盖代码下推、CDS 视图、AMDP 和复杂 SQL 聚合。Copilot 会自动检查系统类型，只在基于 HANA 的系统上加载此技能包。

### SAP 研究

教会 Copilot 在陌生的 SAP 系统中找到任何东西——就像资深开发人员那样。涵盖针对不同目标应查询哪些元数据表（事务用 TSTCT、消息用 T100、所有对象用 TADIR、表字段用 DD03L）、通配符策略、包聚类，以及把错误消息追溯到代码。

### 系统画像报告

生成任意已连接 SAP 系统的结构化概览：自定义对象数量、开发最多的业务领域、近期 Dump 活动等。有助于快速了解陌生系统。

### SAP 定制

教会 Copilot 导航 SPRO/IMG 配置。使用系统化的查找流程，从 SPRO 活动追溯到其存储表（通过 `CUS_IMGACH`、`CUS_ACTH`、`CUS_ACTOBJ`），反向查找表对应的 SPRO 路径，并解析域固定值（`DD07T`）。

### SAP 数据工作簿

教会 Copilot 创建 `.sapwb` 文件——结合 ABAP SQL 和 JavaScript 单元格的 VS Code 笔记本，用于多步骤 SAP 数据分析。关于工作簿功能本身的详细信息，参见 [SAP 数据工作簿](#sap-数据工作簿sapwb)。

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

# 增强的悬停信息

当你在编辑器中将鼠标光标移到 ABAP 代码上并停留时，会弹出一个显示光标下符号信息的弹窗。这叫做**悬停**。

## 如何触发悬停

把鼠标移到任意 ABAP 关键字、变量、系统字段或对象名称上，等待约 700 毫秒（不到一秒）。弹窗自动出现——无需点击。

## 悬停显示什么

取决于你悬停的内容，你可能会看到：

| 符号类型 | 显示的信息 |
|---|---|
| 系统字段（`sy-subrc`、`sy-tabix` 等） | 字段用途的通俗解释 |
| 内置类型 | 类型描述和长度 |
| 变量和数据对象 | 类型、长度和声明上下文 |
| 函数模块 | 参数列表（导入、导出、异常） |
| 类和方法 | 签名和可见性 |
| 其他对象 | 来自 SAP 系统的元数据 |

## 配置

悬停延迟可配置。如果弹窗出现得太快或太慢，在 VS Code 设置（**文件 → 首选项 → 设置**）中搜索 `abapfs hover` 调整延迟。

# 增强的视图与面板

ABAP FS 为 VS Code 界面添加了多个视图和面板。先快速了解一下 VS Code 的布局：

- **活动栏** — 最左侧的垂直图标条。点击图标在侧边栏中打开对应视图。
- **资源管理器** — 文件/文件夹树，通过顶部活动栏图标打开。ABAP FS 在这里添加了额外部分。
- **面板** — 编辑器底部区域（与终端同一区域）。ABAP FS 在这里添加了文档面板。

---

## 活动栏视图

它们以图标形式出现在活动栏中。点击即可在侧边栏中打开视图。

| 视图 | 用途 |
|------|---------|
| **对象搜索** | 按名称、类型或包搜索 ABAP 对象，支持过滤 |
| **传输** | 浏览和管理传输请求 |
| **Dump** | 查看和分析运行时错误（ST22） |
| **ATC 结果** | 查看 ABAP Test Cockpit 代码质量检查的结果 |
| **跟踪** | 分析性能跟踪 |
| **S/4HANA 就绪** | 显示代码 S/4HANA 兼容性发现的仪表盘 |
| **abapGit** | 管理与系统链接的 abapGit 仓库 |
| **Feed 收件箱** | 订阅并查看 ADT feed 通知 |
| **RAP 生成器** | 从数据库表生成 RAP（RESTful ABAP 编程）服务，类似 Eclipse |
| **对象属性** | 显示当前打开的 ABAP 对象的属性、分配的传输和修订历史 |

## 资源管理器视图

它们以可折叠部分的形式出现在资源管理器侧边栏（文件树）中。

| 视图 | 用途 |
|------|---------|
| **收藏夹** | 固定常用对象以便快速访问 |

## 面板视图

它们出现在底部面板区域，与终端并列。

| 视图 | 用途 |
|------|---------|
| **ATC 文档** | 显示在 ATC 结果视图中选中的 ATC 检查结果的详细 SAP 文档 |

# 对象属性视图

对象属性视图显示当前在编辑器中打开的 ABAP 对象的元数据和历史——类似 ABAP Development Tools（Eclipse）中的属性视图。

## 打开视图

点击**活动栏**（左侧边栏）中的 ABAP FS 图标，然后选择**对象属性**面板。切换 ABAP 文件时视图会自动更新。

## 显示什么

| 部分 | 详情 |
|---|---|
| **对象元数据** | 类型、包、负责人、创建日期、对象 URI |
| **锁定状态** | 对象是否被锁定，被谁锁定 |
| **传输历史** | 包含此对象的所有传输请求 |
| **修订历史** | 每个已保存的版本——作者、日期和传输编号 |

## 比较修订

1. 在**修订历史**部分勾选任意两个版本旁的复选框。
2. 编辑器中打开并排 diff，精确显示两者之间的变化。

## 性能说明

属性数据在首次加载后缓存。如果切回已查看过的对象，扩展会复用缓存数据而不是再次查询 SAP。

# 自定义编辑器

ABAP FS 为某些 SAP 对象类型提供自定义的可视化编辑器。无需编辑原始 XML，你会得到一个为该对象量身定制的专用界面。

导航到支持的对象类型时，自定义编辑器会自动打开。你也可以通过**打开方式**（在资源管理器中右键文件）手动打开。

## 支持的编辑器

### 消息类编辑器（`*.msagn.xml`）

用于 SAP 消息类（MSAG）的基于表格的编辑器。无需接触 XML 即可添加、编辑和删除消息。

完整详情见[消息类编辑器](#消息类编辑器)。

### HTTP 服务编辑器（`*.http.xml`）

用于配置 SAP HTTP 服务（SICF 节点）的基于表单的编辑器。

## 常用操作

| 操作 | 方式 |
|--------|-----|
| 保存修改 | `Ctrl+S` |
| 切换到原始 XML | 右键文件 → **打开方式** → **文本编辑器** |
| 还原未保存的修改 | **文件** → **还原文件** |

# 消息类编辑器

消息类（事务 SE91）在自定义表格编辑器中打开，而不是原始 XML，让你可以直接在 VS Code 中轻松查看和维护消息。

## 打开消息类

使用 ABAP FS 文件资源管理器搜索你的消息类（例如 `ZMY_MESSAGES`）——它会自动在表格编辑器中打开。你也可以直接打开任意 `.msagn.xml` 文件。

## 处理消息

| 操作 | 方式 |
|--------|-----|
| **添加** | 点击 ➕ 按钮——自动建议下一个可用编号 |
| **编辑** | 双击消息文本，或点击 ✏️ |
| **删除** | 点击消息旁的 🗑️ |
| **保存** | **Ctrl+S**——所有待处理的添加、编辑和删除一起发送到 SAP |

输入时会实时校验：消息文本限制为 **72 个字符**，编号字段必填。

## 注意事项

- 消息编号零填充（`001`、`002`……）。
- 删除的消息会在保存时标记并移除；建议下一个编号时不会重用跳过的编号。
- **不支持长文本编辑**——长文本请使用 SE91。
- 仅适用于消息类对象（`MSAG/N` 类型）。

# 嵌入式 SAP GUI（WebView）

直接在 VS Code 中运行 SAP GUI 事务——无需在窗口之间切换。SAP WebGUI 渲染在**WebView**中：一个托管在 VS Code 内部的嵌入式浏览器标签页。

## 打开嵌入式 SAP GUI

三种打开方式：

| 方法 | 操作 |
|--------|--------|
| 键盘快捷键 | **Ctrl+Shift+F7**（打开 ABAP 文件时） |
| 编辑器工具栏 | 点击编辑器工具栏中的**嵌入式 GUI**按钮 |
| 命令面板 | `ABAP FS: Open SAP GUI in embedded WebView` |

## 要求

- 你的 SAP 系统启用了 WebGUI
- 在 ABAP FS 设置中配置了连接

## 工作原理

默认情况下，扩展在 VS Code 的**集成浏览器**（Simple Browser）中打开 SAP GUI，而不是原始 iframe WebView。集成浏览器不把页面包裹在 iframe 中，这避免了下文描述的常见白屏问题。

## 白屏 / 点击劫持问题

如果你看到**空白白页**，说明你的 SAP 系统启用了点击劫持框架保护（`ClickjackingFramingProtection.js`）。这是 SAP 服务端安全功能，会阻止 SAP WebGUI 在 iframe 中加载——扩展无法覆盖它。

你也可能看到这些浏览器控制台错误：

- `ClickjackingFramingProtection.js: Ignored call to 'alert()'. The document is sandboxed`
- `Potential permissions policy violation: fullscreen is not allowed in this document`

**解决方案：** `abapfs.sapGui.useIntegratedBrowser` 设置**默认启用**，可以解决此问题。如果你之前禁用了它，请重新启用：

```json
{
  "abapfs.sapGui.useIntegratedBrowser": true
}
```

要回退到原始嵌入式 WebView（例如集成浏览器在你的环境中引起问题时）：

```json
{
  "abapfs.sapGui.useIntegratedBrowser": false
}
```

此设置适用于所有入口：工具栏按钮、命令面板和运行事务命令。

> **VS Code 提示：** VS Code 设置 `simpleBrowser.useIntegratedBrowser`（标记为实验性）控制 Simple Browser 是否使用 VS Code 内置浏览器引擎。启用它可能提高桌面端兼容性。这是 VS Code 设置，不是 ABAP FS 设置。

# 原生桌面 SAP GUI

在本地安装的 SAP GUI 应用中直接打开当前活动的 ABAP 对象，让你无需离开 VS Code 工作流即可访问完整的事务界面。

## 要求

- 机器上安装了 Windows 版 SAP GUI
- 配置了到 SAP 系统的 ABAP FS 连接

## 如何打开

在编辑器中打开 ABAP 文件后，可以使用以下任一方法：

| 方法 | 操作 |
|---|---|
| 键盘快捷键 | `Ctrl+Shift+F5` |
| 编辑器工具栏 | 点击**在 SAP GUI 中打开**图标 |
| 命令面板 | `Ctrl+Shift+P` → `ABAP FS: Open in native SAP GUI desktop application` |

## 何时使用

在以下情况优先使用原生 SAP GUI：

- 浏览器版 GUI 中没有的事务
- 复杂或数据密集型界面需要更好的性能
- 需要完整的 SAP GUI 功能（例如 ALV 网格、自定义控件、脚本）

# 网页浏览器 SAP GUI

在默认网页浏览器中运行 SAP GUI（SAP WebGUI），打开当前活动的 ABAP 对象。当你需要以原生 SAP GUI 界面与对象交互、又不离开开发工作流时很有用。

## 前置条件

- 目标 SAP 系统必须启用 SAP WebGUI（不确定的话问问你的 Basis 团队）。

## 如何打开

在编辑器中打开 ABAP 文件后，可以使用以下任一方式：

| 方法 | 操作 |
|---|---|
| 键盘快捷键 | `Ctrl+Shift+F6` |
| 编辑器工具栏 | 点击**在浏览器 GUI 中打开**图标 |
| 命令面板 | `Ctrl+Shift+P` → `ABAP FS: Open SAP GUI in external web browser` |

对象在默认浏览器中打开。URL 可以复制并分享给有权访问同一系统的其他用户。

# 运行 SAP 事务

直接从 VS Code 执行 SAP 事务码，无需切换到 SAP GUI 窗口。

## 使用方法

1. 打开命令面板（`Ctrl+Shift+P`）
2. 运行 **ABAP Copilot: Run SAP Transaction**
3. 如果连接了多个系统，选择目标系统
4. 输入事务码（例如 `MM43`、`SE38`）
5. 按 `Enter`——事务在你配置的 GUI 中打开

## GUI 配置

在设置中按连接设置你偏好的 GUI 类型（`sapGui.guiType`）。

## 限制

- **原生 SAP GUI** — 仅 Windows
- **嵌入式 WebView** — 不支持 SSO；需要手动登录
- 某些事务在嵌入式模式下可能无法正常工作

# 对象搜索

按名称搜索 ABAP 对象——类似 SE80 的对象搜索，但直接在 VS Code 内完成，无需打开 SAP GUI。

## 如何搜索

1. 打开命令面板（`Ctrl+Shift+P`）
2. 运行 **ABAP FS: Search for object**
3. 使用通配符输入名称模式（例如 `ZCL_*`、`*USER*`）
4. 选择一个或多个对象类型过滤结果
5. 按 `Enter`——结果在快速选择列表中打开，即时导航

> **提示：** 把你常用的对象类型保存为默认值，这样不用每次都重新选择。

## 通配符模式

| 模式 | 匹配内容 |
|---------|---------|
| `ZCL_*` | 所有以 ZCL_ 开头的自定义类 |
| `*USER*` | 所有包含 USER 的内容 |
| `BAPI_MATERIAL_*` | 所有以 BAPI_MATERIAL_ 开头的 BAPI |

## 支持的对象类型

| 类型 | 描述 |
|------|-------------|
| `CLAS` | 类 |
| `INTF` | 接口 |
| `PROG` | 程序 / 报表 |
| `FUNC` | 函数模块 |
| `FUGR` | 函数组 |
| `TABL` | 数据库表 |
| `VIEW` | 视图 |
| `DTEL` | 数据元素 |
| `DOMA` | 域 |
| `TTYP` | 表类型 |
| `DDLS` | CDS 视图 |
| `ENQU` | 锁对象 |
| `MSAG` | 消息类 |
| `DEVC` | 包 |
| `TRAN` | 事务 |
| `ENHC` / `ENHS` | 增强实现 / 增强点 |
| `BADI` | BAdI 定义 |
| + 30 多种 | — |

> **注意：** 扩展原生不支持的对象类型会自动在 SAP GUI 中打开。

# 创建对象

直接在 VS Code 中创建新的 ABAP 开发对象，无需打开 SAP GUI。

## 如何创建对象

**方式 1 — 命令面板：**

1. 按 `Ctrl+Shift+P` 打开命令面板。
2. 输入并选择 **ABAP FS: Create object**。
3. 跟随向导提示（对象类型、名称、描述、包）。

**方式 2 — 资源管理器右键菜单：**

1. 在 ABAP 资源管理器中右键点击包或文件夹。
2. 选择**创建对象**。
3. 跟随向导提示。

**方式 3 — 通过 Copilot：**

用自然语言让 Copilot 执行，例如：

> *“创建一个新类 ZCL_MY_CLASS，描述为 'My class'”*

Copilot 会自动填写对象详情。你仍然会被提示选择传输请求。

## 支持的对象类型

| 对象类型 | 类型代码 |
|---|---|
| 报表 / 程序 | `PROG/P` |
| 类 | `CLAS/OC` |
| 接口 | `INTF/OI` |
| 函数组 | `FUGR/F` |
| 数据元素 | `DTEL/DE` |
| 域 | `DOMA` |
| 数据库表 | `TABL/DT` |
| CDS 视图 | `DDLS` |
| 消息类 | `MSAG/N` |
| 包 | `DEVC/K` |

还支持许多其他类型。如果列表中没有你需要的对象类型，试试向导——它会显示已连接系统中所有可用的类型。

## 注意事项

- 需要传输的对象**总会**出现**传输请求**对话框。此步骤不能跳过。
- 创建后新对象会自动在编辑器中打开。
- 对象必须先**激活**才能在运行时使用。

# 打开对象

从已连接的 SAP 系统打开任意 ABAP 对象，直接在 VS Code 编辑器中查看和编辑。

## 如何打开对象

**方式 1 — 搜索命令（推荐）**

1. 按 `Ctrl+Shift+P` 打开命令面板。
2. 运行 **ABAP FS: Search for object**。
3. 输入对象名称的一部分，从列表中选择。

**方式 2 — 文件资源管理器**

- 在资源管理器面板（`Ctrl+Shift+E`）中展开你的 SAP 系统，双击任意对象。

**方式 3 — 让 Copilot 执行**

- 在 Copilot 聊天中输入：*“打开 ZCL_MY_CLASS”* — 对象自动打开。

## 你得到什么

打开后，该对象在 VS Code 中表现得像任何其他文件一样：

- ABAP 语法高亮
- 完整的编辑、保存和激活支持
- 面包屑导航和转到定义（`F12`）
- 显示在资源管理器和**打开的编辑器**中

# 对象激活

激活会编译你的 ABAP 代码并使其可执行——相当于在 SE80/SE24 中点击**激活**按钮（或 `Ctrl+F3`）。

> 与 SE80 不同，扩展在激活前会自动保存文件，所以不需要单独的保存步骤。

## 如何激活

| 方法 | 操作 |
|--------|--------|
| 键盘快捷键 | **Alt+Shift+F3** |
| 编辑器工具栏 | 点击激活按钮（闪电图标） |
| 保存时 | 如果在设置中启用了**保存时自动激活**，则自动激活 |

## 批量激活

当你编辑的对象有关联的未激活对象时（例如带 include 的程序，或带方法的类），扩展会自动检测并显示选择对话框：

1. 出现所有未激活关联对象的列表，全部预先选中。
2. 取消选择你**不**想激活的对象。
3. 确认——所有选中的对象一起激活。

这与 SE80 中依赖对象不同步时出现的批量激活对话框一致。

# 收藏夹管理

收藏夹让你可以书签标记常用的 ABAP 对象，跨会话快速访问。

## 添加收藏

1. 在资源管理器侧边栏中找到 ABAP 对象。
2. 右键点击并选择**添加到收藏夹**。

## 查看和打开收藏

- 在资源管理器侧边栏中打开**收藏夹**视图。
- 点击任意条目在编辑器中打开对象。

## 移除收藏

- 在**收藏夹**视图中右键点击条目，选择**从收藏夹移除**。

## 注意事项

- 收藏夹在 VS Code 会话之间持久保存。
- **收藏夹**视图在资源管理器侧边栏中（与文件树同一面板）。

# 显示表内容

直接在 VS Code 中查看任意数据库表的内容——类似 SAP GUI 中的 **SE16 / SE16N**。

## 打开表内容

1. 打开一个数据库表（例如从对象资源管理器，或按 `Ctrl+Shift+A` 按名称搜索）
2. 点击编辑器工具栏中的**显示表内容**按钮，或右键表 → **显示表内容**

## 使用数据网格

结果在交互式网格中打开，支持以下功能：

| 功能 | 使用方法 |
|---|---|
| **排序** | 点击列标题 |
| **过滤** | 使用标题下方的过滤行 |
| **分页** | 使用底部的控件翻页 |
| **导出** | 使用导出按钮下载结果 |

## 注意事项

- 默认只获取前 **1,000 行**——大表请添加过滤条件缩小范围。
- 更复杂的查询（JOIN、聚合、自定义 WHERE 子句）请改用[数据查询](#sql-查询执行)功能。

# 跨系统比较对象

在两个已连接的 SAP 系统之间并排比较同一个 ABAP 对象——用于验证传输、调查系统特定行为，或在部署前检查生产环境中的内容。

## 前置条件

- 在 VS Code 中至少连接 2 个 SAP 系统
- 对象必须同时存在于两个系统中

## 如何比较

1. 在资源管理器或编辑器中打开/定位 ABAP 对象。
2. 用以下任一方式触发命令：
   - **资源管理器：** 右键文件 → **与另一个 SAP 系统比较**
   - **编辑器：** 在文件内右键 → **与另一个 SAP 系统比较**
   - **命令面板**（`Ctrl+Shift+P`）：`ABAP FS: Compare With another SAP System`
3. 从快速选择列表中选择目标系统（只显示已连接的系统）。
4. VS Code 打开标题为 `OBJECT_NAME: DEV100 ↔ QA100` 的 diff 视图。

## 注意事项

- diff 以标准 VS Code 并排比较打开——所有编辑器快捷键（例如 `F7`/`Shift+F7` 在变更之间跳转）都正常工作。
- SAP 版本之间的路径差异会自动处理（新版系统为 `Source Code Library`，旧版为 `Source Library`）。
- 如果对象在目标系统中不存在，会显示错误。

# ABAP Test Cockpit（ATC）分析

ATC 是 SAP 内置的代码质量框架——与你在 SE80 或 Eclipse ADT 中运行的检查相同，但直接集成到 VS Code 中。它会扫描你的 ABAP 对象，检查编码违规、安全问题、性能问题，以及（可选）S/4HANA 兼容性。

## 运行 ATC

打开 ABAP 文件后，可以使用以下任一方法：

- **键盘：** `Ctrl+Shift+F2`
- **命令面板：** `ABAP FS: Run ABAP Test Cockpit`
- **Copilot 聊天：** “Run ATC on this file”

检查结果会立即以彩色下划线显示在编辑器中，并出现在 **ATC 检查结果** 面板中（活动栏 → ABAP FS → ATC Finds）。

## 处理结果

点击 ATC 面板中的任何检查结果，跳转到受影响的代码行。在那里你可以：

| 操作 | 方式 |
|---|---|
| 阅读检查文档 | 点击检查结果上的**显示文档** |
| 应用快速修复 | 点击灯泡 / 在下划线上按 `Ctrl+.` |
| 获取 AI 建议的修复 | 让 Copilot：*“Fix this ATC finding”* |
| 申请豁免 | 右键检查结果 → **申请豁免**（单个或批量） |
| 隐藏已豁免的结果 | 在面板工具栏中切换**过滤已豁免** |
| 保存后重新运行 | 在面板工具栏中切换**自动刷新** |

## 增强装饰标记

查看 SAP 标准代码时，🎯 标记显示客户增强（BADI、隐式增强等）在哪些位置生效。悬停查看详情，或点击链接直接打开增强源码。

## 配置检查变式

检查变式控制 ATC 应用哪些规则——就像在事务 `ATC` 或 SE80 中选择变式一样。要为每个连接设置默认变式：

1. 打开 **ABAP FS: Connection Manager**
2. 编辑连接
3. 设置 **ATC Variant** 字段（例如 `DEFAULT`、`S4HANA_READINESS` 或你的自定义变式）

或直接添加到 `settings.json`：

```json
"atcVariant": "S4HANA_READINESS"
```

## S/4HANA 迁移工作流

要检查自定义代码的 S/4HANA 兼容性，将变式设置为 `S4HANA_READINESS`。ATC 之后每次运行都会标记已移除的 API、变更的接口和弃用的功能。

推荐工作流：

1. 使用 [S/4HANA 就绪仪表盘](#s4hana-就绪仪表盘) 识别所有受影响的对象
2. 打开每个对象并运行 ATC（`Ctrl+Shift+F2`）查看详细结果
3. 让 Copilot 根据 ATC 文档修复被标记的问题

# ABAP Cleaner 集成

ABAP Cleaner 自动格式化和清理 ABAP 代码——一步完成缩进修正、语法现代化和可配置的清理规则。

## 设置

ABAP Cleaner 需要其独立的命令行工具（`abap-cleanerc.exe`）。

1. 从 [github.com/SAP/abap-cleaner](https://github.com/SAP/abap-cleaner) 下载 ABAP Cleaner 并解压到文件夹。
2. 打开命令面板（`Ctrl+Shift+P`）并运行 **ABAP FS: Setup ABAP Cleaner Integration**。
3. 提示时输入 `abap-cleanerc.exe` 的路径。

## 清理代码

打开 ABAP 文件后，可以使用以下任一方法：

| 方法 | 操作 |
|---|---|
| 键盘快捷键 | `Ctrl+Shift+Alt+F` |
| 保存时格式化 | `Shift+Alt+F`（标准 VS Code 格式化——如果配置了 ABAP Cleaner 作为格式化器，会触发它） |
| 命令面板 | **ABAP FS: Clean ABAP Code with ABAP Cleaner** |
| 工具栏按钮 | 点击编辑器工具栏中的 Cleaner 按钮 |

只清理选中行：先选中代码，再触发命令。

## 它的作用

- 对文件应用所有已配置的 ABAP Cleaner 规则
- 如果配置了自定义清理配置文件，则遵守该配置
- 以你指定的 ABAP 版本为目标（避免使用你系统上不可用的语法）
- 报告应用了哪些规则以及修改了多少行

## 配置

在 VS Code 设置（`Ctrl+,`）中搜索 **ABAP Cleaner** 进行配置：

- **可执行文件路径** — `abap-cleanerc.exe` 的路径
- **配置文件** — 自定义清理配置文件（可选）
- **目标版本** — 目标 ABAP 版本（例如 `757`）
- **保存时清理** — 每次保存 ABAP 文件时自动清理

# 语法验证

ABAP FS 实时验证你的代码——无需单独运行语法检查。错误会在输入时直接显示在编辑器和问题面板中。

## 何时运行

语法检查在以下时机自动触发：

- **打开** — 打开 ABAP 文件时
- **编辑** — 输入时
- **保存** — 保存修改时
- **激活** — 激活对象时

## 查看错误

| 位置 | 如何打开 |
|---|---|
| 内联下划线 | 悬停下划线代码查看详情 |
| 问题面板 | `Ctrl+Shift+M` |
| 错误透镜（内联） | 自动显示在出错行旁边 |

## 修复错误

- **快速修复** — 在错误上按 `Ctrl+.` 查看可用修复
- **AI 聊天修复** — 点击错误旁边的✨图标，打开内联 AI 聊天获取建议修复
- **跳转到下一个错误** — `F8` / `Shift+F8` 循环浏览问题

# Where-Used 分析

这是 SAP GUI 中 **Ctrl+Shift+F3**（Where-Used List）的 VS Code 等价功能。查找对象、方法、变量或符号在整个系统中被引用的每一个位置。

## 使用方法

**方式 1 — 编辑器快捷键：**
1. 将光标放在任意符号上（类名、方法、变量等）
2. 按 `Shift+F12`（查找所有引用）或右键 → **查找所有引用**
3. 结果出现在引用面板中，包含文件位置和代码片段

**方式 2 — 让 Copilot 执行：**
> “BAPI_USER_GET_DETAIL 用在哪里？”
> “查找 `ZCL_MY_CLASS` 中方法 `FACTORY` 的所有用法”

## 过滤结果

对于大型结果集（1000+ 引用），过滤器可以避免在 SAP 标准对象中翻页查找自定义代码：

| 过滤器 | 作用 |
|--------|-------------|
| 排除标准对象 | 只显示 Z\* / Y\* 自定义代码 |
| 对象类型 | 限定为程序、类、接口等 |
| 对象名称模式 | 例如 `Z*INVOICE*`，按命名规范缩小范围 |

> **提示：** 自定义 Z/Y 对象通常出现在大型结果集的末尾。应用“排除标准对象”过滤器可以直接跳转到它们。

## 与 SAP GUI 对比

| SAP GUI（Ctrl+Shift+F3） | VS Code |
|-------------------------|---------|
| 模态对话框，一次一个对象 | 内联结果面板，保持打开 |
| 无代码片段预览 | 显示每个引用周围的代码上下文 |
| 无模式过滤 | 按类型、名称模式、仅自定义过滤 |
| 每个事务分页 | 一个视图内分页 + 过滤 |

# ABAP 调试

直接在 VS Code 中调试 ABAP 程序——无需 SAP GUI。你拥有与 SAP GUI 调试器相同的核心能力（断点、单步执行、变量检查、调用栈），外加现代编辑器体验和 Copilot 集成。

> 💡 **另见：** [调试录制与回放](#调试录制与回放) — 录制会话并离线回放，支持回退。

---

## 与 SAP GUI 调试器对比

| 功能 | SAP GUI 调试器 | VS Code（ABAP FS） |
|---|---|---|
| 断点 | 在编辑器中点击 | 点击装订线或通过 Copilot |
| 条件断点 | ✅ | ✅ |
| 变量检查 | 手动导航 | 模式过滤、自动展开 |
| 单步控制 | 工具栏按钮 | 键盘快捷键（F5–F8） |
| 调用栈 | ✅ | ✅ |
| 多线程 | 有限 | 最多 20 个并发线程 |
| AI 辅助 | ❌ | ✅ 通过 Copilot |

---

## 启动调试会话

1. 在 VS Code 中打开 ABAP 对象。
2. 至少设置一个断点（见下文）。
3. 让 Copilot **“启动调试会话”** — 或使用调试面板。
4. 在 SAP 系统中触发执行（运行事务、报表等）。
5. VS Code 在第一个断点处暂停。

> ⚠️ **生产系统：** 在生产系统上启动调试会话会弹出确认对话框。生产调试有数据暴露和性能影响风险。请改用 SAP GUI。

---

## 断点

**设置断点：** 点击行号左侧的装订线——出现红点，与任何 VS Code 语言一致。

**条件断点：** 右键装订线 → *添加条件断点* → 输入 ABAP 表达式。只有条件为真时执行才会暂停。

**跳转到光标：** 按 **Shift+F12** 恢复执行并在当前光标位置暂停（相当于 SAP GUI 中的 *Breakpoint at Cursor*）。

---

## 单步控制

| 操作 | 快捷键 | SAP GUI 等价 |
|---|---|---|
| 继续（运行到下一个断点） | **F5** | F8 |
| 单步跳过（执行本行，不进入调用） | **F6** | F6 |
| 单步进入（进入方法/函数） | **F7** | F5 |
| 单步返回（完成当前方法） | **F8** | — |
| 跳转到行 | — | *Goto Line* |

---

## 变量检查

在调试侧边栏中打开**变量**面板。变量按作用域分组：*局部变量*、*全局变量*、*SY 字段* 等。

**按模式过滤** — 在大型程序中很有用：

- `LT_*` — 显示所有内表
- `LS_*` — 显示所有结构
- `GV_*` — 显示所有全局变量

**自动展开：** 结构和表内联展开，无需逐个进入即可看到组件值。

**表达式求值：** 在*监视*面板或调试控制台中输入任意 ABAP 变量或表达式，在当前断点处求值。

**通过 Copilot：** 自然语言提问 — *“显示 lt_data 的值”*、*“展开 ls_header”*、*“显示所有以 LT\_ 开头的变量”*。

---

## 调用栈

**调用栈**面板列出每个活动的栈帧，包含程序名、方法和行号。点击任意帧可检查该层的局部变量——相当于在 SAP GUI 调试器中切换帧。

---

## 多线程调试

VS Code 支持最多 **20 个并发调试线程**（可配置）。每个线程在调用栈面板中显示为独立条目。这在调试后台作业或 SAP GUI 难以调试的并行处理场景时很有用。

# 调试录制与回放

> ⚠️ **测试版功能** — 如有问题请报告。

录制实时 ABAP 调试会话并离线回放——前进和后退都可以——就像 DVR。回放时无需 SAP 连接。

**什么时候有用？**

- 你步进得太远，想不重启就回去
- 你想和同事分享 bug 复现过程
- 你需要按自己的节奏分析复杂的执行路径

---

## 录制会话

> 每步比正常慢约 1–3 秒，因为扩展要在 SAP 丢弃数据前捕获所有变量数据。

1. 照常启动调试会话（设置断点、附加到用户/终端）
2. 打开命令面板（`Ctrl+Shift+P`）→ **ABAP FS: Start Debug Recording**
3. 正常单步执行——每一步都会被捕获
4. `Ctrl+Shift+P` → **ABAP FS: Stop Debug Recording**
5. 在提示时选择**保存**（纯 `.abaprecord`）或**压缩并保存**（`.abaprecord.gz`，约小 80–95%）

**每步捕获的内容：**

- 带源码引用的完整调用栈
- 所有作用域的变量（局部、全局、SY）——结构展开，表最多 2,000 行
- 供离线查看的源文件内容

---

## 回放录制

1. `Ctrl+Shift+P` → **ABAP FS: Replay Debug Recording**
2. 选择 `.abaprecord` 或 `.abaprecord.gz` 文件——两者都会自动处理
3. 回放会话打开，显示与录制时完全相同的代码、栈和变量

**回放控制：**

| 操作 | 快捷键 |
|--------|----------|
| 前进（下一个快照） | `F7`、`F10` 或 `F11` |
| 后退（上一个快照） | `Shift+F7` 或 `Shift+F11` |
| 跳到末尾 | `F5`（继续） |
| 跳到开头 | 反向继续 |
| 关闭会话 | 终止 |

> 在回放模式下，三个单步按钮（跳过/进入/返回）作用相同：移动到下一个录制的快照。

你可以检查变量、展开结构、浏览表行、求值表达式、悬停查看变量——全部无需 SAP 连接。

---

## 压缩

大型会话可能产生几十 MB 的文件。使用 gzip 减小存储和共享大小。

| 命令 | 描述 |
|---------|-------------|
| **ABAP FS: Compress Debug Recording** | 压缩现有 `.abaprecord` → `.abaprecord.gz` |
| **ABAP FS: Decompress Debug Recording** | 将 `.abaprecord.gz` 转回纯 JSON |

压缩后扩展会显示体积缩减（例如 *42 MB → 3.2 MB，小 92%*）。两种格式完全可互换。

---

## 全部命令

| 命令 | 描述 |
|---------|-------------|
| `ABAP FS: Start Debug Recording` | 开始录制活动调试会话 |
| `ABAP FS: Stop Debug Recording` | 停止并保存（纯格式或压缩格式） |
| `ABAP FS: Replay Debug Recording` | 打开并回放录制文件 |
| `ABAP FS: Compress Debug Recording` | 压缩现有 `.abaprecord` 文件 |
| `ABAP FS: Decompress Debug Recording` | 解压 `.abaprecord.gz` 文件 |

---

## 限制

| 限制 | 详情 |
|------------|--------|
| 表行 | 只捕获前 2,000 行；其余跳过（回放中会标记） |
| 变量深度 | 超过 4 层的结构/表不展开 |
| 源码不可用 | 录制时缓存失败则显示 `[source unavailable]` |
| 无条件断点 | 回放只能按录制内容步进 |
| 步进速度 | 录制时每步约 1–3 秒（变量捕获开销） |

# SQL 查询执行

直接从 VS Code 查询 SAP 表——相当于 SE16N 或 DBACOCKPIT，但由自然语言驱动并与 Copilot 集成。

## 使用方法

打开 Copilot 聊天（`Ctrl+Alt+I`）并描述你的需求：

- *“显示 MARA 的前 10 条记录”*
- *“查询 USR02 中用户名以 Z 开头的记录”*
- *“比较供应商 1000 在 EKKO 中的未结采购订单”*

Copilot 构建并执行 ABAP SQL 查询，然后在编辑器中的交互式表格里显示结果。

## 处理结果

结果表格支持：

| 操作 | 方式 |
|---|---|
| 按列排序 | 点击列标题（再点一次反向） |
| 多列排序 | 按住 `Shift` 点击其他列标题 |
| 过滤行 | 在过滤框中输入——支持通配符 `*` 和 `?` |
| 导出 | 使用结果工具栏中的导出按钮 |

你也可以在初次查询后让 Copilot 优化结果：*“现在按工厂 1000 过滤”* 或 *“按创建日期降序排序”*。

## 显示模式

**UI 模式**（默认）— 结果出现在 WebView 中，供你交互式探索。数据留在 VS Code 中。

**内部模式** — 结果发送回 Copilot 做进一步分析（例如 *“查找重复项”*、*“按物料类型汇总”*）。Copilot 在需要分析时自动选择此模式。

## 生产系统保护

当 Copilot 要从**生产系统**把数据发回给自己时，会出现确认对话框：

- **运行并发送给 Copilot** — 继续分析
- **运行且仅在 UI 中显示** — 显示结果但不与 Copilot 共享数据
- **取消**

这可以防止敏感的生产数据无意中进入 AI 上下文。

## 注意事项

- **行数限制：** 默认 1000 行，最大 50,000。Copilot 自动管理——ADT 不支持 ABAP SQL 的 `UP TO x ROWS` 子句，所以请改用自然语言，例如 *“限制为 500 行”*。
- **不只是 SAP 数据：** 同一个结果查看器可以显示 Copilot 在对话中整理的任意结构化数据——JIRA 问题、任务列表、对比表等。

# SAP 数据工作簿（.sapwb）

SAP 数据工作簿是 VS Code 笔记本，将 ABAP SQL 查询、JavaScript 处理和 Markdown 组合在单个可复用的 `.sapwb` 文件中。用于多步骤数据分析、数据质量检查和跨系统比较。

## 创建工作簿

1. 打开命令面板（`Ctrl+Shift+P`）
2. 运行 **ABAP FS: New SAP Data Workbook**

或者，创建任何带 `.sapwb` 扩展名的文件，或让 Copilot：*“创建一个分析物料主数据质量的工作簿。”*

## 单元格类型

| 类型 | 用途 |
|------|---------|
| **Markdown** | 章节标题、备注、文档 |
| **ABAP SQL** | 查询 SAP 表（仅 `SELECT` 和 `WITH`——不支持 DML） |
| **JavaScript** | 处理、过滤或比较前面单元格的结果 |

## 核心概念

**运行单元格**

- 用运行按钮或 `Shift+Enter` 运行单个单元格。会提示你选择 SAP 系统。
- **全部运行**（`Ctrl+Shift+Enter`）只提示一次，所有 SQL 单元格都使用该系统。

**在单元格之间引用结果**

- 在 **JavaScript** 中：通过 `cells[N].result` 访问前一个单元格的行（从 0 开始，所以单元格 2 是 `cells[1]`）。
- 在 **ABAP SQL** 中：使用 `${...}` 插值前面的结果。字符串自动加引号；数组自动连接用于 `IN` 子句。

```sql
-- 使用单元格 2（索引 1）的结果作为过滤条件
SELECT matnr, werks FROM marc
  WHERE matnr IN (${cells[1].result.map(r => r.MATNR)})
```

**行数限制**

每个 SQL 单元格有可配置的行数限制（默认：1000）。用 **ABAP FS: Set Cell Max Rows** 调整。

## 示例：数据质量检查

```
单元格 1（Markdown）：   # 物料数据质量检查
单元格 2（ABAP SQL）：   SELECT matnr, mtart, meins FROM mara WHERE mtart = 'FERT'
单元格 3（JavaScript）： const rows = cells[1].result;
                         return rows.filter(r => !r.MEINS).length + " materials missing UoM";
单元格 4（ABAP SQL）：   SELECT matnr, werks FROM marc
                         WHERE matnr IN (${cells[1].result.map(r => r.MATNR)})
```

## 示例：跨系统比较

通过单独执行单元格并每次选择不同系统，对两个系统运行相同查询。然后用 JavaScript 单元格对比结果。

```
单元格 1（Markdown）：   # 定价条件对比：DEV vs QAS
单元格 2（ABAP SQL）：   SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
                         → 运行，选择 DEV
单元格 3（ABAP SQL）：   SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
                         → 运行，选择 QAS
单元格 4（JavaScript）： const devMap = new Map(
                         cells[1].result.map(r => [r.KSCHL + r.VKORG + r.MATNR, r])
                       );
                         return cells[2].result
                         .filter(r => {
                           const d = devMap.get(r.KSCHL + r.VKORG + r.MATNR);
                           return d && d.KBETR !== r.KBETR;
                         })
                         .map(r => ({
                           ...r,
                           DEV_KBETR: devMap.get(r.KSCHL + r.VKORG + r.MATNR).KBETR
                         }));
```

工作簿文件不存储系统 ID，因此可以和使用不同系统名的同事共享。

## 限制

- SQL 仅支持 `SELECT` 和 `WITH`——不支持 `INSERT`、`UPDATE` 或 `DELETE`
- 字符串字面量限制为 255 个字符（SAP ADT 限制）
- 避免向 `IN` 子句插值超过约 10 个值——改用 JavaScript 单元格过滤
- 取消单元格会立即显示“已中断”，但查询仍会在 SAP 端继续运行

## 命令

| 命令 | 快捷键 / 说明 |
|---------|-----------------|
| `ABAP FS: New SAP Data Workbook` | 创建新的 `.sapwb` 文件 |
| `ABAP FS: Set Cell Max Rows` | 设置当前 SQL 单元格的行数限制 |

# 传输请求视图

传输请求视图是 **SE09/SE10** 的 VS Code 等价功能。它让你无需离开编辑器即可管理工作台和定制传输。

**打开方式：** 活动栏 → ABAP FS 图标 → **传输**面板。

---

## 你能做什么

| 操作 | 方式 |
|---|---|
| 列出自己的未释放传输 | 面板自动打开并按你的用户过滤 |
| 列出其他用户的传输 | 点击过滤图标并输入用户名 |
| 浏览传输中的对象 | 展开传输节点 |
| 比较两个传输 | 右键传输 → **比较** |
| 复制传输编号 | 右键 → **复制传输编号** |
| 运行 ATC 质量检查 | 右键 → **运行 ATC** |
| 在 SAP GUI（SE09）中打开 | 右键 → **在 GUI 中打开** |
| 释放传输 | 右键 → **释放** |
| 删除传输 | 右键 → **删除** |
| 更改所有者 / 添加用户 | 右键 → **更改所有者** / **添加用户** |
| 链接到源代码管理 | 右键 → **添加到源代码管理** |
| 刷新列表 | 点击刷新图标或按 `F5` |

---

## 用 Copilot 查询传输

你也可以用自然语言让 Copilot 执行：

- *“显示我的传输”*
- *“获取传输 DEVK900123 的详细信息”*
- *“DEVK900123 里有什么对象？”*
- *“比较传输 DEVK900123 和 DEVK900124”*

---

## 旧版 SAP 系统

如果 ADT 传输 API 不可用，扩展会自动降级为直接对表 `E070`、`E071` 和 `E071K` 执行 SQL 查询——无需任何配置。

# 传输对象操作

直接在侧边栏的**传输**视图中操作传输请求内的单个对象。

## 访问对象操作

右键点击传输请求下列出的任意对象，查看可用操作。

## 可用操作

| 操作 | 作用 |
|---|---|
| **打开** | 在编辑器中打开对象 |
| **与当前版本比较** | 显示传输版本与当前活动版本之间的并排 diff |
| **在资源管理器中显示** | 在 ABAP 文件资源管理器中导航到该对象 |

## 向传输添加对象

当你保存分配给传输请求的 ABAP 对象的修改时，对象会自动添加到传输中。你也可以手动分配对象：

1. 在资源管理器中右键对象
2. 选择**添加到传输**
3. 从列表中选择目标传输请求

## 从传输中移除对象

1. 打开**传输**视图
2. 展开传输请求
3. 右键要移除的对象
4. 选择**从传输中移除**

> **注意：** 从传输中移除对象不会还原其源代码——只是把对象与该传输请求解除关联。

# abapGit 集成

abapGit 集成让你无需离开编辑器，直接在 VS Code 中管理 ABAP 对象的 Git 版本控制。

## 打开 abapGit 面板

1. 点击活动栏（左侧边栏）中的 **ABAP FS** 图标。
2. 展开 **abapGit** 部分。

## 常见操作

### 链接现有仓库
1. 在 abapGit 面板中点击**链接仓库**。
2. 输入 Git URL 并选择要链接的 SAP 包。

### 创建新仓库
1. 点击**创建仓库**。
2. 提供 Git URL 和目标包。

### 查看暂存/未暂存变更
abapGit 面板列出所有已变更的 ABAP 对象。每个条目显示其处于暂存或未暂存状态。

### 暂存和提交（推送）
1. 选择要暂存的对象，或暂存所有变更。
2. 点击**推送**——这会提交并推送到远程 Git 仓库。
3. 提示时输入提交信息。

### 拉取（从 Git 更新）
1. 在已链接的仓库上点击**拉取**。
2. **注意：** 拉取会用 Git 中的版本覆盖本地 ABAP 对象。未保存的本地修改会丢失。

### 注册到 VS Code 源代码管理
点击**注册到 VS Code SCM**，把仓库显示到 VS Code 内置的源代码管理视图中（`Ctrl+Shift+G`），在 ABAP FS 面板旁边支持 diff 和历史浏览。

### 取消链接仓库
点击仓库旁边的**取消链接**图标，移除连接而不删除任何代码。

## 提示

- 用**拉取**把全新系统与 Git 中的现有代码库同步。
- abapGit 面板遵循当前活动的 SAP 连接——使用多个系统时先在 ABAP FS 面板中切换连接。

# ABAP 修订历史

每次激活 ABAP 对象时，SAP 都会存储一个版本快照——与你在 SE80 中通过**实用程序 → 版本**看到的历史相同。此扩展在 **VS Code 内置的源代码管理视图**中显示该历史，并带并排 diff 编辑器。

## 打开修订历史

修订显示在标准的**源代码管理视图**（`Ctrl+Shift+G`）中，位于名为 `ABAP <连接ID>` 的提供器下（每个已连接系统一个）。

对象出现在那里有四种方式：

1. **自动 — 最近分组。** 在编辑器中打开任意 ABAP 对象。它会添加到其连接 SCM 提供器的**最近**分组中，并带有与上一次激活版本的 diff 装饰。
2. **整个传输。** 在**传输**面板（ABAP FS 活动栏）中，右键传输 → **将传输添加到源代码管理**。该传输中的每个对象都作为独立的 SCM 分组添加。
3. **对象属性视图。** ABAP FS 活动栏 → **对象属性**面板 → **修订历史**部分列出当前打开对象的每个存储版本。
4. **让 Copilot 执行。** > “显示 ZCL_MY_CLASS 的版本历史”或要求比较任意两个版本——使用 `get_version_history` 工具（见下文）。

## 比较版本

### 从源代码管理视图

点击 `ABAP <连接ID>` 分组中的资源打开默认 diff（当前活动版本 vs 上一个修订），或使用行上的内联图标：

| 命令 | 作用 |
|---|---|
| `打开修订 diff` | 并排 diff，活动版本 vs 上一个修订 |
| `打开规范化 diff` | 相同 diff，但去掉格式/注释差异（SE80 风格规范化比较） |
| `打开当前版本` | 只打开当前源码，无 diff |

内联分组操作：

- **过滤未更改** — 隐藏没有差异的对象。
- **清空** — 清空分组。

### 在 diff 编辑器中逐步浏览修订

修订 diff 打开时，编辑器工具栏提供：

| 命令 | 作用范围 |
|---|---|
| `上一修订（左窗格）` / `下一修订（左窗格）` | 在历史中前后移动左侧（较旧）版本 |
| `上一修订（右窗格）` / `下一修订（右窗格）` | 在历史中前后移动右侧（较新）版本 |
| `切换代码规范化` | 即时剥离格式/注释差异 |

### 从对象属性视图

在**修订历史**部分，勾选任意两个版本旁的复选框，即可打开恰好这两个版本之间的 diff。

## 恢复旧版本

没有一键恢复。打开到你要的版本的 diff，把保存旧版本的窗格中的内容复制到当前活动源码的编辑器中，然后照常保存并激活。

## 与 SE80 版本管理对比

| SE80（实用程序 → 版本） | 此扩展 |
|---|---|
| 在 SAP GUI 中打开 | 标准 VS Code 源代码管理 + diff 编辑器 |
| 基于文本的 diff | 语法高亮的并排 diff |
| 可用的规范化比较 | diff 工具栏中的`切换代码规范化` |
| 手动复制恢复 | 从 diff 窗格复制 |

## 用 Copilot 处理版本历史

`get_version_history` 工具支持三个操作。版本号从 **1** 开始，**1 = 最近**。

| 操作 | 作用 |
|---|---|
| `list_versions` | 列出所有版本，含日期、作者和传输 |
| `get_version_source` | 返回指定版本号的完整源代码 |
| `compare_versions` | 显示两个版本号之间新增/删除的行 |

**示例问题：**

- “显示 ZCL_MY_CLASS 的版本历史”
- “谁最后修改了 ZCL_MY_CLASS？什么时候？”
- “获取 ZCL_MY_CLASS 版本 2 的代码”
- “比较 ZTEST_PROGRAM 的版本 1 和版本 3”
- “ZTEST_PROGRAM 最后两个版本之间改了什么？”

# Blame 侧边注释

显示 ABAP 文件每一行的最后修改者——作者、日期和传输编号——内联显示在编辑器中，类似 Git 仓库的 GitLens。

## 激活 Blame

打开 ABAP 文件后，可以使用以下任一方式：

| 方法 | 操作 |
|--------|--------|
| 键盘 | **Ctrl+Alt+B**（切换开/关） |
| 编辑器标题栏 | 点击 blame 图标（$(git-commit)） |
| 命令面板 | `ABAP FS: Show Blame` |

> Blame 是按文件的——可以在一个文件上激活，而其他文件不显示注释。

## 阅读注释

每个被注释的行显示：`作者 · 日期 · 传输编号 — 传输描述`

示例：`JSMITH · Jan 15, 2026 · KD1K900123 — S 8000005926: Fix pricing logic`

- **颜色编码的左边框** — 每个作者有不同颜色，便于快速视觉分组
- **`│` 连续标记** — 同一作者/传输的连续行会被分组
- **所有注释按列对齐** — 无论行长如何
- **悬停注释**可查看完整日期和传输详情

## 渲染模式

用 `abapfs.blame.renderMode` 设置控制布局：

| 值 | 布局 |
|-------|--------|
| `classic` | Blame 文本内联显示在每行代码之后 |
| `gitlens` | Blame 移入代码左侧的固定通道 |

通过**文件 > 首选项 > 设置**修改，搜索 `abapfs blame`。

## 要求

- 对象必须有 SAP 版本历史——`$TMP` 中无传输的对象没有版本
- 文件必须已保存（无未保存修改）；开始编辑时 blame 自动隐藏
- 仅 ABAP 文件（`.abap`）

## 性能说明

- **有缓存** — 对同一文件重新打开 blame 是即时的
- **保存时清缓存** — 确保传输释放后结果是最新的
- 获取时显示进度通知；点击**取消**可中止

## 工作原理

Blame 反向遍历 SAP 版本历史（与 `git blame` 相同的算法）：

1. 从 SAP 获取对象的所有版本（并行批量）
2. 对每对连续版本做 diff，从新到旧
3. 在较新版本中添加/修改的行 → 归因于该版本的作者
4. 未更改的行 → 与下一个更旧的版本比对
5. 遍历所有版本后仍未归因的行 → 归因于最旧版本

# 运行单元测试

直接从 VS Code 运行 ABAP 单元测试——无需打开 SE80 或 ADT。

## 如何运行测试

**方式 1 — VS Code 测试面板（推荐）**

1. 点击活动栏（左侧边栏）中的**烧杯图标**打开测试视图。
2. 在测试树中浏览到你的类或程序。
3. 点击任意测试类或单个方法旁的**运行**（▶）按钮。

**方式 2 — 命令面板**

1. 按 `Ctrl+Shift+P`（Windows/Linux）或 `Cmd+Shift+P`（macOS）。
2. 输入 `ABAP FS: Run ABAP Unit Tests` 并按 `Enter`。

**方式 3 — 让 Copilot 执行**

> “为 ZCL_MY_CLASS 运行单元测试”
> “运行测试并修复所有失败”
> “检查 ZCL_PRICING 的测试是否通过”

## 结果

结果显示在 **VS Code 测试面板**中，包含：

| 信息 | 详情 |
|---|---|
| 通过/失败 | 每个测试方法绿色 ✓ / 红色 ✗ |
| 测试计数 | 总数、通过数、失败数 |
| 执行时间 | 每个方法和总时间 |
| 覆盖率 | 测试覆盖率百分比（可用时） |

失败的测试会内联显示错误消息——点击失败项跳转到相关代码行。

## 与 SE80 / ADT 对比

| | SE80 / ADT | VS Code（ABAP FS） |
|---|---|---|
| 运行测试 | 菜单 → 单元测试 | 烧杯图标或 `Ctrl+Shift+P` |
| 查看结果 | 对话框 / 标签页 | 原生测试面板 |
| Copilot 分析 | 无 | 有——Copilot 可以解释失败并建议修复 |
| 跳转到失败 | 手动 | 点击失败项导航 |

## 要求

- 目标对象必须包含 ABAP 单元测试类（`FOR TESTING`）。
- 必须在 VS Code 中连接到 SAP 系统。

# 创建测试类

为现有类添加 ABAP 单元测试 include——扩展会创建骨架并在编辑器中打开它。

## 要求

- 目标对象必须是类（`*.clas.abap`）
- 该类必须已存在于 SAP 系统上

## 如何创建测试 include

**方式 1 — 右键菜单**

在资源管理器中右键类文件 → **创建测试类 include**

**方式 2 — 命令面板**

1. 按 `Ctrl+Shift+P`
2. 输入 `ABAP FS: Create test class include`
3. 按 `Enter`

**方式 3 — 让 Copilot 执行**

打开 Copilot 聊天并提问：

- *“为 ZCL_MY_CLASS 创建测试类”*
- *“给 ZCL_PRICING 添加单元测试”*
- *“为这个类设置测试”*

## 创建了什么

- 一个链接到主类的测试 include
- 带 `FOR TESTING` 和 `RISK LEVEL HARMLESS` 的骨架测试类
- 新 include 自动在编辑器中打开

## 后续步骤

include 创建后，添加你的测试方法，并用[运行单元测试](#运行单元测试)命令运行它们。

# 测试文档生成器

从测试截图生成专业的 Word 文档——按场景组织，带描述和自定义标题。适用于 Playwright 测试报告、手动 QA 证据和签字确认文档。

## 使用方法

打开 Copilot 聊天面板（`Ctrl+Alt+I`），描述你的场景并附上截图的完整路径：

```
Create test documentation with these screenshots:

Scenario 1: Login Happy Path

- C:\tests\login1.png - Login page displayed
- C:\tests\login2.png - Successful login confirmed

Scenario 2: Error Handling

- C:\tests\error1.png - Invalid credentials message shown
```

Copilot 调用生成器并把 `.docx` 文件保存到你的工作区。

## 文档包含什么

| 元素 | 详情 |
|---|---|
| 标题 | 自定义报告标题（默认 “Test Documentation Report”） |
| 日期 | DD-MM-YYYY 格式的测试日期（默认今天） |
| 场景 | 每个场景有独立章节，包含名称和描述 |
| 截图 | 嵌入的图片，每个截图带说明 |

## 提示

- 截图请使用**绝对路径**（例如 `C:\tests\...`），不要用相对路径
- 每个场景的截图数量和场景数量都不限
- 默认值不合适时，可以在提示中指定自定义标题或日期：*“使用标题 'Regression Test April' 和日期 30-04-2026”*

# Mermaid 图表创建

[Mermaid](https://mermaid.js.org/) 是一种基于文本的图表语言，让你用简单文本描述图表——无需绘图工具。ABAP FS 可以通过 Copilot 聊天直接在 VS Code 中生成和显示 Mermaid 图表。

## 如何创建图表

1. 打开 Copilot 聊天（`Ctrl+Alt+I`）。
2. 描述你想要的图表。例如：
   - *“创建一个流程图，展示方法 `PROCESS_DATA` 的流程”*
   - *“为 `ZCL_MY_CLASS` 生成类图”*
   - *“显示 `ZMY_PROGRAM` 中 BAPI 调用的时序图”*
3. 图表在交互式 WebView 中以 200% 缩放渲染。

## 使用图表查看器

| 操作 | 方式 |
|--------|-----|
| 放大 / 缩小 | 使用 WebView 中的缩放控件（20% 步进） |
| 保存图表 | 点击 WebView 中的保存按钮 |

## 支持的图表类型

流程图 · 时序图 · 类图 · 状态图 · ER 图 · 用户旅程 · 甘特图 · 饼图 · Git 图 · 思维导图 · 时间线 · 桑基图 · XY 图 · 方块图 · 数据包图

## 主题

`default` · `dark` · `forest` · `neutral`

在提示中指定主题：*“创建一个流程图……使用 dark 主题”*

# ABAP 文档

直接在 VS Code 中查找任意 ABAP 关键字的 SAP 帮助，无需离开编辑器。

## 使用方法

1. 在编辑器中打开 ABAP 文件。
2. 把光标放在要查询的关键字上（例如 `SELECT`、`LOOP`、`MODIFY`）。
3. 按 **F1** — 该关键字的 SAP 文档立即打开。

或者，从命令面板（`Ctrl+Shift+P`）运行 **ABAP FS: Show ABAP documentation**。

## 预期效果

- 帮助内容与上下文相关：反映光标下的关键字。
- 文档从 SAP 官方帮助门户获取，并显示在 VS Code 中。

# ABAP Dump 分析

直接在 VS Code 中分析 ST22 运行时 Dump——无需 SAP GUI。

## 这替代了什么

在 SAP GUI 中，你用**事务 ST22** 查找和阅读 Dump。在这里，相同的数据在 VS Code 中即可获得，并带 AI 驱动的根因分析和修复建议。

## 打开 Dump 面板

**活动栏 → ABAP FS 图标 → Dumps**

或直接让 Copilot 执行（见下文[使用 Copilot](#使用-copilot)）。

## 分步工作流

1. **打开 Dump 面板** — 列表显示每个 Dump 的 ID、错误类型、时间戳和大小。
2. **点击 Dump** 打开详细视图。
3. **查看结构化分析** — 扩展解析原始 HTML Dump 内容，以可读格式呈现。
4. **请 Copilot 帮忙** — Copilot 可以基于 Dump 数据识别根因并建议修复。

## 使用 Copilot

在 Copilot 聊天中输入以下任一内容：

| 提示 | 作用 |
|---|---|
| `Analyze the latest dumps` | 列出最近的 Dump 并分析最新一个 |
| `Show me dumps from today` | 过滤为今天的 Dump |
| `What caused the RABAX error?` | 对当前 Dump 做 AI 根因分析 |
| `Analyze dump with ID xyz123` | 按 ID 分析特定 Dump |

## 与 ST22 对比

| ST22（SAP GUI） | VS Code Dump 面板 |
|---|---|
| 手动浏览原始 HTML | 结构化、解析后的输出 |
| 无 AI 辅助 | Copilot 解释原因并建议修复 |
| 与编辑器分离的工具 | 与你的代码内联 |

# 性能跟踪

直接在 VS Code 中分析 ABAP 运行时性能——相当于 SAP GUI 中的 **SAT**（ABAP 跟踪）和 **ST05**（SQL 跟踪），但无需离开编辑器。

## 打开跟踪面板

**活动栏 → ABAP FS 图标 → Traces**

或让 Copilot（Ctrl+Alt+I）：*“显示最近的跟踪运行”*

## 工作流

1. 先在 SAP 系统中**记录跟踪**（照常用 SAT 或 ST05）。
2. 在 VS Code 中打开**跟踪**面板查看你记录的执行。
3. 点击跟踪运行打开，然后选择分析操作。
4. 让 Copilot 解读结果：*“分析这个跟踪的瓶颈”*

## 分析操作

| 操作 | 显示内容 | SAP GUI 等价 |
|---|---|---|
| **列出运行** | 最近的跟踪执行及摘要 | SAT / ST05 命中列表 |
| **分析运行** | 自动瓶颈检测 | SAT 摘要界面 |
| **获取语句** | 语句级耗时（非聚合跟踪） | ST05 语句列表 |
| **获取命中列表** | 命中次数和总耗时（聚合跟踪） | SAT 聚合视图 |
| **列出配置** | 系统上可用的跟踪配置 | SAT 配置 |

> **注意：** 对于聚合跟踪，*获取语句*会自动回退到命中列表。

## Copilot 能做什么

无需浏览面板，直接让 Copilot 执行：

- *“显示今天的跟踪运行”*
- *“分析跟踪 [name] 的瓶颈”*
- *“最后一次跟踪中最慢的 SQL 语句是什么？”*
- *“跟踪 [name] 中有数据库瓶颈吗？”*

Copilot 自动识别：

- **数据库瓶颈** — 昂贵或重复的 SELECT 语句
- **ABAP 处理热点** — 慢的内部表操作或循环
- **性能异常** — 与总运行时间不成比例的语句

## 何时用这个 vs SAT/ST05

当你已经在 VS Code 中工作、想保持上下文，或想让 Copilot 为你解读结果时，使用 VS Code 跟踪面板。需要配置详细的跟踪设置或以交互方式记录新跟踪时，在 SAP GUI 中使用 SAT/ST05。

# 文本元素管理

管理 ABAP 程序、类和函数组中可翻译的文本元素（符号）——这是 SE38/SE24 中**文本元素**选项卡的 VS Code 等价功能。

**支持的对象类型：** 程序 · 类 · 函数组

---

## 打开文本元素管理器

为当前文件打开它有三种方式：

| 方法 | 步骤 |
|--------|-------|
| 命令面板 | `Ctrl+Shift+P` → **ABAP FS: Text Elements Manager** |
| 右键菜单 | 在资源管理器中右键 ABAP 文件 → **文本元素管理器** |
| Copilot | 提问：*“显示 ZTEST_PROGRAM 的文本元素”* |

---

## 你能做什么

### 读取文本元素
适用于**所有 SAP 系统**。在交互式 WebView 中显示现有文本元素 ID 及其翻译。

### 创建 / 更新文本元素
适用于支持 ADT 文本元素 API 的**新版系统**。可以直接在 VS Code 中添加新符号或修改现有文本——无需 SAP GUI。

> **旧系统降级：** 如果 ADT API 不可用，扩展会自动在 SAP GUI 中打开文本元素编辑器。

---

## 分步：编辑文本元素

1. 在编辑器中打开 ABAP 程序、类或函数组。
2. 按 `Ctrl+Shift+P` 运行 **ABAP FS: Text Elements Manager**。
3. WebView 显示该对象的所有现有文本元素。
4. **添加**新元素：输入 ID（例如 `001`）和文本值，然后确认。
5. **修改**现有元素：内联编辑文本并保存。
6. 变更应用到服务器上的活动对象。

---

## 与 SE38 文本元素对比

| SE38 / SE24 | VS Code（ABAP FS） |
|-------------|-------------------|
| 导航到程序 → 转到 → 文本元素 | 命令面板或右键 |
| 在 ABAP 编辑器界面中编辑 | 交互式 WebView |
| 用 `Ctrl+S` 保存 | 在 WebView 内保存 |
| 需要 SAP GUI | 直接在 VS Code 中操作（新版系统） |

---

## 系统兼容性

| 操作 | 旧系统 | 新版系统（ADT API） |
|-----------|--------------|------------------------|
| 读取 | 支持 | 支持 |
| 创建 / 更新 | 打开 SAP GUI 降级 | 支持，在 VS Code 中 |

# 代码正则搜索

使用纯文本或正则表达式（regex）搜索 ABAP 源代码。正则表达式是一种模式语言，可以匹配变化的文本——例如查找任何以 “get” 开头的方法名，或任何词边界匹配。

> **注意：** 只搜索**已提交的代码**。未保存的本地修改不可见——这些请使用标准 VS Code 搜索（`Ctrl+Shift+F`）。

---

## 如何搜索

直接用自然语言让 Copilot 执行：

- *“查找 ZCL_MY_CLASS 中所有 COMMIT WORK 的用法”*
- *“在 ZREPORT_ORDERS 中搜索匹配 'get_\*' 的方法”*
- *“列出 CL_SALV_TABLE 中的所有方法”*

Copilot 自动决定使用字面匹配还是正则匹配。

---

## 字面模式 vs 正则模式

| 模式 | 何时使用 | 示例 |
|------|-------------|---------|
| **字面**（默认） | 精确文本匹配，快速 | `COMMIT WORK` |
| **正则** | 模式、通配符、边界 | `METHOD.*get` |

### 常用正则模式

| 模式 | 匹配内容 | 示例 |
|---------|-----------------|---------|
| `\bICT\b` | 只匹配完整单词 `ICT`（不匹配 `DICT`） | 词边界 |
| `METHOD.*restrict` | `METHOD` 后面跟任意内容再跟 `restrict` | 模式匹配 |
| `[A-Z]+` | 一个或多个大写字母 | 字符类 |
| `^\s*(CLASS-)?METHODS?\s+\w+` | 任意方法声明 | 类结构 |

---

## 搜索多个对象

使用通配符模式一次跨多个对象搜索：

- *“在所有 Z\* 报表中查找 SELECT \*”* — 最多搜索 10 个匹配对象
- Copilot 自动限制范围（1–10 个对象），让结果可控

---

## 查看类结构

列出类中所有方法及其行号：

- *“列出 ZCL_MY_CLASS 中的所有方法”*

Copilot 返回每个方法名及其声明所在行——对浏览大型类很有用。

---

## 提取单个方法

查看一个方法的完整代码：

- *“显示 CL_SALV_TABLE 中的 FACTORY 方法”*

返回从 `METHOD FACTORY.` 到 `ENDMETHOD.` 的所有内容，包括 `IF_SALV_TABLE~FACTORY` 这类接口方法语法。

---

## 上下文行

默认情况下，Copilot 显示每个匹配前后 3 行。可以要求更多或更少：

- *“在 ZCL_ORDERS 中查找 RAISE EXCEPTION，显示 5 行上下文”*

# S/4HANA 就绪仪表盘

使用 SAP 自定义代码迁移工具（事务 SYCM）的数据，可视化自定义代码与 S/4HANA 的兼容性。

## 前置条件

- 先在 SAP 系统上运行事务 **SYCM**——仪表盘读取它填充的分析表（`sycm_sitem`、`sycm_cust_refs` 及相关表）
- 适用于正在评估 S/4HANA 迁移的 ECC 系统

## 打开仪表盘

三种加载方式：

| 方法 | 步骤 |
|--------|-------|
| 活动栏 | **ABAP FS** 面板 → **S/4HANA 就绪**部分 → 点击**加载仪表盘** |
| 命令面板 | `Ctrl+Shift+P` → `ABAP FS: S/4HANA Readiness - Load` |
| Copilot 聊天 | 提问：*“加载 S/4HANA 就绪仪表盘”* |

## 阅读结果

仪表盘显示按**简化项**（SAP Note）分组的树：

```
DRS310 — 156 references in 42 items
├── Summary
├── 2830416 — Remove usage of BSEG (12 refs)
│   ├── ZMY_REPORT
│   └── ZCL_FINANCE
├── 2780106 — ... (5 refs)
│   └── ZFG_CUSTOM
└── Unlinked References
```

- **根节点** — 你的连接 ID，带总数
- **简化项节点** — 影响你代码的每个 SAP Note，带引用数
- **自定义对象节点** — 需要修改的 Z/Y 对象
- **未链接引用** — 无法匹配到简化项的引用

## 处理结果

**打开对象进行编辑**
点击任意自定义对象节点——它直接在编辑器中打开。

**对对象运行 ATC 分析**
右键引用 → **运行 ATC** — 运行限定到该对象的 ATC 检查。

**获取 Copilot 修复建议**
右键引用 → **让 Copilot 修复** — 打开预填了兼容性问题详情的 Copilot 提示。

**打开链接的 SAP Note**
右键简化项 → **打开 SAP Note** — 在浏览器中打开该 Note。

**按名称模式过滤**
使用过滤图标并输入通配符模式，例如 `Z*PRICING*` 或 `Y*`，缩小列表范围。

**刷新 / 清空**
使用**刷新**按钮从 SAP 重新加载，或**清空**移除仪表盘数据。

**多个系统**
可以同时加载多个已连接系统的仪表盘——每个系统显示在自己的根节点下。

## ATC 集成

要获得完整的就绪分析，把仪表盘与 ATC 结合：

1. 把你的 ATC 检查变式设置为 S/4HANA 就绪变式（例如 `S4HANA_READINESS`）
2. 在连接设置中设置 `atcVariant` 属性，默认运行此变式
3. 用仪表盘定位受影响的对象，然后右键 → **运行 ATC** 获取每个对象的详细结果

# RAP 生成器

RAP（RESTful ABAP 编程模型）是 SAP 在 S/4HANA 上构建 OData 服务的现代框架。手动构建 RAP 服务需要创建许多相互依赖的对象——CDS 视图、行为定义、服务定义和绑定。RAP 生成器可以一步从单个数据库表创建完整的技术栈。

## 要求

- 支持 ADT RAP Generator API 的 S/4HANA 或 BTP 系统
- 源数据库表必须已存在于系统上

## 打开 RAP 生成器

三种打开方式：

- **活动栏** → ABAP FS 图标 → **RAP 生成器**面板
- **右键**编辑器中的数据库表 → **生成 RAP 服务**
- **命令面板**（`Ctrl+Shift+P`）→ `ABAP FS: Generate RAP Service`

## 生成服务

1. 从下拉框选择你的 SAP 系统
2. 输入源**数据库表名**——默认工件名称会自动从 SAP 获取
3. 查看并调整生成的名称（CDS 视图、行为定义、服务绑定等）
4. 设置**包**（本地对象留 `$TMP`；其他包会提示传输请求）
5. 点击**预览**查看将创建的对象完整列表
6. 点击**生成**——所有工件在服务器上一次操作创建

生成后，服务绑定会自动在编辑器中打开。

## 生成的工件

| 工件 | 用途 |
|----------|---------|
| CDS 接口视图 | 数据模型层 |
| CDS 投影视图 | 服务投影 / 字段选择 |
| 行为定义 | CRUD 操作和校验 |
| 行为实现类 | 实现行为的 ABAP 类 |
| 服务定义 | 把 CDS 视图作为服务暴露 |
| 服务绑定 | 绑定到 OData V2 或 V4 协议 |
| 草稿表 | 为启用草稿的托管场景创建 |

## 发布和测试

生成后，服务必须先**发布**才能被消费。

- **发布：** 点击面板中的**发布服务**，或使用 `ABAP FS: Publish Service Binding`
- **测试：** 点击**测试服务**在浏览器中打开 OData URL——扩展会检测服务是否已发布，未发布则提供发布选项，然后构建带认证参数的正确 V2/V4 URL。或使用 `ABAP FS: Test Service Binding`

# ADT Feed 阅读器

直接在 VS Code 内实时监控 SAP 系统事件——无需打开 SAP GUI 或手动检查 ST22。

## 设置

1. 打开命令面板（`Ctrl+Shift+P`）
2. 运行 **ABAP FS: Configure ADT Feeds**
3. 选择系统并选择要订阅的 feed
4. 在活动栏侧边栏中打开 **Feed 收件箱**视图

## 支持的 Feed

| Feed | 描述 |
|------|-------------|
| ABAP 运行时错误 | Dump（相当于 ST22） |
| ATC 检查结果 | 代码质量检查结果 |
| 系统消息 | 通过 SM02 发送的广播 |
| URI 创建错误 | ADT 对象解析失败 |

> **注意：** 可用的 feed 取决于 SAP 系统版本。旧系统可能不支持所有类型。

## 配置

每个 feed 都可以按已连接系统独立配置：

- **轮询间隔** — VS Code 检查新条目的频率（默认：120 秒；ATC：24 小时）
- **通知** — 为新条目启用/禁用 VS Code 弹窗提醒
- **查询过滤** — 使用内置模板或编写自定义 OData 过滤器缩小结果范围

## 处理条目

- 点击条目在 WebView 面板中打开详情
- 把条目标记为**已读**或**未读**，跟踪你已查看的内容
- 所有 feed 显示在统一的 **Feed 收件箱**中——无需在视图之间切换

## 要求

目标 SAP 系统必须支持 ADT Feeds API。如果 feed 不可用，请咨询你的 Basis 团队。

# 依赖关系图可视化

把任意 ABAP 对象在整个系统中的使用情况可视化为交互式、可展开的图。

## 打开图表

1. 在编辑器中打开 ABAP 文件
2. *（可选）* 把光标放在特定方法或变量上进行符号级分析
3. 右键 → **可视化依赖关系图**

少于 100 个节点的图会立即渲染。更大的图先调整过滤器，再点击**构建图**。

## 阅读图表

| 颜色 | 含义 |
|---|---|
| 红色 | 根对象（你的起点） |
| 紫色 | 你已展开的节点 |
| 其他颜色 | 按对象类型自动分配 |

节点上的**双边框**表示它有更多可探索的依赖。

## 探索依赖

- **双击节点** — 在编辑器中打开对象，精确定位到使用位置
- **右键节点** — 显示包含打开/展开/聚焦选项的上下文菜单
- **右键 → 展开依赖** — 获取该对象的使用位置并把结果合并到图中
- **悬停** — 显示对象详情：类型、包、负责人、父类（方法）

你可以按需展开任意层级。使用**重置到根**恢复原始图并清除所有展开。

## 过滤

使用过滤面板把大图缩小到关键内容：

- **自定义/标准切换** — 只显示 Z\*/Y\* 对象或只显示 SAP 标准对象
- **对象类型** — 只显示 CLAS、PROG、FUNC 等
- **名称模式** — 支持通配符（例如 `Z*MD*`）
- **使用类型** — 按边的关系类型过滤

实时计数显示每个过滤器匹配多少对象。点击**重置过滤器**清除全部。

## 布局选项

| 布局 | 最适合 |
|---|---|
| **Cose** *（默认）* | 一般用途——基于物理的聚类 |
| **Concentric** | 查看与根对象的距离 |
| **Breadthfirst** | 树形依赖链 |
| **Circle** | 紧凑概览 |
| **Grid** | 有序比较 |

## 导出

点击**导出 SVG** 把当前图保存为静态图片文件。

## 要求

- 编辑器中打开 ABAP 文件
- 活动的 SAP 连接

# ADT 通信日志

实时捕获并显示 VS Code 与 SAP ADT 之间的每个 HTTP 请求和响应。用于诊断慢操作、追踪连接错误，或了解扩展调用了哪些 ADT API。

## 开始记录

1. 打开命令面板（`Ctrl+Shift+P`）
2. 运行 **ABAP FS: Activate Communication Log**
3. 选择要监控的 SAP 连接

**通信日志**面板在屏幕底部打开，并立即开始捕获流量。

## 停止记录

从命令面板运行 **ABAP FS: Deactivate Communication Log**。

> **注意：** 日志只保存在内存中（最多 2000 条）。停用记录或关闭 VS Code 后条目会丢失。

## 阅读日志

点击任意条目展开查看：

- 查询参数
- 请求和响应头
- 请求和响应体（XML 和 JSON 有语法高亮）
- 耗时（毫秒）

## 过滤条目

| 过滤 | 方式 |
|--------|-----|
| 按 SAP 系统 | 下拉框——从所有已记录的连接中选择 |
| 按 HTTP 状态 | 按钮：**成功**（2xx）、**错误**（4xx/5xx）、**进行中** |
| 按 URL | 文本搜索框（200ms 防抖） |

## 其他控件

- **自动滚动** — 切换视图是否固定在最新条目
- **导出** — 把所有可见条目或单个条目保存为 JSON（对 bug 报告很有用）
- **清空** — 从当前视图移除所有条目

## 常见用途

- **慢操作** — 检查哪些 API 调用耗时最长
- **连接错误** — 查看 SAP 返回的确切 HTTP 状态码和错误体
- **Bug 报告** — 把日志导出为 JSON 并附加到 GitHub issue
- **学习 API** — 查看扩展的每个操作实际调用了哪些 ADT 端点

# 虚拟工具分组修复

VS Code 有一个实验性设置（`github.copilot.chat.virtualTools.threshold`），当扩展工具数量超过阈值时会把它们折叠成虚拟分组。该功能生效时，Copilot 常常无法发现这些分组——导致全部 39 个 ABAP FS AI 工具不可见、不可用。

ABAP FS 会在你首次连接 SAP 后检测此状况，并提示你修复。

## 提示何时出现

检查在你首次连接 SAP 系统后运行（不是扩展激活时）。只在以下条件满足时触发：

- 虚拟工具阈值大于 `0`
- AI 模型可用（GitHub Copilot 已登录且激活）
- 你之前没有关闭过该提示

会出现一个非模态通知，带三个选项：

| 选项 | 效果 |
|---|---|
| **禁用并重新加载** | 把阈值全局和工作区都设为 `0`，然后重新加载 VS Code |
| **稍后** | 本次会话跳过提示；下次连接时再次询问 |
| **不再询问** | 永久抑制该提示 |

除非你有特殊原因要保留分组，否则选择**禁用并重新加载**。

## 手动修复

如果你关闭了提示且 AI 工具仍然不可用：

1. 打开设置（`Ctrl+,`）
2. 搜索 `virtualTools.threshold`
3. 把 `github.copilot.chat.virtualTools.threshold` 设为 `0`
4. 重新加载 VS Code（`Ctrl+Shift+P` → **开发者：重新加载窗口**）

## 为什么重要

ABAP FS 注册了 39 个专用工具，涵盖对象搜索、代码读取、单元测试、SQL 查询、传输管理等。如果 Copilot 看不到这些工具，所有 AI 功能都会停止工作。把阈值设为 `0` 会完全禁用分组，保持所有工具可用。

> **注意：** 只有当实验性分组功能激活时才会出现此提示。大多数用户永远不会看到它。

# 重要注意事项

| 功能 | 限制 |
|---|---|
| **创建对象** | 传输请求对话框仍然会出现——对象创建并非全自动。 |
| **文本元素** | 创建/更新操作需要 ADT API 支持（仅限新版 SAP 系统）。 |
| **传输管理** | 旧系统上某些操作会降级为直接查询表。 |
| **代码搜索** | 只搜索已提交的代码——未保存的本地修改不可见。 |
| **批量激活** | 必须从对话框中选择对象；激活不是自动的。 |

## AI 代理代码变更

当 Copilot 在代理模式下编辑 ABAP 代码时，变更会**立即**写入 SAP——在你接受之前。虚拟文件系统会锁定对象、写入内容并解锁，一步完成。

- **Keep** — 用接受的内容触发第二次保存。
- **Undo** — 在服务器上还原变更，就像撤销任何文件编辑一样。

> **仔细审查 AI 生成的代码。** 它在写入的那一刻就已在 SAP 服务器上生效，而不只是在你点击 Keep 之后。

# 关键区别：命令 vs 工具

扩展暴露两种类型的功能：**命令**由你自己调用，**工具**由 GitHub Copilot 代表你调用。

## 命令——你调用它们

命令是你在 VS Code 中直接触发的离散操作。

**如何运行命令：**

- 用 `Ctrl+Shift+P` 打开命令面板并输入 `ABAP FS`
- 点击 VS Code 界面中的按钮（例如编辑器工具栏、资源管理器右键菜单）
- 使用键盘快捷键

**示例：**

| 命令 | 作用 |
|---|---|
| `ABAP FS: Create object` | 打开对话框创建新的 ABAP 对象 |
| `ABAP FS: Run ABAP Unit Tests` | 运行当前对象的单元测试 |
| `ABAP FS: Text Elements Manager` | 打开文本元素编辑器 |

## 语言模型工具——Copilot 调用它们

工具是扩展提供给 GitHub Copilot 的能力。你不直接调用它们——而是在 Copilot 聊天面板中描述需求，Copilot 自动选择并调用正确的工具。

**如何使用：**

- 打开 Copilot 聊天面板（`Ctrl+Alt+I`）
- 用自然语言提问

**示例：**

| 你输入的内容 | Copilot 调用的工具 |
|---|---|
| “BAPI_USER_GET_DETAIL 用在哪里？” | `find_where_used` |
| “给我看看 `ZCL_MY_CLASS` 的代码” | `get_abap_object_lines` |
| “对这个文件运行 ATC 检查” | `run_atc_analysis` |

> **刚接触 VS Code？** 直接操作请从命令开始。想探索或分析 SAP 对象但不知道具体步骤时，用 Copilot 聊天。

# 隐私与遥测

**此扩展不会向外部服务器发送任何数据。** 没有任何数据离开你的机器。

## 收集什么

本地 CSV 文件记录基本使用统计——你使用了哪些工具和命令，以及 Copilot 修改了多少行代码。该文件只存储在你的机器上，永远不会上传到任何地方。

**文件位置：**
```
<VS Code 全局存储>/extension-path/telemetry-<date>.csv
```

你可以随时删除这些文件，不影响扩展。

## 面向组织的中心化遥测

如果你的组织想在内部聚合遥测，可以 fork 公共仓库、添加你自己的 Azure Application Insights 连接字符串、构建自定义 VSIX 并分发。你完全掌控收集什么、存储在哪里、谁能访问。

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
