/**
 * 💓 心跳 LM 客户端
 *
 * 处理心跳运行的语言模型 API 调用。
 * 使用 vscode.lm API 调用带所有已注册工具的模型。
 *
 * 从 heartbeat.json 读取任务，并指示 LLM 检查每个任务。
 * LLM 还可以更新任务状态和添加/移除任务。
 */

import * as vscode from "vscode"
import { HeartbeatConfig, parseHeartbeatResponse, HEARTBEAT_OK_TOKEN } from "./heartbeatTypes"
import { HeartbeatWatchlist } from "./heartbeatWatchlist"
import { log } from "../../lib"

/**
 * 运行单次心跳的结果
 */
export interface HeartbeatLMResult {
  status: "ok" | "alert" | "error"
  response: string
  toolsUsed: string[]
  durationMs: number
  error?: string
}

/**
 * 从配置和监控列表构建心跳提示
 */
function buildHeartbeatPrompt(config: HeartbeatConfig): string {
  // 配置了自定义提示则直接使用
  if (config.prompt) {
    return config.prompt
  }

  // 从监控列表获取任务（只取到期的，不取未来调度的）
  const watchlistPrompt = HeartbeatWatchlist.formatForPrompt()
  const dueTasks = HeartbeatWatchlist.getDueTasks()
  const hasAnyDueTasks = dueTasks.length > 0

  const lines = [
    "# Heartbeat Check",
    "",
    "You are a background assistant checking on SAP systems and other tasks.",
    "Your response will be PARSED BY A SYSTEM, not read directly by the user.",
    "You must follow the rules precisely, or your notifications will not reach the user.",
    "",
    `## CRITICAL: About ${HEARTBEAT_OK_TOKEN}`,
    `If your response contains "${HEARTBEAT_OK_TOKEN}" ANYWHERE, NO ALERT will be shown to the user.`,
    `Only include ${HEARTBEAT_OK_TOKEN} when there is genuinely NOTHING to notify.`,
    `If you have something to tell the user but accidentally include ${HEARTBEAT_OK_TOKEN}, they will MISS IT.`,
    "",
    "---",
    "",
    watchlistPrompt,
    "",
    "---",
    ""
  ]

  if (hasAnyDueTasks) {
    lines.push("## REQUIRED ACTIONS FOR EACH TASK:")
    lines.push("")
    lines.push("**You MUST process each task listed above. Do not skip tasks!**")
    lines.push("")
    lines.push("### For Reminders (category: reminder):")
    lines.push("1. Notify the user with the reminder message in your response")
    lines.push('2. Call manage_heartbeat with action "remove_task" to delete it')
    lines.push("")
    lines.push("### For Monitoring Tasks with SQL:")
    lines.push("1. Call execute_data_query with the provided sampleQuery")
    lines.push("2. Follow the checkInstructions to interpret results")
    lines.push('3. Call manage_heartbeat "update_task" to save your findings in lastResult')
    lines.push("4. If new issues found AND not in cooldown → include alert in your response")
    lines.push("")
    lines.push("### For Tasks using analyze_abap_dumps:")
    lines.push('1. Call analyze_abap_dumps with action "list_dumps"')
    lines.push("2. Compare against lastNotifiedFindings for new dumps")
    lines.push("3. Update task with findings")
    lines.push("")
    lines.push("### Cooldown Handling:")
    lines.push('- If "⏸️ Cooldown Active" is shown, still CHECK and UPDATE the task')
    lines.push("- Just don't include an alert for that task in your response")
    lines.push("")
    lines.push("---")
    lines.push("")
    lines.push("## YOUR RESPONSE:")
    lines.push("")
    lines.push(
      `If ALL tasks were checked and there's NOTHING to tell the user → respond with EXACTLY: ${HEARTBEAT_OK_TOKEN}`
    )
    lines.push("(No quotes, no markdown, no punctuation, no extra text - just that single token)")
    lines.push("")
    lines.push(
      "If there ARE things to tell the user (reminders, new issues) → write a helpful message describing them."
    )
    lines.push(`Do NOT include ${HEARTBEAT_OK_TOKEN} in alert messages.`)
    lines.push("")
    lines.push("**Remember: Check every task, update every task, but only ALERT when needed.**")
  } else {
    lines.push(`No tasks are due right now. Respond with: ${HEARTBEAT_OK_TOKEN}`)
  }

  return lines.join("\n")
}

// 用于识别 ABAP FS 工具的标签
const ABAP_FS_TAG = "abap-fs"

/**
 * 获取已配置的语言模型
 * 需要在设置中设置 model - 不自动选择
 */
async function getLanguageModel(
  configuredModel?: string
): Promise<vscode.LanguageModelChat | null> {
  try {
    // 必须在设置中配置模型
    if (!configuredModel || configuredModel.trim().length === 0) {
      log("💓 No model configured. Set abapfs.heartbeat.model in settings.")
      return null
    }

    const models = await vscode.lm.selectChatModels({})

    if (models.length === 0) {
      log("💓 No language models available")
      return null
    }

    const searchTerm = configuredModel.trim().toLowerCase()

    // 查找配置的模型 - 先尝试精确匹配，然后部分匹配
    let model = models.find(
      m => m.name.toLowerCase() === searchTerm || m.id.toLowerCase() === searchTerm
    )

    // 无精确匹配时，只按名称尝试部分匹配
    if (!model) {
      model = models.find(m => m.name.toLowerCase().includes(searchTerm))
    }

    if (!model) {
      const available = models.map(m => `"${m.name}"`).join(", ")
      log(`💓 Model '${configuredModel}' not found. Available: ${available}`)
      return null
    }

    return model
  } catch (error) {
    log(`💓 Error getting language model: ${error}`)
    return null
  }
}

/**
 * 只获取 ABAP FS 工具（按标签过滤）
 */
function getAbapFsTools(): vscode.LanguageModelToolInformation[] {
  try {
    const allTools = Array.from(vscode.lm.tools)
    const abapTools = allTools.filter(tool => tool.tags.includes(ABAP_FS_TAG))
    return abapTools
  } catch (error) {
    log(`💓 Error getting LM tools: ${error}`)
    return []
  }
}

/**
 * 使用语言模型 API 运行单次心跳
 */
export async function runHeartbeatLM(
  config: HeartbeatConfig,
  cancellationToken?: vscode.CancellationToken
): Promise<HeartbeatLMResult> {
  const startTime = Date.now()
  const toolsUsed: string[] = []

  try {
    // 获取语言模型
    const model = await getLanguageModel(config.model)
    if (!model) {
      const errorMsg = config.model
        ? `Model '${config.model}' not found. Check abapfs.heartbeat.model setting.`
        : "No model configured. Set abapfs.heartbeat.model in settings."
      return {
        status: "error",
        response: "",
        toolsUsed: [],
        durationMs: Date.now() - startTime,
        error: errorMsg
      }
    }

    // 构建提示
    const prompt = buildHeartbeatPrompt(config)

    // 只获取 ABAP FS 工具（按标签过滤）
    const tools = getAbapFsTools()

    // 创建消息
    const messages = [vscode.LanguageModelChatMessage.User(prompt)]

    // 准备带工具请求选项
    const requestOptions: vscode.LanguageModelChatRequestOptions = {
      tools: tools.length > 0 ? tools : undefined
    }

    // 发送请求并收集响应
    let fullResponse = ""
    const token = cancellationToken || new vscode.CancellationTokenSource().token

    // 在循环中处理工具调用
    let currentMessages = [...messages]
    let maxIterations = 10 // 防止无限循环

    while (maxIterations > 0) {
      maxIterations--

      const response = await model.sendRequest(currentMessages, requestOptions, token)

      let hasToolCalls = false
      let textParts: string[] = []

      // 处理响应流
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value)
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          hasToolCalls = true
          const toolName = part.name
          toolsUsed.push(toolName)

          try {
            // 执行工具
            const toolResult = await vscode.lm.invokeTool(
              toolName,
              {
                input: part.input,
                toolInvocationToken: undefined
              },
              token
            )

            // 添加带工具调用的助手消息
            currentMessages.push(vscode.LanguageModelChatMessage.Assistant([part]))

            // 从工具结果提取文本
            let resultText = ""
            if (toolResult && typeof toolResult === "object" && "content" in toolResult) {
              const content = (toolResult as { content: unknown }).content
              if (Array.isArray(content)) {
                resultText = content
                  .filter(
                    (p: unknown) =>
                      p &&
                      typeof p === "object" &&
                      "value" in (p as Record<string, unknown>) &&
                      typeof (p as Record<string, unknown>).value === "string"
                  )
                  .map((p: unknown) => (p as { value: string }).value)
                  .join("\n")
              }
            } else if (typeof toolResult === "string") {
              resultText = toolResult
            } else {
              resultText = JSON.stringify(toolResult)
            }

            currentMessages.push(
              vscode.LanguageModelChatMessage.User([
                new vscode.LanguageModelToolResultPart(part.callId, [
                  new vscode.LanguageModelTextPart(resultText)
                ])
              ])
            )
          } catch (toolError) {
            log(`💓 Tool error (${toolName}): ${toolError}`)

            // 添加错误结果
            currentMessages.push(vscode.LanguageModelChatMessage.Assistant([part]))
            currentMessages.push(
              vscode.LanguageModelChatMessage.User([
                new vscode.LanguageModelToolResultPart(part.callId, [
                  new vscode.LanguageModelTextPart(`Error: ${toolError}`)
                ])
              ])
            )
          }
        }
      }

      // 收集文本响应
      if (textParts.length > 0) {
        fullResponse += textParts.join("")
      }

      // 如果没有工具调用，完成
      if (!hasToolCalls) {
        break
      }
    }

    const durationMs = Date.now() - startTime

    // 解析响应
    const parsed = parseHeartbeatResponse(fullResponse, config.ackMaxChars)

    if (parsed.isAck) {
      return {
        status: "ok",
        response: parsed.cleanedResponse || HEARTBEAT_OK_TOKEN,
        toolsUsed: [...new Set(toolsUsed)],
        durationMs
      }
    } else {
      return {
        status: "alert",
        response: parsed.cleanedResponse || fullResponse,
        toolsUsed: [...new Set(toolsUsed)],
        durationMs
      }
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    log(`💓 Heartbeat error: ${errorMessage}`)

    return {
      status: "error",
      response: "",
      toolsUsed: [...new Set(toolsUsed)],
      durationMs,
      error: errorMessage
    }
  }
}
