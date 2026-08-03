/**
 * ABAP 搜索对象工具 - VSCode AI 集成
 *
 * 使用 ABAP 对象搜索器提供对象搜索能力
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { funWindow as window } from "../funMessenger"
import { getSearchService } from "../abapSearchService"
import { abapUri } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"

// 工具参数接口
export interface ISearchABAPObjectsParameters {
  pattern: string
  connectionId?: string
  types?: Array<
    | "FUNC"
    | "CLAS"
    | "TABL"
    | "PROG"
    | "INTF"
    | "DTEL"
    | "DDLS"
    | "DOMA"
    | "TTYP"
    | "ENQU"
    | "MSAG"
    | "FUGR"
    | "DEVC"
    | "TRAN"
    | "VIEW"
    | "SICF"
    | "WDYN"
    | "SPRX"
    | "XSLT"
    | "TRANSFORMATIONS"
    | "SUSH"
    | "SUSC"
    | "PINF"
    | "ENHC"
    | "ENHS"
    | "BADI"
    | "BADII"
    | "SAMC"
    | "SAPC"
    | "SFSW"
    | "SFBF"
    | "SFBS"
    | "JOBD"
    | "NROB"
    | "BDEF"
    | "SRVB"
    | "SUSO"
  >
  maxResults?: number
}

/**
 * 🔍 搜索 ABAP 对象工具
 */
export class SearchABAPObjectsTool implements vscode.LanguageModelTool<ISearchABAPObjectsParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchABAPObjectsParameters>,
    _token: vscode.CancellationToken
  ) {
    const { pattern, types, maxResults, connectionId } = options.input

    const confirmationMessages = {
      title: "Search ABAP Objects",
      message: new vscode.MarkdownString(
        `Search SAP system for ABAP objects matching pattern: \`${pattern}\`` +
          (connectionId ? ` (connection: ${connectionId})` : "") +
          (types ? ` (types: ${types.join(", ")})` : " (all types)") +
          (maxResults ? ` (max ${maxResults} results)` : "")
      )
    }

    return {
      invocationMessage: `Searching ABAP objects: ${pattern}`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ISearchABAPObjectsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    let { pattern, types, maxResults = 20, connectionId } = options.input
    logTelemetry("tool_search_abap_objects_called", { connectionId })

    // 确保 connectionId 为小写以保持一致
    if (connectionId) {
      connectionId = connectionId.toLowerCase()
    }

    try {
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

      const searcher = getSearchService(actualConnectionId)

      // 搜索对象
      const objects = await searcher.searchObjects(pattern, types, maxResults)

      if (!objects || objects.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`No ABAP objects found matching pattern: ${pattern}`)
        ])
      }

      // 用 URI 路径为 LLM 格式化结果
      const results = objects.map(obj => ({
        name: obj.name,
        type: obj.type,
        description: obj.description || "",
        package: obj.package || "",
        uri: obj.uri || ""
      }))

      const resultText =
        `Found ${results.length} ABAP objects matching "${pattern}":\n\n` +
        results
          .map(
            obj =>
              `• ${obj.name} (${obj.type})\n` +
              `  ${obj.description}\n` +
              `  Package: ${obj.package}\n` +
              `  URI: ${obj.uri}\n` +
              `  ADT: adt://${actualConnectionId}${obj.uri}`
          )
          .join("\n\n")

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
    } catch (error) {
      throw new Error(`Failed to search ABAP objects: ${String(error)}`)
    }
  }
}

/**
 * 注册搜索对象工具
 */
export function registerSearchObjectsTool(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    registerToolWithRegistry("search_abap_objects", new SearchABAPObjectsTool())
  )
}
