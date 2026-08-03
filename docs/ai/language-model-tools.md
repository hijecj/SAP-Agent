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
