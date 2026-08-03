/**
 * MCP 获取诊断工具
 *
 * 仅限 MCP 的工具，为给定 ABAP 文件 URI 返回语法错误/警告/信息。
 * VS Code Copilot 使用其内置的 get_errors 工具；这为 MCP 客户端提供相同功能。
 */

import * as vscode from "vscode"
import { triggerSyntaxCheck } from "../../langClient"

// ============================================================================
// 接口
// ============================================================================

export interface IMcpGetDiagnosticsParams {
  /** ABAP 源文件的完整工作区 URI（例如 'adt://dev100/path/to/file.prog.abap'）。 */
  fileUri: string
}

// ============================================================================
// 核心逻辑
// ============================================================================

/**
 * 为给定文件 URI 获取诊断（错误、警告、信息）。
 * 先打开文档以确保计算出诊断，然后短暂等待。
 */
export async function getDiagnosticsForUri(fileUri: string): Promise<string> {
  const uri = vscode.Uri.parse(fileUri)

  if (uri.scheme !== "adt") {
    throw new Error(
      `Invalid URI scheme '${uri.scheme}'. Expected 'adt://' URI. ` +
        "Use the get_abap_object_workspace_uri tool to get the correct URI."
    )
  }

  // 检查文件是否已在编辑器标签页中打开
  const alreadyOpen = vscode.window.tabGroups.all.some(group =>
    group.tabs.some(tab => {
      if (tab.input instanceof vscode.TabInputText) {
        return tab.input.uri.toString() === uri.toString()
      }
      return false
    })
  )

  let diagnostics: vscode.Diagnostic[]

  if (alreadyOpen) {
    // 文件已打开 - 语言服务器已知道它
    await triggerSyntaxCheck(uri.toString())
    await new Promise(resolve => setTimeout(resolve, 1000))
    diagnostics = vscode.languages.getDiagnostics(uri)
  } else {
    // 文件未打开 - 必须显示它以触发语言服务器中的 didOpen
    try {
      const doc = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: true })
    } catch {
      throw new Error(`File not found: ${fileUri}`)
    }

    // 等待语言服务器 didOpen + 语法检查（服务器在 didOpen 上有 500ms 延迟）
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 也显式触发，以防 didOpen 竞态失败
    await triggerSyntaxCheck(uri.toString())
    await new Promise(resolve => setTimeout(resolve, 1000))

    diagnostics = vscode.languages.getDiagnostics(uri)

    // 关闭我们打开的标签页，避免弄乱编辑器
    const tabToClose = vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .find(tab => {
        if (tab.input instanceof vscode.TabInputText) {
          return tab.input.uri.toString() === uri.toString()
        }
        return false
      })
    if (tabToClose) {
      await vscode.window.tabGroups.close(tabToClose)
    }
  }

  if (diagnostics.length === 0) {
    return `No diagnostics found for ${fileUri}. The file has no syntax errors or warnings.`
  }

  const severityLabel = (s: vscode.DiagnosticSeverity): string => {
    switch (s) {
      case vscode.DiagnosticSeverity.Error:
        return "ERROR"
      case vscode.DiagnosticSeverity.Warning:
        return "WARNING"
      case vscode.DiagnosticSeverity.Information:
        return "INFO"
      case vscode.DiagnosticSeverity.Hint:
        return "HINT"
      default:
        return "UNKNOWN"
    }
  }

  const lines = diagnostics.map(d => {
    const range = `Line ${d.range.start.line + 1}, Col ${d.range.start.character + 1}`
    const severity = severityLabel(d.severity)
    const source = d.source ? ` [${d.source}]` : ""
    return `${severity} ${range}${source}: ${d.message}`
  })

  const errorCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length
  const warningCount = diagnostics.filter(
    d => d.severity === vscode.DiagnosticSeverity.Warning
  ).length

  const summary = `Found ${diagnostics.length} diagnostic(s): ${errorCount} error(s), ${warningCount} warning(s)\n`

  return summary + "\n" + lines.join("\n")
}
