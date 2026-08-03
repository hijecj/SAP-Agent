/**
 * ABAP 跟踪分析工具
 * 性能分析和优化洞察
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logCommands } from "../abapCopilotLogger"
import { logTelemetry } from "../telemetry"
import { getClient } from "../../adt/conections"
import { assertToolInvocationAuthorized } from "./toolGuard"

// ============================================================================
// 接口
// ============================================================================

export interface ITraceAnalysisParameters {
  action: "list_runs" | "list_configurations" | "analyze_run" | "get_statements" | "get_hitlist"
  connectionId: string // 必填 - 需要 SAP 系统连接
  traceId?: string // analyze_run、get_statements、get_hitlist 需要
  maxResults?: number // 用于列出操作（默认：20）
  includeDetails?: boolean // 包含详细性能数据
}

// ============================================================================
// 工具类
// ============================================================================

/**
 * 📈 ABAP 跟踪分析工具 - 性能分析和优化洞察
 */
export class ABAPTraceAnalysisTool implements vscode.LanguageModelTool<ITraceAnalysisParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ITraceAnalysisParameters>,
    _token: vscode.CancellationToken
  ) {
    const { action, connectionId, traceId, maxResults = 20 } = options.input

    let actionDescription = ""
    switch (action) {
      case "list_runs":
        actionDescription = `List recent trace runs (max ${maxResults})`
        break
      case "list_configurations":
        actionDescription = `List trace configurations`
        break
      case "analyze_run":
        actionDescription = `Analyze trace run: ${traceId}`
        break
      case "get_statements":
        actionDescription = `Get statement-level data for trace: ${traceId}`
        break
      case "get_hitlist":
        actionDescription = `Get hit list data for trace: ${traceId}`
        break
    }

    const confirmationMessages = {
      title: "Analyze ABAP Traces",
      message: new vscode.MarkdownString(
        actionDescription +
          (connectionId ? ` (connection: ${connectionId})` : "") +
          "\n\nThis will access trace data for AI-powered performance analysis and optimization insights."
      )
    }

    return {
      invocationMessage: `Analyzing ABAP traces: ${action}`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ITraceAnalysisParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    let { action, connectionId, traceId, maxResults = 20, includeDetails = false } = options.input
    logTelemetry("tool_analyze_abap_traces_called", { connectionId })

    try {
      // connectionId 现在是必填的
      const actualConnectionId = connectionId.toLowerCase()

      const client = getClient(actualConnectionId)

      // 按操作校验必填参数
      const traceActions = ["analyze_run", "get_statements", "get_hitlist"]
      if (traceActions.includes(action) && !traceId) {
        throw new Error(`traceId parameter is required for ${action} action`)
      }

      switch (action) {
        case "list_runs":
          return await this.listTraceRuns(client, actualConnectionId, maxResults)

        case "list_configurations":
          return await this.listTraceConfigurations(client, actualConnectionId, maxResults)

        case "analyze_run":
          return await this.analyzeTraceRun(client, actualConnectionId, traceId!, includeDetails)

        case "get_statements":
          return await this.getTraceStatements(client, actualConnectionId, traceId!)

        case "get_hitlist":
          return await this.getTraceHitList(client, actualConnectionId, traceId!)

        default:
          throw new Error(`Unknown action: ${action}`)
      }
    } catch (error) {
      throw new Error(`Failed to analyze ABAP traces: ${String(error)}`)
    }
  }

  private async listTraceRuns(
    client: any,
    connectionId: string,
    maxResults: number
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { runs } = await client.tracesList()

      if (!runs || runs.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No trace runs found — no recent trace executions in system ${connectionId}.`
          )
        ])
      }

      // 按发布日期排序（新的在前）并限制结果
      const sortedRuns = runs.sort(
        (a: any, b: any) => b.published.getTime() - a.published.getTime()
      )
      const limitedRuns = sortedRuns.slice(0, maxResults)

      let result = `ABAP Trace Runs (${limitedRuns.length} of ${runs.length} total)\n`
      result += `System: ${connectionId}\n\n`

      for (let i = 0; i < limitedRuns.length; i++) {
        const run = limitedRuns[i]
        const { author, type, extendedData } = run
        const {
          runtime,
          host,
          objectName,
          runtimeABAP,
          runtimeDatabase,
          runtimeSystem,
          isAggregated,
          state
        } = extendedData

        const totalRuntime = runtimeABAP + runtimeDatabase + runtimeSystem || 1
        const abapPercent = Math.round((runtimeABAP / totalRuntime) * 100)
        const dbPercent = Math.round((runtimeDatabase / totalRuntime) * 100)
        const sysPercent = Math.round((runtimeSystem / totalRuntime) * 100)

        result += `${i + 1}. ${run.title} (${run.id})\n`
        result += `   Object: ${objectName} | Author: ${author}\n`
        result += `   Runtime: ${runtime}ms (ABAP: ${abapPercent}%, DB: ${dbPercent}%, Sys: ${sysPercent}%)\n`
        result += `   Published: ${run.published.toLocaleString()}\n`
        result += `   Type: ${isAggregated ? "Aggregated" : "Detailed"}\n`
        if (state.value === "E") result += `   ERROR STATE\n`
        result += `\n`
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      throw new Error(`Failed to list trace runs: ${String(error)}`)
    }
  }

  private async listTraceConfigurations(
    client: any,
    connectionId: string,
    maxResults: number
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { requests } = await client.tracesListRequests()

      if (!requests || requests.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No trace configurations found — no trace configurations in system ${connectionId}.`
          )
        ])
      }

      const limitedConfigs = requests.slice(0, maxResults)

      let result = `ABAP Trace Configurations (${limitedConfigs.length} of ${requests.length} total)\n`
      result += `System: ${connectionId}\n\n`

      for (let i = 0; i < limitedConfigs.length; i++) {
        const config = limitedConfigs[i]
        const { extendedData } = config
        const { objectType, processType, executions, host, isAggregated } = extendedData
        const admin = config.authors?.find((a: any) => a.role === "admin")?.name || "Unknown"
        const tracer = config.authors?.find((a: any) => a.role === "trace")?.name || "Unknown"

        result += `${i + 1}. ${config.title} (${config.id})\n`
        result += `   Host: ${host} | Admin: ${admin} | Tracer: ${tracer}\n`
        result += `   Process: ${processType} | Object: ${objectType}\n`
        result += `   Completed: ${executions.completed}/${executions.maximal} | Detailed: ${!isAggregated}\n`
        result += `   Published: ${config.published.toLocaleString()}\n`
        result += `\n`
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      throw new Error(`Failed to list trace configurations: ${String(error)}`)
    }
  }

  private async analyzeTraceRun(
    client: any,
    connectionId: string,
    traceId: string,
    includeDetails: boolean
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { runs } = await client.tracesList()
      const run = runs?.find((r: any) => r.id === traceId)

      if (!run) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Trace run not found — no trace run with ID "${traceId}" in system ${connectionId}.`
          )
        ])
      }

      const { author, type, extendedData } = run
      const {
        runtime,
        host,
        objectName,
        runtimeABAP,
        runtimeDatabase,
        runtimeSystem,
        isAggregated,
        state,
        system
      } = extendedData

      const totalRuntime = runtimeABAP + runtimeDatabase + runtimeSystem || 1
      const abapPercent = Math.round((runtimeABAP / totalRuntime) * 100)
      const dbPercent = Math.round((runtimeDatabase / totalRuntime) * 100)
      const sysPercent = Math.round((runtimeSystem / totalRuntime) * 100)

      let result = `ABAP Trace Run Analysis\n`
      result += `System: ${connectionId}\n`
      result += `Trace ID: ${traceId}\n`
      result += `Title: ${run.title}\n`
      result += `Published: ${run.published.toLocaleString()}\n\n`

      result += `Performance Summary:\n`
      result += `• Total Runtime: ${runtime}ms\n`
      result += `• ABAP Runtime: ${runtimeABAP}ms (${abapPercent}%)\n`
      result += `• Database Runtime: ${runtimeDatabase}ms (${dbPercent}%)\n`
      result += `• System Runtime: ${runtimeSystem}ms (${sysPercent}%)\n\n`

      result += `Execution Context:\n`
      result += `• Object: ${objectName}\n`
      result += `• Author: ${author}\n`
      result += `• Host: ${host}\n`
      result += `• System: ${system}\n`
      result += `• State: ${state.text} (${state.value})\n`
      result += `• Data Type: ${isAggregated ? "Aggregated Summary" : "Detailed Statements"}\n\n`

      // 性能分析
      if (state.value === "E") {
        result += `ERROR STATE — trace execution failed\n`
      }
      if (dbPercent > 50) {
        result += `Database Bottleneck — ${dbPercent}% database time\n`
      }
      if (abapPercent > 80) {
        result += `ABAP Intensive — ${abapPercent}% ABAP processing\n`
      }
      if (runtime > 10000) {
        result += `Long Execution — ${runtime}ms total\n`
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      throw new Error(`Failed to analyze trace run: ${String(error)}`)
    }
  }

  private async getTraceStatements(
    client: any,
    connectionId: string,
    traceId: string
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      logCommands.info(`Getting trace statements for trace ${traceId} on ${connectionId}`)

      // 首先，检查跟踪是否已聚合
      const { runs } = await client.tracesList()
      const run = runs?.find((r: any) => r.id === traceId)

      if (!run) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Trace run not found — no trace run with ID "${traceId}" in system ${connectionId}.`
          )
        ])
      }

      const isAggregated = run.extendedData?.isAggregated

      // 如果跟踪已聚合，自动使用命中列表而不是语句
      if (isAggregated) {
        logCommands.info(
          `Trace ${traceId} is aggregated - automatically using hit list instead of statements`
        )
        return this.getTraceHitList(client, connectionId, traceId)
      }

      logCommands.info(`Trace ${traceId} supports detailed statements - fetching statement data`)
      const statements = await client.tracesStatements(traceId, {
        withSystemEvents: true,
        withDetails: true
      })

      logCommands.info(`Trace statements response type: ${typeof statements}`)
      logCommands.info(
        `Trace statements keys: ${statements ? Object.keys(statements).join(", ") : "null"}`
      )

      if (!statements) {
        logCommands.error(`Trace statements returned null/undefined`)
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No data returned from SAP — trace ${traceId} returned empty response.`
          )
        ])
      }

      if (!statements.statements) {
        logCommands.error(
          `Trace statements object missing 'statements' property. Available keys: ${Object.keys(statements).join(", ")}`
        )
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Invalid data structure — expected 'statements' property not found in response.`
          )
        ])
      }

      if (statements.statements.length === 0) {
        logCommands.info(`Trace ${traceId} has empty statements array`)
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No statement data available — trace ${traceId} contains no detailed statements.`
          )
        ])
      }

      logCommands.info(`Found ${statements.statements.length} statements`)

      const stmts = statements.statements

      let result = `ABAP Trace Statements Analysis\n`
      result += `System: ${connectionId}\n`
      result += `Trace ID: ${traceId}\n`
      result += `Total Statements: ${stmts.length}\n\n`

      // 按净时间排序（降序）以先显示性能热点
      const sortedStmts = stmts.sort(
        (a: any, b: any) => (b.traceEventNetTime?.time || 0) - (a.traceEventNetTime?.time || 0)
      )

      // 显示前 20 个性能热点
      const topStatements = sortedStmts.slice(0, 20)

      result += `Top Performance Hotspots (Top 20):\n`

      for (let i = 0; i < topStatements.length; i++) {
        const stmt = topStatements[i]
        const { hitCount, traceEventNetTime, grossTime, description, callingProgram, callLevel } =
          stmt
        const netTime = traceEventNetTime?.time || 0
        const grossTimeVal = grossTime?.time || 0
        const program = callingProgram?.name || "Unknown"
        const context = callingProgram?.context || ""

        result += `${i + 1}. ${description || "Unknown Statement"}\n`
        result += `   Net: ${netTime}ms | Gross: ${grossTimeVal}ms | Hits: ${hitCount} | CallLevel: ${callLevel}\n`
        result += `   Program: ${program}${context ? ` (${context})` : ""}\n`
        if (hitCount > 0) {
          result += `   Avg/Hit: ${Math.round(netTime / hitCount)}ms\n`
        }
        result += `\n`
      }

      // 性能统计
      const totalNetTime = stmts.reduce(
        (sum: number, stmt: any) => sum + (stmt.traceEventNetTime?.time || 0),
        0
      )
      const totalHits = stmts.reduce((sum: number, stmt: any) => sum + (stmt.hitCount || 0), 0)
      const maxCallLevel = Math.max(...stmts.map((stmt: any) => stmt.callLevel || 0))

      result += `Statement Statistics:\n`
      result += `• Total Net Time: ${totalNetTime}ms\n`
      result += `• Total Hits: ${totalHits}\n`
      result += `• Max Call Depth: ${maxCallLevel}\n`
      result += `• Avg Time/Statement: ${Math.round(totalNetTime / stmts.length)}ms\n`
      result += `• Avg Hits/Statement: ${Math.round(totalHits / stmts.length)}\n`

      // 性能洞察
      const highHitStmts = stmts.filter((stmt: any) => (stmt.hitCount || 0) > 100)
      const slowStmts = stmts.filter((stmt: any) => {
        const netTime = stmt.traceEventNetTime?.time || 0
        const hitCount = stmt.hitCount || 1
        return netTime / hitCount > 100
      })

      if (highHitStmts.length > 0 || slowStmts.length > 0) {
        result += `\nPerformance Issues:\n`
        if (highHitStmts.length > 0) {
          result += `• High Frequency: ${highHitStmts.length} statements >100 hits\n`
        }
        if (slowStmts.length > 0) {
          result += `• Slow Execution: ${slowStmts.length} statements >100ms per hit\n`
        }
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      logCommands.error(`Failed to get trace statements: ${error}`)
      logCommands.error(`Error type: ${typeof error}`)
      logCommands.error(
        `Error details: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`
      )
      throw new Error(`Failed to get trace statements: ${String(error)}`)
    }
  }

  private async getTraceHitList(
    client: any,
    connectionId: string,
    traceId: string
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const hitlist = await client.tracesHitList(traceId, true)

      if (!hitlist || !hitlist.entries || hitlist.entries.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No hit list data available — trace ${traceId} contains no hit list information.`
          )
        ])
      }

      const entries = hitlist.entries

      let result = `ABAP Trace Hit List Analysis\n`
      result += `System: ${connectionId}\n`
      result += `Trace ID: ${traceId}\n`
      result += `Total Entries: ${entries.length}\n\n`

      // 按净时间排序（降序）以先显示性能热点
      const sortedEntries = entries.sort(
        (a: any, b: any) => (b.traceEventNetTime?.time || 0) - (a.traceEventNetTime?.time || 0)
      )

      // 显示前 15 个性能热点
      const topEntries = sortedEntries.slice(0, 15)

      result += `Top Performance Hotspots (Top 15):\n`

      for (let i = 0; i < topEntries.length; i++) {
        const entry = topEntries[i]
        const { hitCount, traceEventNetTime, grossTime, description, callingProgram } = entry
        const netTime = traceEventNetTime?.time || 0
        const grossTimeVal = grossTime?.time || 0
        const program = callingProgram?.name || "Unknown"
        const context = callingProgram?.context || ""
        const uri = callingProgram?.uri || ""

        result += `${i + 1}. ${description || "Unknown Operation"}\n`
        result += `   Net: ${netTime}ms | Gross: ${grossTimeVal}ms | Hits: ${hitCount}\n`
        result += `   Program: ${program}${context ? ` (${context})` : ""}\n`
        if (hitCount > 0) {
          result += `   Avg/Hit: ${Math.round(netTime / hitCount)}ms\n`
        }
        if (uri) {
          result += `   URI: ${uri}\n`
        }
        result += `\n`
      }

      // 命中列表统计
      const totalNetTime = entries.reduce(
        (sum: number, entry: any) => sum + (entry.traceEventNetTime?.time || 0),
        0
      )
      const totalHits = entries.reduce((sum: number, entry: any) => sum + (entry.hitCount || 0), 0)
      const uniquePrograms = new Set(
        entries.map((entry: any) => entry.callingProgram?.name).filter(Boolean)
      )

      result += `Hit List Statistics:\n`
      result += `• Total Net Time: ${totalNetTime}ms\n`
      result += `• Total Hits: ${totalHits}\n`
      result += `• Unique Programs: ${uniquePrograms.size}\n`
      result += `• Avg Time/Entry: ${Math.round(totalNetTime / entries.length)}ms\n`
      result += `• Avg Hits/Entry: ${Math.round(totalHits / entries.length)}\n`

      // 命中列表分析
      const highHitEntries = entries.filter((entry: any) => (entry.hitCount || 0) > 50)
      const inefficientEntries = entries.filter((entry: any) => {
        const netTime = entry.traceEventNetTime?.time || 0
        const hitCount = entry.hitCount || 1
        return netTime / hitCount > 50
      })

      if (highHitEntries.length > 0 || inefficientEntries.length > 0) {
        result += `\nPerformance Issues:\n`
        if (highHitEntries.length > 0) {
          result += `• High Frequency: ${highHitEntries.length} entries >50 hits\n`
        }
        if (inefficientEntries.length > 0) {
          result += `• Inefficient: ${inefficientEntries.length} entries >50ms per hit\n`
        }
      }

      // 程序分布
      const programHits = new Map<string, number>()
      entries.forEach((entry: any) => {
        const program = entry.callingProgram?.name
        if (program) {
          programHits.set(program, (programHits.get(program) || 0) + (entry.hitCount || 0))
        }
      })

      if (programHits.size > 0) {
        result += `\nProgram Hit Distribution:\n`
        const sortedPrograms = Array.from(programHits.entries())
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)

        for (const [program, hits] of sortedPrograms) {
          const percentage = Math.round((hits / totalHits) * 100)
          result += `• ${program}: ${hits} hits (${percentage}%)\n`
        }
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)])
    } catch (error) {
      throw new Error(`Failed to get trace hit list: ${String(error)}`)
    }
  }
}

// ============================================================================
// 注册
// ============================================================================

export function registerTraceAnalysisTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("analyze_abap_traces", new ABAPTraceAnalysisTool())
  )
}
