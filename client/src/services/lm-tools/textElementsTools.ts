import * as vscode from "vscode"
import { funWindow as window } from "../funMessenger"
import { logCommands } from "../abapCopilotLogger"
import { session_types } from "abap-adt-api"
import { logTelemetry } from "../telemetry"
import { getClient, abapUri } from "../../adt/conections"
import { getTextElementsSafe, updateTextElementsWithTransport } from "../../adt/textElements"
import { openTextElementsInSapGui } from "../../commands/textElementsCommands"
import { assertToolInvocationAuthorized } from "./toolGuard"

// 文本元素工具接口
export interface IManageTextElementsParameters {
  objectName: string // ABAP 对象名
  objectType: "PROGRAM" | "CLASS" | "FUNCTION_GROUP" // 对象类型（语言模型工具必填 - Copilot 提供）
  action: "read" | "create" | "update"
  textElements?: Array<{
    id: string
    text: string
    maxLength?: number
  }>
  connectionId?: string
}

/**
 * 管理文本元素工具 - 读取/创建/更新文本元素的统一工具
 */
export class ManageTextElementsTool implements vscode.LanguageModelTool<IManageTextElementsParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IManageTextElementsParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, objectType, action, textElements, connectionId } = options.input

    let message = `**Action:** ${action.toUpperCase()}\n**Object:** ${objectName}`
    if (objectType) {
      message += `\n**Type:** ${objectType}`
    }
    message += `\n**Connection:** ${connectionId || "auto-detect"}`

    if (action === "create" || action === "update") {
      message += `\n**Text Elements:** ${textElements?.length || 0}`
      message +=
        "\n\n **Best Practice:** Always read existing text elements first to avoid duplicates and to know which text IDs are already in use."
      if (action === "update") {
        message += "\n\n **This will modify existing text elements in the SAP system.**"
      }
    }

    const confirmationMessages = {
      title: `${action === "read" ? "Read" : action === "create" ? "Create" : "Update"} Text Elements`,
      message: new vscode.MarkdownString(message)
    }

    return {
      invocationMessage: `${action === "read" ? "Reading" : action === "create" ? "Creating" : "Updating"} text elements for ${objectType ? objectType + " " : ""}${objectName}...`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IManageTextElementsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    let { objectName, objectType, action, textElements, connectionId } = options.input
    logTelemetry("tool_manage_text_elements_called", { connectionId })

    // 🚫 只强制读取操作 - 创建/更新因锁句柄问题被禁用
    // if (action === 'create' || action === 'update') {
    //  // logCommands.info(`⚠️ Text Elements Tool: ${action} action disabled, forcing READ action instead`);
    //   action = 'read'; // Force to read action
    // }

    // 确保 connectionId 为小写以保持一致
    if (connectionId) {
      connectionId = connectionId.toLowerCase()
    }
    // logCommands.info(`📖 Manage Text Elements Tool: ${action} for ${objectName}`);

    try {
      // 连接和文本元素 API 已在模块顶部静态导入

      // 解析 connectionId - 与其他语言模型工具相同模式
      let actualConnectionId = connectionId

      // 未提供 connectionId 时，尝试从活动编辑器获取
      if (!actualConnectionId) {
        const activeEditor = window.activeTextEditor
        if (!activeEditor || !abapUri(activeEditor.document.uri)) {
          throw new Error(
            "No active ABAP document and no connectionId provided. Please open an ABAP file or provide connectionId parameter."
          )
        }
        actualConnectionId = activeEditor.document.uri.authority
      }

      const stateless_clone = action === "read" ? true : false
      // 获取连接 - 读取用无状态克隆，创建/更新用有状态客户端
      const client = getClient(actualConnectionId, stateless_clone)
      if (!client) {
        throw new Error("No ADT connection available. Please connect to an SAP system first.")
      }

      if (action === "read") {
        return await this.handleRead(client, objectName, objectType, actualConnectionId)
      } else if (action === "create" || action === "update") {
        if (!textElements || textElements.length === 0) {
          throw new Error("Text elements array is required for create/update operations")
        }

        // 对 CREATE 和 UPDATE，与现有文本元素合并以避免数据丢失
        let finalTextElements = textElements
        try {
          const existingResult = await getTextElementsSafe(client, objectName, objectType)
          const existingElements = existingResult.textElements

          if (existingElements.length > 0) {
            // 按 ID 创建新/更新元素的映射
            const updatesMap = new Map(textElements.map(el => [el.id, el]))

            // 从现有元素开始，然后应用更新
            const mergedElements = existingElements.map(
              existing => updatesMap.get(existing.id) || existing
            )

            // 添加现有元素中完全没有的新元素
            const existingIds = new Set(existingElements.map(el => el.id))
            const newElements = textElements.filter(el => !existingIds.has(el.id))

            finalTextElements = [...mergedElements, ...newElements]
          }
        } catch (error) {
          // 如果无法读取现有元素，只使用提供的元素继续
          logCommands.warn(` Could not read existing text elements for merge: ${error}`)
        }

        client.stateful = session_types.stateful
        return await this.handleCreateUpdate(
          client,
          objectName,
          objectType,
          finalTextElements,
          action
        )
      } else {
        throw new Error(`Invalid action: ${action}. Must be 'read', 'create', or 'update'`)
      }
    } catch (error) {
      logCommands.error(` Manage Text Elements Tool error: ${error}`)
      throw new Error(`Failed to ${action} text elements: ${String(error)}`)
    }
  }

  private async handleRead(
    client: any,
    objectName: string,
    objectType?: string,
    connectionId?: string
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      // 提供时使用显式对象类型，未提供时回退到检测
      const result = await getTextElementsSafe(client, objectName, objectType)

      let resultText = `Text Elements for ${result.programName}\n`
      resultText += `Object: ${result.programName} | Total: ${result.textElements.length}\n\n`

      if (result.textElements.length > 0) {
        resultText += `Elements:\n`
        result.textElements.forEach(element => {
          const maxLengthInfo = element.maxLength ? ` (max: ${element.maxLength})` : ""
          resultText += `• ${element.id}: "${element.text}"${maxLengthInfo}\n`
        })
      } else {
        resultText += `No text elements found — this program has none defined.`
      }

      // logCommands.info(`✅ Read Text Elements: Found ${result.textElements.length} text elements`);

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
    } catch (error) {
      // 检查是否为 "Resource does not exist" 错误 - 旧系统回退到 SAP GUI
      const errorMessage = String(error)
      if (errorMessage.includes("Resource") && errorMessage.includes("does not exist")) {
        if (!connectionId) {
          throw new Error("Cannot determine connection ID for SAP GUI fallback")
        }

        // 用正确的对象类型调用现有的 SAP GUI 回退函数
        await openTextElementsInSapGui(
          objectName +
            (objectType === "CLASS"
              ? ".clas.abap"
              : objectType === "FUNCTION_GROUP"
                ? ".fugr.abap"
                : ".prog.abap"),
          connectionId
        )

        const resultText =
          `Text Elements Editor Opened in SAP GUI\n` +
          `Object: ${objectName}\n` +
          `System: ${connectionId.toUpperCase()}\n` +
          `Reason: ADT text elements API not available on this system\n\n` +
          `Editor opened in embedded SAP GUI webview. User can edit text elements directly there.`

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
      } else {
        // 重新抛出其他错误
        throw error
      }
    }
  }

  private async handleCreateUpdate(
    client: any,
    objectName: string,
    objectType: string | undefined,
    textElements: Array<{ id: string; text: string; maxLength?: number }>,
    action: "create" | "update"
  ): Promise<vscode.LanguageModelToolResult> {
    // 感知传输的函数已在模块顶部静态导入
    await updateTextElementsWithTransport(client, objectName, textElements, objectType)

    let resultText = `Text Elements ${action === "create" ? "Created" : "Updated"} for ${objectName}\n`
    resultText += `Object: ${objectName} | ${action === "create" ? "Created" : "Updated"}: ${textElements.length}\n\n`

    resultText += `${action === "create" ? "Created" : "Updated"} elements:\n`
    textElements.forEach(element => {
      const maxLengthInfo = element.maxLength ? ` (max: ${element.maxLength})` : ""
      resultText += `• ${element.id}: "${element.text}"${maxLengthInfo}\n`
    })

    resultText += `\nSuccess. Next: update ABAP code to use these elements:`
    textElements.forEach(element => {
      resultText += `\n• Replace hardcoded text with: TEXT-${element.id}`
    })

    logCommands.info(
      ` ${action} Text Elements: Successfully processed ${textElements.length} text elements`
    )

    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
  }
}
