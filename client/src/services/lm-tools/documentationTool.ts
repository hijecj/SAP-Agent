/**
 * ABAP FS 文档工具
 * 访问扩展文档和设置参考
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import * as fs from "fs"
import * as path from "path"
import { assertToolInvocationAuthorized } from "./toolGuard"

// ============================================================================
// 接口
// ============================================================================

export interface IDocumentationToolParameters {
  action: "get_documentation" | "search_documentation" | "get_settings" | "search_settings"
  searchQuery?: string
  startLine?: number
  lineCount?: number
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 从文件读取行
 */
function readFileLines(filePath: string, startLine: number, lineCount: number): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n")

    // 从 1 开始转为从 0 开始
    const start = Math.max(0, startLine - 1)
    const end = Math.min(lines.length, start + lineCount)

    const selectedLines = lines.slice(start, end)
    const totalLines = lines.length

    const header = `Lines ${startLine}-${start + selectedLines.length} of ${totalLines}:\n\n`
    return header + selectedLines.join("\n")
  } catch (error) {
    throw new Error(`Failed to read file: ${error}`)
  }
}

/**
 * 在文件中搜索文本并返回带上下文的匹配行
 * 按空格拆分搜索查询，查找匹配任意单词的行
 */
function searchFileLines(filePath: string, searchQuery: string, contextLines: number = 3): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n")

    // 按空格拆分搜索查询并转小写
    const searchTerms = searchQuery
      .toLowerCase()
      .split(/\s+/)
      .filter(term => term.length > 0)

    const matches: Array<{
      lineNumber: number
      line: string
      context: string[]
      matchedTerms: string[]
    }> = []
    const matchedLineNumbers = new Set<number>()

    // 为每个搜索词查找所有匹配行
    for (const searchTerm of searchTerms) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(searchTerm) && !matchedLineNumbers.has(i + 1)) {
          // 获取前后上下文行
          const contextStart = Math.max(0, i - contextLines)
          const contextEnd = Math.min(lines.length, i + contextLines + 1)
          const contextLinesArray = lines.slice(contextStart, contextEnd)

          // 找出哪些词匹配此行
          const matchedTerms = searchTerms.filter(term => lines[i].toLowerCase().includes(term))

          matches.push({
            lineNumber: i + 1, // 从 1 开始
            line: lines[i],
            context: contextLinesArray,
            matchedTerms
          })
          matchedLineNumbers.add(i + 1)
        }
      }
    }

    if (matches.length === 0) {
      return `No matches found for: "${searchQuery}" (searched for: ${searchTerms.join(", ")})`
    }

    // 按行号排序
    matches.sort((a, b) => a.lineNumber - b.lineNumber)

    // 格式化结果
    let result = `Found ${matches.length} match(es) for: "${searchQuery}"\n`
    result += `Search terms: ${searchTerms.join(", ")}\n\n`

    for (const match of matches) {
      result += ` Line ${match.lineNumber} (matched: ${match.matchedTerms.join(", ")}):\n`
      result += match.context.join("\n")
      result += `\n\n`
    }

    return result
  } catch (error) {
    throw new Error(`Failed to search file: ${error}`)
  }
}

// ============================================================================
// 工具类
// ============================================================================

/**
 * 📚 ABAP FS 文档工具
 */
export class ABAPFSDocumentationTool implements vscode.LanguageModelTool<IDocumentationToolParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDocumentationToolParameters>,
    _token: vscode.CancellationToken
  ) {
    const { action, searchQuery, startLine = 1, lineCount = 50 } = options.input

    let message = ""
    switch (action) {
      case "get_documentation":
        message = `Reading ABAP FS DOCUMENTATION lines ${startLine}-${startLine + lineCount - 1}`
        break
      case "search_documentation":
        message = `Searching ABAP FS DOCUMENTATION for: "${searchQuery}"`
        break
      case "get_settings":
        message = `Reading ABAP FS settings lines ${startLine}-${startLine + lineCount - 1}`
        break
      case "search_settings":
        message = `Searching ABAP FS settings for: "${searchQuery}"`
        break
    }

    return {
      invocationMessage: message
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDocumentationToolParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_abapfs_documentation_called")
    const { action, searchQuery, startLine = 1, lineCount = 50 } = options.input

    // 获取扩展路径
    const extension = vscode.extensions.getExtension("murbani.vscode-abap-remote-fs")
    if (!extension) {
      throw new Error("ABAP FS extension not found")
    }

    const extensionPath = extension.extensionPath
    // 构建期间 webpack 会把文件复制到 client/dist/media
    const docsPath = path.join(extensionPath, "client", "dist", "media", "DOCUMENTATION.md")
    const settingsPath = path.join(extensionPath, "client", "dist", "media", "ABAP-FS-SETTINGS.md")

    let result = ""

    try {
      switch (action) {
        case "get_documentation":
          if (!fs.existsSync(docsPath)) {
            throw new Error("DOCUMENTATION.md not found in extension directory")
          }
          result = readFileLines(docsPath, startLine, lineCount)
          break

        case "search_documentation":
          if (!searchQuery) {
            throw new Error("searchQuery is required for search_documentation action")
          }
          if (!fs.existsSync(docsPath)) {
            throw new Error("DOCUMENTATION.md not found in extension directory")
          }
          result = searchFileLines(docsPath, searchQuery, 3)
          break

        case "get_settings":
          if (!fs.existsSync(settingsPath)) {
            throw new Error("ABAP-FS-SETTINGS.md not found in extension directory")
          }
          result = readFileLines(settingsPath, startLine, lineCount)
          break

        case "search_settings":
          if (!searchQuery) {
            throw new Error("searchQuery is required for search_settings action")
          }
          if (!fs.existsSync(settingsPath)) {
            throw new Error("ABAP-FS-SETTINGS.md not found in extension directory")
          }
          result = searchFileLines(settingsPath, searchQuery, 3)
          break

        default:
          throw new Error(`Unknown action: ${action}`)
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      throw new Error(`Documentation tool error: ${error}`)
    }
  }
}

// ============================================================================
// 注册
// ============================================================================

export function registerDocumentationTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("abap_fs_documentation", new ABAPFSDocumentationTool())
  )
}
