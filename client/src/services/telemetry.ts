/**
 * ABAP FS 遥测服务
 * 集中式遥测收集和存储
 */

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import * as crypto from "crypto"
import { AppInsightsService } from "./appInsightsService"
import { incrementReviewCounter } from "./reviewPrompt"

interface TelemetryEntry {
  timestamp: string // ISO 格式
  sessionId: string // 扩展会话
  userId: string // 匿名哈希
  action: string // "command_xxx_called" or "tool_xxx_called"
  version: string // 扩展版本
}

export class TelemetryService {
  private static instance: TelemetryService
  private sessionId: string
  private userId: string
  private version: string
  private buffer: TelemetryEntry[] = []
  private flushInterval: NodeJS.Timeout | null = null
  private telemetryDir: string
  private isFlushInProgress: boolean = false
  private maxBufferSize: number = 1000

  private constructor(context: vscode.ExtensionContext) {
    // 用加密安全的随机 UUID 生成会话 ID
    this.sessionId = `session-${Date.now()}-${crypto.randomUUID()}`

    // 生成匿名用户 ID（机器信息的哈希）
    const machineInfo = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`
    this.userId = `user-${crypto.createHash("sha256").update(machineInfo).digest("hex").substring(0, 16)}`

    // 获取扩展版本
    this.version =
      vscode.extensions.getExtension("murbani.vscode-abap-remote-fs")?.packageJSON?.version ||
      "unknown"

    // 设置遥测目录
    this.telemetryDir = path.join(context.globalStorageUri.fsPath, "telemetry")
    this.ensureTelemetryDir()

    // 启动定期刷新（每 5 分钟）
    this.startPeriodicFlush()

    // 扩展停用时刷新
    context.subscriptions.push(
      new vscode.Disposable(() => {
        this.flushToFile()
        if (this.flushInterval) {
          clearInterval(this.flushInterval)
        }
      })
    )
  }

  public static initialize(context: vscode.ExtensionContext): void {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService(context)
    }
  }

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      throw new Error("TelemetryService not initialized. Call initialize() first.")
    }
    return TelemetryService.instance
  }

  /**
   * 记录遥测事件
   * @param action - 操作描述（例如 "command_activate_called"、"tool_create_test_include_called"）
   */
  public log(action: string): void {
    const entry: TelemetryEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      userId: this.userId,
      action: action,
      version: this.version
    }

    this.buffer.push(entry)

    // 防止内存泄漏 - 缓冲区过大时丢弃旧条目
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize)
    }

    // 缓冲区变大时立即刷新（但已在刷新则不阻塞）
    if (this.buffer.length >= 25 && !this.isFlushInProgress) {
      this.flushToFile()
    }
  }

  private ensureTelemetryDir(): void {
    try {
      if (!fs.existsSync(this.telemetryDir)) {
        fs.mkdirSync(this.telemetryDir, { recursive: true })
      }
    } catch (error) {
      console.error("Failed to create telemetry directory:", error)
    }
  }

  private startPeriodicFlush(): void {
    // 每 5 分钟刷新
    this.flushInterval = setInterval(
      () => {
        this.flushToFile()
      },
      5 * 60 * 1000
    )
  }

  private flushToFile(): void {
    if (this.buffer.length === 0 || this.isFlushInProgress) return

    // 防止并发刷新
    this.isFlushInProgress = true

    // 复制缓冲区并立即清空，防止竞态条件
    const entriesToFlush = [...this.buffer]
    this.buffer = []

    // 使用异步操作防止阻塞
    setImmediate(async () => {
      try {
        const today = new Date().toISOString().split("T")[0] // YYYY-MM-DD
        const filename = `telemetry-${today}.csv`
        const filepath = path.join(this.telemetryDir, filename)

        // 文件不存在时创建 CSV 头
        let csvContent = ""
        if (!fs.existsSync(filepath)) {
          csvContent = "timestamp,sessionId,userId,action,version\n"
        }

        // 添加要刷新的条目
        for (const entry of entriesToFlush) {
          csvContent += `${entry.timestamp},${entry.sessionId},${entry.userId},${entry.action},${entry.version}\n`
        }

        // 使用异步写入防止阻塞
        await fs.promises.appendFile(filepath, csvContent, "utf8")
      } catch (error) {
        console.error("Failed to flush telemetry to file:", error)
        // 把失败的条目重新加入缓冲区（放在开头以保持顺序）
        this.buffer.unshift(...entriesToFlush)

        // 防止持续失败时缓冲区无限增长
        if (this.buffer.length > this.maxBufferSize) {
          this.buffer = this.buffer.slice(0, this.maxBufferSize)
        }
      } finally {
        this.isFlushInProgress = false
      }
    })
  }

  /**
   * 获取遥测统计（用于调试）
   */
  public getStats(): { bufferSize: number; sessionId: string; userId: string; version: string } {
    return {
      bufferSize: this.buffer.length,
      sessionId: this.sessionId,
      userId: this.userId,
      version: this.version
    }
  }
}

const toolContextKeys: Record<string, string> = {
  // 搜索与发现
  tool_search_abap_objects_called: "abapfs:toolUsed:search",
  tool_search_abap_object_lines_called: "abapfs:toolUsed:searchLines",
  // 读取源代码
  tool_get_abap_object_lines_called: "abapfs:toolUsed:read",
  tool_get_batch_lines_called: "abapfs:toolUsed:read",
  tool_get_object_by_uri_called: "abapfs:toolUsed:read",
  // 对象元数据
  tool_get_abap_object_info_called: "abapfs:toolUsed:objectInfo",
  tool_get_abap_object_workspace_uri_called: "abapfs:toolUsed:objectInfo",
  tool_get_abap_object_url_called: "abapfs:toolUsed:objectInfo",
  tool_open_object_called: "abapfs:toolUsed:openObject",
  // Where-used 分析
  tool_find_where_used_called: "abapfs:toolUsed:whereUsed",
  // 版本历史
  tool_version_history_called: "abapfs:toolUsed:versionHistory",
  // 数据查询
  tool_execute_data_query_called: "abapfs:toolUsed:dataQuery",
  tool_get_abap_sql_syntax_called: "abapfs:toolUsed:dataQuery",
  // ATC / 质量
  tool_run_atc_analysis_called: "abapfs:toolUsed:atc",
  tool_get_atc_decorations_called: "abapfs:toolUsed:atc",
  // 单元测试
  tool_run_unit_tests_called: "abapfs:toolUsed:unitTests",
  tool_create_test_include_called: "abapfs:toolUsed:unitTests",
  tool_create_test_documentation_called: "abapfs:toolUsed:unitTests",
  // 传输
  tool_manage_transport_requests_called: "abapfs:toolUsed:transports",
  // 对象创建
  tool_create_abap_object_called: "abapfs:toolUsed:createObject",
  // 文本元素
  tool_manage_text_elements_called: "abapfs:toolUsed:textElements",
  // 调试（分组 — 6 个调试工具 + Dump + 跟踪分析）
  tool_debug_session_called: "abapfs:toolUsed:debug",
  tool_debug_breakpoint_called: "abapfs:toolUsed:debug",
  tool_debug_step_called: "abapfs:toolUsed:debug",
  tool_debug_variable_called: "abapfs:toolUsed:debug",
  tool_debug_stack_called: "abapfs:toolUsed:debug",
  tool_debug_status_called: "abapfs:toolUsed:debug",
  tool_analyze_abap_dumps_called: "abapfs:toolUsed:dumpAnalysis",
  tool_analyze_abap_traces_called: "abapfs:toolUsed:traceAnalysis",
  // Mermaid 图表
  tool_create_mermaid_diagram_called: "abapfs:toolUsed:mermaid",
  tool_validate_mermaid_syntax_called: "abapfs:toolUsed:mermaid",
  tool_get_mermaid_documentation_called: "abapfs:toolUsed:mermaid",
  tool_detect_mermaid_diagram_type_called: "abapfs:toolUsed:mermaid",
  // 系统信息与已连接系统
  tool_get_sap_system_info_called: "abapfs:toolUsed:systemInfo",
  tool_get_connected_systems_called: "abapfs:toolUsed:connectedSystems",
  // 心跳与子代理
  tool_manage_heartbeat_called: "abapfs:toolUsed:heartbeat",
  tool_manage_subagents_called: "abapfs:toolUsed:subagents",
  // 文档
  tool_abapfs_documentation_called: "abapfs:toolUsed:documentation",
  // 激活
  tool_abap_activate_called: "abapfs:toolUsed:activate"
}

/**
 * 记录遥测的便捷函数
 * @param action - 操作描述（例如 "command_activate_called"、"tool_create_test_include_called"）
 */
function shouldCountForReviewPrompt(action: string): boolean {
  return action.startsWith("command_") || action.startsWith("tool_")
}

export function logTelemetry(
  action: string,
  options?: {
    connectionId?: string
    activeEditor?: vscode.TextEditor
    username?: string
  }
): void {
  try {
    // 现有 CSV 日志
    TelemetryService.getInstance().log(action)

    // 带上下文发送到 App Insights
    AppInsightsService.getInstance().track(action, options)

    // 为特定工具调用设置引导上下文键
    const contextKey = toolContextKeys[action]
    if (contextKey) {
      vscode.commands.executeCommand("setContext", contextKey, true)
    }

    // 只有明确的用户操作才计入评分提示。
    if (shouldCountForReviewPrompt(action)) {
      incrementReviewCounter()
    }
  } catch (error) {
    // 静默失败 - 遥测绝不应破坏功能
    console.error("Telemetry logging failed:", error)
  }
}
