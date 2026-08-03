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
