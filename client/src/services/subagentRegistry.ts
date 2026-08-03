/**
 * 子代理注册表
 *
 * 包含代理元数据、类型和所有可用子代理的注册表。
 */

import * as vscode from "vscode"

// ============================================================================
// 类型
// ============================================================================

/** 代理元数据（模板从文件加载） */
export interface AgentMeta {
  id: string
  name: string
  description: string
  tier: 1 | 2 | 3
  defaultModel: string
  tools: string[] | null // null 表示所有工具（无限制）
  templateFile: string // subagent-templates 文件夹中的文件名
}

export interface EnableResult {
  success: boolean
  error?: "no_workspace" | "missing_models" | "validation_failed"
  missingModels?: string[]
  fileErrors?: Array<{ agentId: string; errors: string[] }>
  fileStatus?: string
}

export interface DisableResult {
  success: boolean
  preserved: boolean
}

export interface SubagentSettings {
  enabled: boolean
  models: Record<string, string>
}

// ============================================================================
// 代理注册表
// ============================================================================

/**
 * 代理元数据注册表 - 模板在单独的文件中
 * 注意：defaultModel 为空 - Copilot 在调用 LM 工具时必须指定模型
 * 工具名使用 package.json 中的 toolReferenceName（例如 'abap-search' 而不是 'search_abap_objects'）
 */
export const AGENT_REGISTRY: AgentMeta[] = [
  {
    id: "abap-orchestrator",
    name: "Orchestrator",
    description: "Master coordinator - routes tasks to specialized agents, writes all code",
    tier: 3,
    defaultModel: "",
    tools: null,
    templateFile: "abap-orchestrator.agent.md"
  },
  {
    id: "abap-code-reviewer",
    name: "Code Reviewer",
    description: "Deep expert code review - security, performance, best practices",
    tier: 3,
    defaultModel: "",
    tools: null,
    templateFile: "abap-code-reviewer.agent.md"
  },
  {
    id: "abap-discoverer",
    name: "Discoverer",
    description: "Find ABAP objects by name pattern, identify types",
    tier: 1,
    defaultModel: "",
    tools: ["abap-search", "abap-info", "connected-systems"],
    templateFile: "abap-discoverer.agent.md"
  },
  {
    id: "abap-reader",
    name: "Reader",
    description: "Read ABAP source code and extract specific information",
    tier: 1,
    defaultModel: "",
    tools: ["abap-lines", "abap-batch", "abap-uri", "abap-search-lines", "abap-info"],
    templateFile: "abap-reader.agent.md"
  },
  {
    id: "abap-usage-analyzer",
    name: "Usage Analyzer",
    description: "Where-used analysis, dependencies, change impact",
    tier: 2,
    defaultModel: "",
    tools: ["abap-where-used", "abap-search", "abap-lines", "abap-info"],
    templateFile: "abap-usage-analyzer.agent.md"
  },
  {
    id: "abap-quality-checker",
    name: "Quality Checker",
    description: "ATC analysis, unit tests, code health checks",
    tier: 2,
    defaultModel: "",
    tools: [
      "atc-analysis",
      "atc-decorations",
      "abap-test",
      "abap_activate",
      "test-include",
      "abap-info"
    ],
    templateFile: "abap-quality-checker.agent.md"
  },
  {
    id: "abap-historian",
    name: "Historian",
    description: "Version history, transport requests, who changed what",
    tier: 2,
    defaultModel: "",
    tools: ["version-history", "transport-requests", "abap-info", "abap-lines"],
    templateFile: "abap-historian.agent.md"
  },
  {
    id: "abap-debugger",
    name: "Debugger",
    description: "Runtime debugging - breakpoints, stepping, variables",
    tier: 2,
    defaultModel: "",
    tools: [
      "debug-session",
      "debug-breakpoint",
      "debug-step",
      "debug-variable",
      "debug-stack",
      "debug-status",
      "abap-workspace-uri",
      "abap-lines"
    ],
    templateFile: "abap-debugger.agent.md"
  },
  {
    id: "abap-troubleshooter",
    name: "Troubleshooter",
    description: "Analyze dumps, traces, performance issues",
    tier: 2,
    defaultModel: "",
    tools: [
      "abap-dumps",
      "abap-traces",
      "abap-lines",
      "abap-info",
      "abap-search-lines",
      "abap_activate"
    ],
    templateFile: "abap-troubleshooter.agent.md"
  },
  {
    id: "abap-data-analyst",
    name: "Data Analyst",
    description: "Query SAP tables, analyze data patterns",
    tier: 2,
    defaultModel: "",
    tools: ["sap-data", "abap-sql-syntax", "connected-systems", "sap-system-info"],
    templateFile: "abap-data-analyst.agent.md"
  },
  {
    id: "abap-creator",
    name: "Creator",
    description: "Create new ABAP objects (blank shells)",
    tier: 1,
    defaultModel: "",
    tools: ["abap-create", "connected-systems", "abap-search", "abap_activate", "abap-test"],
    templateFile: "abap-creator.agent.md"
  },
  {
    id: "abap-visualizer",
    name: "Visualizer",
    description: "Create diagrams from code - class, sequence, flowcharts",
    tier: 1,
    defaultModel: "",
    tools: [
      "mermaid-create",
      "mermaid-validate",
      "mermaid-docs",
      "abap-lines",
      "abap-search-lines",
      "abap-where-used",
      "abap-info"
    ],
    templateFile: "abap-visualizer.agent.md"
  },
  {
    id: "abap-documenter",
    name: "Documenter",
    description: "Generate technical documentation for ABAP objects",
    tier: 1,
    defaultModel: "",
    tools: [
      "abap-lines",
      "abap-batch",
      "abap-search-lines",
      "abap-info",
      "abap-where-used",
      "test-docs"
    ],
    templateFile: "abap-documenter.agent.md"
  }
]

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 获取子代理设置。`enabled` 只从工作区作用域读取，这样
 * 用户级别的 `true` 不会在无关工作区自动触发校验。
 * `models` 使用正常作用域合并，因此用户级默认值仍然生效。
 */
export function getSubagentSettings(): SubagentSettings {
  const config = vscode.workspace.getConfiguration("abapfs.subagents")
  const enabledInspect = config.inspect<boolean>("enabled")
  const enabled = enabledInspect?.workspaceFolderValue ?? enabledInspect?.workspaceValue ?? false
  return {
    enabled,
    models: config.get("models", {})
  }
}

/**
 * 获取代理文件的工作区文件夹（第一个非 ADT 文件夹）
 */
export function getWorkspaceFolder(): vscode.Uri | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined
  }
  // 查找第一个非 ADT 工作区文件夹
  for (const folder of workspaceFolders) {
    if (!folder.uri.scheme.startsWith("adt")) {
      return folder.uri
    }
  }
  return workspaceFolders[0].uri
}

/**
 * 从 VS Code 获取可用的语言模型
 */
export async function getAvailableModels(): Promise<
  Array<{ id: string; name: string; vendor: string; family: string }>
> {
  try {
    const models = await vscode.lm.selectChatModels({})
    return models.map(m => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      family: m.family
    }))
  } catch {
    return []
  }
}

/**
 * 动态获取当前扩展 ID
 */
export function getExtensionId(context: vscode.ExtensionContext): string {
  return context.extension.id
}

/**
 * 构建带扩展前缀的完整工具名
 */
export function buildFullToolName(extensionId: string, toolName: string): string {
  return `${extensionId}/${toolName}`
}

/**
 * 校验配置的模型是否仍然可用
 */
export async function validateModelConfiguration(): Promise<
  Array<{ agentId: string; configuredModel: string; available: boolean }>
> {
  const settings = getSubagentSettings()
  const availableModels = await getAvailableModels()
  const availableNames = new Set(availableModels.map(m => m.name))

  const results: Array<{ agentId: string; configuredModel: string; available: boolean }> = []

  for (const agent of AGENT_REGISTRY) {
    const configuredModel = settings.models[agent.id]
    if (!configuredModel) {
      results.push({
        agentId: agent.id,
        configuredModel: "",
        available: false
      })
    } else {
      results.push({
        agentId: agent.id,
        configuredModel,
        available: availableNames.has(configuredModel)
      })
    }
  }

  return results
}
