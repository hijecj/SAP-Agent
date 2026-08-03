/**
 * 子代理文件操作
 *
 * 处理子代理配置的所有文件系统操作：
 * - 加载模板
 * - 写入/更新代理文件
 * - 禁用/恢复代理文件夹
 * - 校验代理文件
 */

import * as vscode from "vscode"
import * as path from "path"
import {
  AgentMeta,
  AGENT_REGISTRY,
  EnableResult,
  DisableResult,
  getSubagentSettings,
  getWorkspaceFolder,
  getExtensionId,
  buildFullToolName
} from "./subagentRegistry"
import { funWindow as window } from "./funMessenger"

// ============================================================================
// 模板操作
// ============================================================================

/**
 * 获取模板目录路径
 */
function getTemplatesDir(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "client", "media", "subagent-templates")
}

/**
 * 获取 dist 模板目录路径（用于 webpack 打包版本）
 */
function getDistTemplatesDir(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "client", "dist", "media", "subagent-templates")
}

/**
 * 从文件加载模板内容
 */
export async function loadTemplate(
  context: vscode.ExtensionContext,
  templateFile: string
): Promise<string> {
  const distPath = path.join(getDistTemplatesDir(context), templateFile)
  const devPath = path.join(getTemplatesDir(context), templateFile)

  try {
    const distUri = vscode.Uri.file(distPath)
    const content = await vscode.workspace.fs.readFile(distUri)
    return Buffer.from(content).toString("utf8")
  } catch {
    try {
      const devUri = vscode.Uri.file(devPath)
      const content = await vscode.workspace.fs.readFile(devUri)
      return Buffer.from(content).toString("utf8")
    } catch (error) {
      throw new Error(`Could not load template ${templateFile}: ${error}`)
    }
  }
}

/**
 * 处理模板内容 - 用实际值替换占位符
 */
export function processTemplate(
  templateContent: string,
  model: string,
  tools: string[] | null,
  extensionId: string
): string {
  let content = templateContent

  // 替换模型占位符
  if (model) {
    content = content.replace(/\{\{MODEL\}\}/g, model)
  } else {
    content = content.replace(/^model:\s*['"]?\{\{MODEL\}\}['"]?\n?/m, "")
  }

  // 存在时替换工具占位符
  if (tools) {
    const fullToolNames = tools.map(t => `'${buildFullToolName(extensionId, t)}'`)
    content = content.replace(/\{\{TOOLS\}\}/g, fullToolNames.join(", "))
  } else {
    content = content.replace(/^tools:\s*\[\{\{TOOLS\}\}\]\n?/m, "")
  }

  return content
}

// ============================================================================
// 迁移
// ============================================================================

/**
 * 修复代理文件中已弃用的 "user-invokable" frontmatter 键。
 * VS Code 已把拼写修正为 "user-invocable" 并弃用旧形式。
 * 对已使用旧拼写代理文件的用户，这会替换它，
 * 使校验不会拒绝这些文件。
 */
async function migrateInvokableSpelling(workspaceUri: vscode.Uri): Promise<number> {
  let fixed = 0
  const folders = [
    vscode.Uri.joinPath(workspaceUri, ".github", "agents"),
    vscode.Uri.joinPath(workspaceUri, ".github", "agents_disabled")
  ]

  for (const dir of folders) {
    let entries: [string, vscode.FileType][]
    try {
      entries = await vscode.workspace.fs.readDirectory(dir)
    } catch {
      continue // folder doesn't exist
    }

    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith(".agent.md")) continue
      const fileUri = vscode.Uri.joinPath(dir, name)
      try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString("utf8")
        if (raw.includes("user-invokable")) {
          const updated = raw.replace(/user-invokable/g, "user-invocable")
          await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updated, "utf8"))
          fixed++
        }
      } catch {
        // 跳过不可读的文件
      }
    }
  }
  return fixed
}

// ============================================================================
// 文件操作
// ============================================================================

/**
 * 刷新文件资源管理器以显示文件夹变化
 */
export async function refreshExplorer(): Promise<void> {
  try {
    await new Promise(resolve => setTimeout(resolve, 500))
    await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer")
  } catch {
    // 命令可能不可用
  }
}

/**
 * 关闭代理文件的任何打开的编辑器，防止幽灵引用
 */
export async function closeAgentEditors(workspaceUri: vscode.Uri): Promise<void> {
  for (const tabGroup of window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        const uri = tab.input.uri
        const filePath = uri.fsPath
        if (
          filePath.includes(".github\\agents\\") ||
          filePath.includes(".github/agents/") ||
          filePath.includes(".github\\agents_disabled\\") ||
          filePath.includes(".github/agents_disabled/")
        ) {
          try {
            await window.tabGroups.close(tab)
          } catch {
            // 标签页可能已关闭
          }
        }
      }
    }
  }
}

/**
 * 写入或更新代理文件，保留用户自定义（如工具）
 * 只更新模型行，其他内容保持不变
 */
export async function writeAgentFile(
  context: vscode.ExtensionContext,
  workspaceUri: vscode.Uri,
  agent: AgentMeta,
  model: string,
  extensionId: string
): Promise<{ created: boolean; updated: boolean; path: string }> {
  const agentsDir = vscode.Uri.joinPath(workspaceUri, ".github", "agents")
  const filePath = vscode.Uri.joinPath(agentsDir, `${agent.id}.agent.md`)

  try {
    await vscode.workspace.fs.createDirectory(agentsDir)
  } catch {
    // 目录可能已存在
  }

  let created = false
  let updated = false

  try {
    const existingContent = await vscode.workspace.fs.readFile(filePath)
    const existingText = Buffer.from(existingContent).toString("utf8")

    // 只更新模型行（保留用户的工具自定义）
    let newContent = existingText
    const modelRegex = /^model:\s*['"]?[^'"}\n]+['"]?$/m
    if (modelRegex.test(newContent)) {
      newContent = newContent.replace(modelRegex, `model: '${model}'`)
    }

    if (newContent !== existingText) {
      await vscode.workspace.fs.writeFile(filePath, Buffer.from(newContent, "utf8"))
      updated = true
    }
  } catch {
    // 文件不存在 - 从模板创建
    const templateContent = await loadTemplate(context, agent.templateFile)
    const content = processTemplate(templateContent, model, agent.tools, extensionId)
    await vscode.workspace.fs.writeFile(filePath, Buffer.from(content, "utf8"))
    created = true
  }

  return { created, updated, path: filePath.fsPath }
}

/**
 * 通过把 agents 文件夹重命名为 agents_disabled 来禁用代理文件
 */
export async function disableAgentFiles(workspaceUri: vscode.Uri): Promise<boolean> {
  const agentsDir = vscode.Uri.joinPath(workspaceUri, ".github", "agents")
  const disabledDir = vscode.Uri.joinPath(workspaceUri, ".github", "agents_disabled")

  try {
    await vscode.workspace.fs.stat(agentsDir)
    await closeAgentEditors(workspaceUri)

    try {
      await vscode.workspace.fs.delete(disabledDir, { recursive: true })
    } catch {
      // 不存在，没关系
    }

    await vscode.workspace.fs.rename(agentsDir, disabledDir)
    await refreshExplorer()
    return true
  } catch {
    return false
  }
}

/**
 * 检查禁用的 agents 文件夹是否存在
 */
export async function hasDisabledAgentFiles(workspaceUri: vscode.Uri): Promise<boolean> {
  const disabledDir = vscode.Uri.joinPath(workspaceUri, ".github", "agents_disabled")
  try {
    await vscode.workspace.fs.stat(disabledDir)
    return true
  } catch {
    return false
  }
}

/**
 * 从 agents_disabled 文件夹恢复代理文件并更新模型名
 */
export async function restoreAgentFiles(
  context: vscode.ExtensionContext,
  workspaceUri: vscode.Uri,
  settings: { models: Record<string, string> }
): Promise<{ restored: number; created: number }> {
  const agentsDir = vscode.Uri.joinPath(workspaceUri, ".github", "agents")
  const disabledDir = vscode.Uri.joinPath(workspaceUri, ".github", "agents_disabled")
  const extensionId = getExtensionId(context)

  let restored = 0
  let created = 0

  try {
    await vscode.workspace.fs.stat(disabledDir)
    await vscode.workspace.fs.rename(disabledDir, agentsDir)
    restored = AGENT_REGISTRY.length

    for (const agent of AGENT_REGISTRY) {
      const model = settings.models[agent.id]
      if (model) {
        try {
          await writeAgentFile(context, workspaceUri, agent, model, extensionId)
        } catch {
          // 文件可能已损坏
        }
      }
    }
  } catch {
    for (const agent of AGENT_REGISTRY) {
      const model = settings.models[agent.id]
      if (model) {
        try {
          const result = await writeAgentFile(context, workspaceUri, agent, model, extensionId)
          if (result.created) created++
        } catch {
          // 模板可能不可用
        }
      }
    }
  }

  await refreshExplorer()
  return { restored, created }
}

/**
 * 校验代理 .md 文件的错误（例如未知模型）
 */
export async function validateAgentFiles(
  workspaceUri: vscode.Uri
): Promise<Array<{ agentId: string; errors: string[] }>> {
  const agentsDir = vscode.Uri.joinPath(workspaceUri, ".github", "agents")
  const fileErrors: Array<{ agentId: string; errors: string[] }> = []

  for (const agent of AGENT_REGISTRY) {
    const filePath = vscode.Uri.joinPath(agentsDir, `${agent.id}.agent.md`)
    try {
      await vscode.workspace.fs.stat(filePath)
      await vscode.workspace.openTextDocument(filePath)
    } catch {
      // 文件不存在
    }
  }

  await new Promise(resolve => setTimeout(resolve, 500))

  for (const agent of AGENT_REGISTRY) {
    const filePath = vscode.Uri.joinPath(agentsDir, `${agent.id}.agent.md`)
    const diagnostics = vscode.languages.getDiagnostics(filePath)

    if (diagnostics.length > 0) {
      const significantIssues = diagnostics.filter(
        d =>
          d.severity === vscode.DiagnosticSeverity.Error ||
          d.severity === vscode.DiagnosticSeverity.Warning
      )

      if (significantIssues.length > 0) {
        const errors = significantIssues.map(d => `Line ${d.range.start.line + 1}: ${d.message}`)
        fileErrors.push({ agentId: agent.id, errors })
      }
    }
  }

  return fileErrors
}

// ============================================================================
// 核心启用/禁用逻辑
// ============================================================================

/**
 * 启用子代理的核心逻辑
 */
export async function enableSubagentsCore(context: vscode.ExtensionContext): Promise<EnableResult> {
  const workspaceFolder = getWorkspaceFolder()
  if (!workspaceFolder) {
    return { success: false, error: "no_workspace" }
  }

  const settings = getSubagentSettings()

  const agentsWithoutModels: string[] = []
  for (const agent of AGENT_REGISTRY) {
    if (!settings.models[agent.id]) {
      agentsWithoutModels.push(agent.id)
    }
  }

  if (agentsWithoutModels.length > 0) {
    return { success: false, error: "missing_models", missingModels: agentsWithoutModels }
  }

  const config = vscode.workspace.getConfiguration("abapfs.subagents")
  await config.update("enabled", true, vscode.ConfigurationTarget.Workspace)

  const hasDisabled = await hasDisabledAgentFiles(workspaceFolder)
  const restoreResult = await restoreAgentFiles(context, workspaceFolder, settings)

  let fileStatus: string
  if (hasDisabled && restoreResult.restored > 0) {
    fileStatus = `Restored ${restoreResult.restored} agent files from agents_disabled folder (with updated model configurations).`
  } else {
    fileStatus = `Created ${restoreResult.created} new agent files.`
  }

  // 校验前修复已弃用的 "user-invokable" → "user-invocable"
  try {
    await migrateInvokableSpelling(workspaceFolder)
  } catch {
    // 非关键
  }

  await new Promise(resolve => setTimeout(resolve, 500))
  const fileErrors = await validateAgentFiles(workspaceFolder)

  if (fileErrors.length > 0) {
    await config.update("enabled", false, vscode.ConfigurationTarget.Workspace)
    await disableAgentFiles(workspaceFolder)
    return { success: false, error: "validation_failed", fileErrors }
  }

  // 检查 customAgentInSubagent 是否启用
  const chatConfig = vscode.workspace.getConfiguration("chat")
  const customAgentEnabled = chatConfig.get<boolean>("customAgentInSubagent.enabled", false)

  if (!customAgentEnabled) {
    const action = await window.showWarningMessage(
      'CRITICAL:Subagents enabled, but "chat.customAgentInSubagent.enabled" is not set. ' +
        "This setting is required for Copilot to use your custom agents when delegating tasks.",
      "Enable Setting",
      "Dismiss"
    )

    if (action === "Enable Setting") {
      await chatConfig.update(
        "customAgentInSubagent.enabled",
        true,
        vscode.ConfigurationTarget.Global
      )
      window.showInformationMessage(
        "Setting enabled! Restart VS Code and then custom agents will be used for task delegation."
      )
    }
  }

  return { success: true, fileStatus }
}

/**
 * 禁用子代理的核心逻辑
 */
export async function disableSubagentsCore(): Promise<DisableResult> {
  const workspaceFolder = getWorkspaceFolder()

  const config = vscode.workspace.getConfiguration("abapfs.subagents")
  await config.update("enabled", false, vscode.ConfigurationTarget.Workspace)

  let preserved = false
  if (workspaceFolder) {
    preserved = await disableAgentFiles(workspaceFolder)
  }

  return { success: true, preserved }
}
