/**
 * ABAP 获取对象行工具 - VSCode AI 集成
 *
 * 从 ABAP 对象检索源代码行，带表结构支持
 */

import * as vscode from "vscode"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"
import { funWindow as window } from "../funMessenger"
import { getSearchService } from "../abapSearchService"
import { abapUri, getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import {
  getOptimalObjectURI,
  resolveCorrectURI,
  getObjectEnhancements,
  getTableTypeFromDD,
  getTableStructureFromDD,
  getAppendStructuresFromDD,
  getDataElementFromDD,
  getDomainFromDD
} from "./shared"

// ============================================================================
// 本地完整表结构（使用增强 URI - 与 shared 不同）
// ============================================================================

async function getCompleteTableStructure(
  connectionId: string,
  objectName: string,
  objectUri: string
): Promise<string> {
  try {
    const client = getClient(connectionId)

    const mainTableURI = getOptimalObjectURI("TABL/TA", objectUri)
    let mainStructure = ""

    try {
      mainStructure = await client.getObjectSource(mainTableURI)
    } catch (mainError) {
      try {
        const tableFields = await getTableStructureFromDD(client, objectName)
        if (tableFields) {
          mainStructure = tableFields

          const completeStructure =
            `Complete Structure for ${objectName} (from DD03L — main object + ALL append structures):\n\n` +
            tableFields

          return completeStructure
        }
      } catch (fallbackError) {
        // 忽略
      }
    }

    let allAppendStructures = ""

    try {
      const enhancementURI = `${objectUri}/enhancement/elements`
      const appendMetadata = await client.getObjectSource(enhancementURI)

      if (appendMetadata && appendMetadata.trim().length > 0) {
        const appendStructureNames: string[] = []

        const structureMatches = appendMetadata.match(/adtcore:name="([^"]+)"/g)
        if (structureMatches) {
          for (const match of structureMatches) {
            const nameMatch = match.match(/adtcore:name="([^"]+)"/)
            if (nameMatch && nameMatch[1] !== objectName.toLowerCase()) {
              appendStructureNames.push(nameMatch[1])
            }
          }
        }

        for (const structureName of appendStructureNames) {
          try {
            const searcher = getSearchService(connectionId)
            const structureResults = await searcher.searchObjects(structureName, undefined, 1)

            if (structureResults && structureResults.length > 0 && structureResults[0].uri) {
              const structureUri = structureResults[0].uri
              const optimalStructureUri = getOptimalObjectURI(
                structureResults[0].type,
                structureUri
              )
              const structureContent = await client.getObjectSource(optimalStructureUri)

              if (structureContent && structureContent.trim().length > 0) {
                allAppendStructures += `\n\n--- Append Structure: ${structureName.toUpperCase()} ---\n`
                allAppendStructures += structureContent
              }
            }
          } catch (error) {
            // 忽略追加结构错误
          }
        }
      }
    } catch (appendError) {
      // 忽略增强错误
    }

    let completeStructure = `Complete Table Structure for ${objectName} (SE11-like, includes ALL append structures):\n\n`

    if (mainStructure) {
      completeStructure += `MAIN TABLE STRUCTURE:\n`
      completeStructure += mainStructure
      completeStructure += `\n\n`
    }

    if (allAppendStructures) {
      completeStructure += `APPEND STRUCTURES:\n`
      completeStructure += allAppendStructures
      completeStructure += `\n\n`
    }

    return completeStructure
  } catch (error) {
    return `Could not retrieve complete table structure for ${objectName}: ${error}`
  }
}

// 工具参数接口
export interface IGetABAPObjectLinesParameters {
  objectName: string
  objectType?: string
  startLine?: number
  lineCount?: number
  connectionId?: string
  methodName?: string // 对类：只提取此特定方法
}

/**
 * 📋 获取 ABAP 对象行工具
 */
export class GetABAPObjectLinesTool implements vscode.LanguageModelTool<IGetABAPObjectLinesParameters> {
  /**
   * 从类源代码提取特定方法
   * 处理：METHOD xxx. 到 ENDMETHOD.，包括多行注释
   */
  private extractMethod(
    lines: string[],
    methodName: string
  ): { found: boolean; code: string; startLine: number; endLine: number } {
    const methodNameUpper = methodName.toUpperCase().trim()
    let inMethod = false
    let inBlockComment = false
    let methodStartLine = -1
    let methodLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineUpper = line.toUpperCase()
      const lineTrimmed = lineUpper.trim()

      // 跟踪块注释 /* ... */
      if (lineTrimmed.includes("/*")) {
        inBlockComment = true
      }
      if (lineTrimmed.includes("*/")) {
        inBlockComment = false
        continue
      }

      // 在块注释中则跳过
      if (inBlockComment) {
        if (inMethod) methodLines.push(line)
        continue
      }

      // 检查 METHOD/ENDMETHOD 时跳过单行注释
      const isCommented = lineTrimmed.startsWith("*") || lineTrimmed.startsWith('"')

      if (!inMethod) {
        // 查找 METHOD methodName.（非注释）
        if (!isCommented) {
          // 匹配：METHOD method_name. 或 METHOD interface~method_name.
          const methodPattern = new RegExp(`^\\s*METHOD\\s+(\\w+~)?${methodNameUpper}\\s*\\.`, "i")
          if (methodPattern.test(line)) {
            inMethod = true
            methodStartLine = i + 1 // 从 1 开始
            methodLines.push(line)
          }
        }
      } else {
        // 我们在方法内部，收集行
        methodLines.push(line)

        // 查找 ENDMETHOD.（非注释）
        if (!isCommented && /^\s*ENDMETHOD\s*\./.test(lineUpper)) {
          // 找到结尾
          return {
            found: true,
            code: methodLines.join("\n"),
            startLine: methodStartLine,
            endLine: i + 1 // 从 1 开始
          }
        }
      }
    }

    // 未找到方法或 ENDMETHOD
    return { found: false, code: "", startLine: -1, endLine: -1 }
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetABAPObjectLinesParameters>,
    _token: vscode.CancellationToken
  ) {
    const {
      objectName,
      objectType,
      startLine = 0,
      lineCount = 50,
      connectionId,
      methodName
    } = options.input

    const confirmationMessages = {
      title: "Get ABAP Object Lines",
      message: new vscode.MarkdownString(
        methodName
          ? `Extract method \`${methodName}\` from class: \`${objectName}\``
          : `Retrieve lines ${startLine}-${startLine + lineCount} from ABAP object: \`${objectName}\`` +
              (objectType ? `\nType: ${objectType}` : "") +
              (connectionId ? ` (connection: ${connectionId})` : "")
      )
    }

    return {
      invocationMessage: methodName
        ? `Extracting method ${methodName} from ${objectName}`
        : `Getting lines from: ${objectName}`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetABAPObjectLinesParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    let {
      objectName,
      objectType,
      startLine = 1,
      lineCount = 50,
      connectionId,
      methodName
    } = options.input
    logTelemetry("tool_get_abap_object_lines_called", { connectionId })

    // 确保 connectionId 为小写以保持一致
    if (connectionId) {
      connectionId = connectionId.toLowerCase()
    }

    // 把从 1 开始的行号（用户输入）转换为从 0 开始（数组索引）
    const arrayStartIndex = Math.max(0, startLine - 1)

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

      // 首先搜索对象以获取其 URI
      const searcher = getSearchService(actualConnectionId)
      const searchTypes = objectType ? [objectType] : undefined
      const searchResults = await searcher.searchObjects(objectName, searchTypes, 1)

      if (!searchResults || searchResults.length === 0) {
        const typeInfo = objectType ? ` of type ${objectType}` : ""
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Could not find ABAP object: ${objectName}${typeInfo}. The object may not exist or may not be accessible.`
          )
        ])
      }

      const objectInfo = searchResults[0]
      if (!objectInfo.uri) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(`Could not get URI for ABAP object: ${objectName}.`)
        ])
      }

      // 表/结构/表类型感知处理
      if (
        objectInfo.type === "TABL/TA" ||
        objectInfo.type === "TABL" ||
        objectInfo.type === "TABL/DT" ||
        objectInfo.type === "TABL/DS" ||
        objectInfo.type === "TTYP/DA" ||
        objectInfo.type === "TTYP"
      ) {
        try {
          const client = getClient(actualConnectionId)

          let completeStructure = ""

          if (objectInfo.type === "TTYP/DA" || objectInfo.type === "TTYP") {
            const tableTypeInfo = await getTableTypeFromDD(client, objectName)
            if (tableTypeInfo) {
              completeStructure =
                `Complete Structure for ${objectName} (Table Type from DD40L/DD40T):\n\n` +
                tableTypeInfo
            }
          } else {
            completeStructure = await getCompleteTableStructure(
              actualConnectionId,
              objectName,
              objectInfo.uri
            )
          }

          if (startLine !== undefined && lineCount !== undefined) {
            const lines = completeStructure.split("\n")
            const totalLines = lines.length
            const endLine = Math.min(startLine + lineCount, totalLines)
            const requestedLines = lines.slice(startLine, endLine)
            const content = requestedLines.join("\n")

            const resultText =
              `Complete Table Structure for ${objectName} (lines ${startLine}-${endLine} of ${totalLines}, ${endLine - startLine} retrieved):\n\n` +
              content +
              (endLine < totalLines ? `\n\n(more lines available, request next range)` : "")

            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(resultText)
            ])
          } else {
            const resultText = completeStructure

            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(resultText)
            ])
          }
        } catch (tableError) {
          // 继续使用下面的标准方法
        }
      }

      // 对非表对象的标准处理
      const client = getClient(actualConnectionId)

      let sourceContent = ""
      let uriUsed = ""

      const optimalUri = getOptimalObjectURI(objectInfo.type, objectInfo.uri)

      try {
        sourceContent = await client.getObjectSource(optimalUri)
        uriUsed = optimalUri
      } catch (optimizedError) {
        if (optimalUri !== objectInfo.uri) {
          try {
            sourceContent = await client.getObjectSource(objectInfo.uri)
            uriUsed = objectInfo.uri
          } catch (originalError) {
            const resolvedUri = await resolveCorrectURI(objectInfo.uri, actualConnectionId)
            const finalUri = getOptimalObjectURI(objectInfo.type, resolvedUri)

            try {
              sourceContent = await client.getObjectSource(finalUri)
              uriUsed = finalUri
            } catch (finalError) {
              throw new Error(
                `Could not get source content after trying multiple approaches. Last error: ${finalError}`
              )
            }
          }
        } else {
          const resolvedUri = await resolveCorrectURI(objectInfo.uri, actualConnectionId)
          const finalUri = getOptimalObjectURI(objectInfo.type, resolvedUri)

          try {
            sourceContent = await client.getObjectSource(finalUri)
            uriUsed = finalUri
          } catch (finalError) {
            try {
              let ddContent = ""
              if (objectInfo.type === "DTEL/DE" || objectInfo.type === "DTEL") {
                ddContent = await getDataElementFromDD(client, objectName)
              } else if (objectInfo.type === "DOMA/DD" || objectInfo.type === "DOMA") {
                ddContent = await getDomainFromDD(client, objectName)
              } else if (objectInfo.type === "TTYP/DA" || objectInfo.type === "TTYP") {
                ddContent = await getTableTypeFromDD(client, objectName)
              } else if (objectInfo.type === "TABL/DS") {
                ddContent = await getTableStructureFromDD(client, objectName)
              }

              if (ddContent) {
                sourceContent = ddContent
                uriUsed = "DD Tables Query"
              } else {
                throw new Error(
                  `Could not get source content. Optimized error: ${optimizedError}. Resolved error: ${finalError}`
                )
              }
            } catch (ddError) {
              throw new Error(
                `Could not get source content. Optimized error: ${optimizedError}. Resolved error: ${finalError}. DD fallback: ${ddError}`
              )
            }
          }
        }
      }

      if (!sourceContent) {
        throw new Error("Source content is empty")
      }

      const lines = sourceContent.split("\n")
      const totalLines = lines.length

      // 对类的方法提取
      if (
        methodName &&
        (objectInfo.type === "CLAS/OC" ||
          objectInfo.type === "CLAS" ||
          objectInfo.type?.startsWith("CLAS"))
      ) {
        const methodResult = this.extractMethod(lines, methodName)
        if (methodResult.found) {
          const methodLineCount = methodResult.endLine - methodResult.startLine + 1
          const resultText =
            `Method ${methodName.toUpperCase()} from class ${objectName} (lines ${methodResult.startLine}-${methodResult.endLine} of ${totalLines}, ${methodLineCount} method lines):\n\n` +
            `\`\`\`abap\n${methodResult.code}\n\`\`\`\n\n` +
            `URI: ${uriUsed}`

          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
        } else {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Method ${methodName} NOT FOUND in class ${objectName}.\n` +
                `Tip: search this class with regex '^\\s*(CLASS-)?METHODS?\\s+\\w+' to list all method names.`
            )
          ])
        }
      }

      const arrayEndIndex = Math.min(arrayStartIndex + lineCount, totalLines)
      const actualLines = arrayEndIndex - arrayStartIndex

      const requestedLines = lines.slice(arrayStartIndex, arrayEndIndex)
      const content = requestedLines.join("\n")

      let enhancementInfo = ""
      try {
        const enhancements = await getObjectEnhancements(uriUsed, actualConnectionId, false)
        if (enhancements.hasEnhancements) {
          enhancementInfo = `\n\nEnhancements found: ${enhancements.totalEnhancements}\n`
          for (const enh of enhancements.enhancements) {
            enhancementInfo += `• ${enh.name} (line ${enh.startLine})\n`
          }
          enhancementInfo += `Use search tool to find enhancement code, or re-call this tool with the enhancement line range.`
        }
      } catch (enhError) {
        // 忽略增强错误
      }

      const displayStartLine = startLine
      const displayEndLine = arrayStartIndex + actualLines

      const resultText =
        `Source from ${objectName} (lines ${displayStartLine}-${displayEndLine} of ${totalLines}, ${actualLines} lines retrieved):\n\n` +
        `\`\`\`abap\n${content.trim()}\n\`\`\`\n\n` +
        `URI: ${uriUsed}` +
        (arrayEndIndex < totalLines ? `\n(more lines available, request next range)` : "") +
        enhancementInfo

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
    } catch (docError) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Could not access content for ABAP object: ${objectName}. Error: ${docError}`
        )
      ])
    }
  }
  catch(error: any) {
    throw new Error(`Failed to get lines from ABAP object: ${String(error)}`)
  }
}

/**
 * 注册获取对象行工具
 */
export function registerGetObjectLinesTool(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    registerToolWithRegistry("get_abap_object_lines", new GetABAPObjectLinesTool())
  )
}
