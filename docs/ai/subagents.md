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
