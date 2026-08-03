/**
 * ABAP Dump 分析工具
 * 分析运行时 Dump 用于故障排查
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { getClient } from "../../adt/conections"
import { assertToolInvocationAuthorized } from "./toolGuard"

// ============================================================================
// 接口
// ============================================================================

export interface IDumpAnalysisParameters {
  action: "list_dumps" | "analyze_dump"
  connectionId: string // 必填 - 需要 SAP 系统连接
  dumpId?: string // analyze_dump 操作需要
  maxResults?: number // 用于 list_dumps 操作（默认：20，最大：100）
  includeFullContent?: boolean // 包含原始 HTML 内容用于分析
}

// ============================================================================
// 工具类
// ============================================================================

/**
 * 🔍 ABAP DUMP 分析工具 - 全面 Dump 分析和故障排查
 */
export class ABAPDumpAnalysisTool implements vscode.LanguageModelTool<IDumpAnalysisParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDumpAnalysisParameters>,
    _token: vscode.CancellationToken
  ) {
    const { action, connectionId, dumpId, maxResults = 20 } = options.input

    let actionDescription = ""
    switch (action) {
      case "list_dumps":
        actionDescription = `List available ABAP runtime dumps from system feed (max ${maxResults})`
        break
      case "analyze_dump":
        actionDescription = `Analyze specific dump: ${dumpId}`
        break
    }

    const confirmationMessages = {
      title: "Analyze ABAP Dumps",
      message: new vscode.MarkdownString(
        actionDescription +
          (connectionId ? ` (connection: ${connectionId})` : "") +
          "\n\nThis will access dump data for AI-powered analysis and troubleshooting assistance."
      )
    }

    return {
      invocationMessage: `Analyzing ABAP dumps: ${action}`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDumpAnalysisParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    let {
      action,
      connectionId,
      dumpId,
      maxResults = 20,
      includeFullContent = false
    } = options.input
    logTelemetry("tool_analyze_abap_dumps_called", { connectionId })

    try {
      // connectionId 现在是必填的
      const actualConnectionId = connectionId.toLowerCase()

      const client = getClient(actualConnectionId)

      // 按操作校验必填参数
      if (action === "analyze_dump" && !dumpId) {
        throw new Error("dumpId parameter is required for analyze_dump action")
      }

      switch (action) {
        case "list_dumps":
          return await this.listDumps(client, actualConnectionId, maxResults)

        case "analyze_dump":
          return await this.analyzeDump(client, actualConnectionId, dumpId!, includeFullContent)

        default:
          throw new Error(`Unknown action: ${action}`)
      }
    } catch (error) {
      throw new Error(`Failed to analyze ABAP dumps: ${String(error)}`)
    }
  }

  private async listDumps(
    client: any,
    connectionId: string,
    maxResults: number
  ): Promise<vscode.LanguageModelToolResult> {
    // 安全限制，防止过多 API 调用
    maxResults = Math.min(maxResults, 100)
    try {
      // 检查 Dump feed 是否可用
      const feeds = await client.feeds()
      const dumpFeed = feeds.find((f: any) => f.href === "/sap/bc/adt/runtime/dumps")

      if (!dumpFeed) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Dumps not available — this SAP system does not support dump access via ADT API.`
          )
        ])
      }

      const dumpfeed = await client.dumps()
      const dumps = dumpfeed.dumps || []

      if (dumps.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No dumps found — no recent ABAP runtime errors in system ${connectionId}.`
          )
        ])
      }

      // 限制结果
      const limitedDumps = dumps.slice(0, maxResults)

      let result = `ABAP Runtime Dumps (${limitedDumps.length} of ${dumps.length} total)\n`
      result += `System: ${connectionId}\n\n`
      result += `To analyze a specific dump, call analyze_dump with the exact Dump ID below.\n\n`

      for (let i = 0; i < limitedDumps.length; i++) {
        const dump = limitedDumps[i]
        const errorType =
          dump.categories?.find((c: any) => c.label === "ABAP runtime error")?.term ||
          "Unknown Error"

        result += `${i + 1}. ${errorType}\n`
        result += `   Dump ID: ${dump.id || "N/A"}\n`
        if (dump.updated) result += `   Timestamp: ${new Date(dump.updated).toLocaleString()}\n`
        if (dump.text) result += `   Content Size: ${Math.round(dump.text.length / 1024)}KB\n`
        result += `\n`
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      throw new Error(`Failed to list dumps: ${String(error)}`)
    }
  }

  private async analyzeDump(
    client: any,
    connectionId: string,
    dumpId: string,
    includeFullContent: boolean
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const dumpfeed = await client.dumps()
      const dump = dumpfeed.dumps?.find((d: any) => d.id === dumpId)

      if (!dump) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Dump not found — no dump with ID "${dumpId}" in system ${connectionId}.`
          )
        ])
      }

      const errorType =
        dump.categories?.find((c: any) => c.label === "ABAP runtime error")?.term || "Unknown Error"

      let result = `ABAP Dump Analysis\n`
      result += `System: ${connectionId}\n`
      result += `Dump ID: ${dumpId}\n`
      result += `Error Type: ${errorType}\n`
      if (dump.updated) result += `Timestamp: ${new Date(dump.updated).toLocaleString()}\n`
      result += `\n`

      // 分析 HTML 内容结构（不做不可靠的解析）
      if (dump.text) {
        const htmlContent = dump.text

        result += `Content Size: ${Math.round(htmlContent.length / 1024)}KB HTML\n`

        const hasTableStructure = htmlContent.includes("<table") || htmlContent.includes("<tr")
        const hasPreformatted = htmlContent.includes("<pre>") || htmlContent.includes("<code>")
        const hasLinks = htmlContent.includes("href")

        if (hasTableStructure) result += `Contains tabular data\n`
        if (hasPreformatted) result += `Contains code blocks\n`
        if (hasLinks) result += `Contains navigation links\n`

        if (includeFullContent) {
          result += `\nFull Dump Content:\n`
          result += `\`\`\`html\n${htmlContent}\n\`\`\`\n`
        }
      } else {
        result += `No detailed content available\n`
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      throw new Error(`Failed to analyze dump: ${String(error)}`)
    }
  }
}

// ============================================================================
// 注册
// ============================================================================

export function registerDumpAnalysisTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("analyze_abap_dumps", new ABAPDumpAnalysisTool())
  )
}
