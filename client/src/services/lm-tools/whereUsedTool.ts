/**
 * ABAP Where-Used 分析工具
 * 查找所有引用和使用位置
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { getSearchService } from "../abapSearchService"
import { getOptimalObjectURI } from "./shared"
import { logTelemetry } from "../telemetry"
import { getClient } from "../../adt/conections"
import { assertToolInvocationAuthorized } from "./toolGuard"

// ============================================================================
// 接口
// ============================================================================

export interface IWhereUsedParameters {
  objectName: string // 必填 - 需要搜索的对象
  connectionId: string // 必填 - 需要 SAP 系统连接
  objectType?: string // 可选：指定精确类型以避免歧义
  searchTerm?: string // 可选：要搜索的特定符号/方法/变量
  line?: number // 可选：上下文敏感搜索的特定行号
  character?: number // 可选：精确符号搜索的字符位置
  maxResults?: number // 返回的最大引用数（默认：50）
  includeSnippets?: boolean // 包含显示使用上下文的代码片段（警告：大结果集可能很慢）

  // 分页支持 - 用于大结果集
  startIndex?: number // 从此结果索引开始（从 0 开始）。用于跳过较早的结果并访问较晚的（例如 startIndex: 5000 获取从 5000 开始的结果）

  // 过滤支持 - 缩小结果范围
  filter?: {
    objectNamePattern?: string // Filter by object name pattern (supports wildcards: "Z*", "*CUSTOM*", "ZXX_*")
    objectTypes?: string[] // Filter by specific object types (e.g., ["PROG/P", "CLAS/OC", "FUGR/FF"])
    excludeSystemObjects?: boolean // 排除 SAP 标准对象（不以 Z 或 Y 开头的对象）
  }
}

// ============================================================================
// 工具类
// ============================================================================

/**
 * 🔍 ABAP WHERE-USED 分析工具 - 查找所有引用和使用位置
 */
export class ABAPWhereUsedTool implements vscode.LanguageModelTool<IWhereUsedParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IWhereUsedParameters>,
    _token: vscode.CancellationToken
  ) {
    const {
      objectName,
      objectType,
      searchTerm,
      line,
      character,
      connectionId,
      maxResults = 50,
      startIndex,
      filter
    } = options.input

    let target = objectName
    if (objectType) target += ` (${objectType})`
    if (searchTerm) target += ` - ${searchTerm}`
    if (line !== undefined) target += ` at line ${line}`

    let filterInfo = ""
    if (filter) {
      const filters: string[] = []
      if (filter.objectNamePattern) filters.push(`object: ${filter.objectNamePattern}`)
      if (filter.objectTypes?.length) filters.push(`types: ${filter.objectTypes.join(", ")}`)
      if (filter.excludeSystemObjects) filters.push("exclude SAP standard")
      if (filters.length > 0) {
        filterInfo = `\n\nFilters: ${filters.join("; ")}`
      }
    }

    const rangeInfo = startIndex !== undefined ? `\n\nStarting from result #${startIndex}` : ""

    const confirmationMessages = {
      title: "Find Where Used (References)",
      message: new vscode.MarkdownString(
        `Find all references for: ${target}` +
          (connectionId ? ` (connection: ${connectionId})` : "") +
          `\n\nMax results: ${maxResults}` +
          rangeInfo +
          filterInfo
      )
    }

    return {
      invocationMessage: `Finding where-used for: ${target}`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IWhereUsedParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    let {
      objectName,
      connectionId,
      objectType,
      searchTerm,
      line,
      character,
      maxResults = 50,
      includeSnippets = false,
      startIndex = 0,
      filter
    } = options.input
    logTelemetry("tool_find_where_used_called", { connectionId })

    try {
      // connectionId 现在是必填的
      const actualConnectionId = connectionId.toLowerCase()

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

      // 获取用于 where-used 分析的客户端和对象源码
      const client = getClient(actualConnectionId)

      // 获取对象源码以确定主 URL 并执行 where-used 搜索
      let mainUrl = objectInfo.uri
      let objectSource = ""

      try {
        // 尝试获取源码 - 使用与其他工具相同的 URI 优化
        const optimalUri = getOptimalObjectURI(objectInfo.type, objectInfo.uri)
        objectSource = await client.getObjectSource(optimalUri)
        mainUrl = optimalUri
      } catch (sourceError) {
        // 回退到原始 URI
        try {
          objectSource = await client.getObjectSource(objectInfo.uri)
          mainUrl = objectInfo.uri
        } catch (fallbackError) {
          // 如果提供了 searchTerm，我们需要源码来找到它 - 失败
          if (searchTerm) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `Could not access source for object: ${objectName}. Error: ${fallbackError}`
              )
            ])
          }
          // 否则，在没有源码的情况下继续 - 将默认使用第 1 行、第 0 列
          // mainUrl 保持为之前设置的 objectInfo.uri
          objectSource = ""
        }
      }

      // 确定搜索位置 - 对 where-used，我们需要有意义的位置
      let searchLine = line
      let searchCharacter = character

      // 如果提供了 searchTerm，在源码中找到它
      if (searchTerm && objectSource) {
        const lines = objectSource.split("\n")
        let found = false

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i]
          const termIndex = lineText.toUpperCase().indexOf(searchTerm.toUpperCase())
          if (termIndex >= 0) {
            searchLine = i + 1 // ADT API 从 1 开始
            searchCharacter = termIndex
            found = true
            break
          }
        }

        if (!found) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Search term "${searchTerm}" not found in object ${objectName}.`
            )
          ])
        }
      } else if (!searchLine) {
        // 如果未提供特定位置，搜索对象声明/定义
        if (objectSource) {
          const lines = objectSource.split("\n")

          // 查找常见的 ABAP 声明模式
          const declarationPatterns = [
            new RegExp(`\\b(class|interface|program|function|method)\\s+${objectName}\\b`, "i"),
            new RegExp(`\\b${objectName}\\b.*\\s+(class|interface|type|data)`, "i"),
            new RegExp(`^\\s*${objectName}\\b`, "i") // 行首的简单名称匹配
          ]

          for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i]
            for (const pattern of declarationPatterns) {
              if (pattern.test(lineText)) {
                searchLine = i + 1
                searchCharacter =
                  lineText.indexOf(objectName.toLowerCase()) >= 0
                    ? lineText.toLowerCase().indexOf(objectName.toLowerCase())
                    : 0
                break
              }
            }
            if (searchLine) break
          }
        }

        // 未找到声明时回退到第一行
        if (!searchLine) {
          searchLine = 1
          searchCharacter = 0
        }
      }

      // 使用 ADT API 执行 where-used 搜索
      let references: any[] = []
      try {
        references = await client.statelessClone.usageReferences(
          mainUrl,
          searchLine,
          searchCharacter
        )
      } catch (referencesError) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Where-used search failed for ${objectName}: ${referencesError}`
          )
        ])
      }

      // 提取搜索位置的实际关键字/符号用于显示
      let actualKeyword = ""
      if (objectSource && searchLine && searchCharacter !== undefined) {
        const lines = objectSource.split("\n")
        if (searchLine > 0 && searchLine <= lines.length) {
          const lineText = lines[searchLine - 1] // 转换为从 0 开始
          // 提取字符位置的单词（简单单词提取）
          let start = searchCharacter
          let end = searchCharacter

          // 查找单词边界
          while (start > 0 && /[a-zA-Z0-9_]/.test(lineText[start - 1])) {
            start--
          }
          while (end < lineText.length && /[a-zA-Z0-9_]/.test(lineText[end])) {
            end++
          }

          actualKeyword = lineText.substring(start, end)
        }
      }

      if (!references || references.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No references found for ${objectName}${searchTerm ? ` (${searchTerm})` : ""}.`
          )
        ])
      }

      // 过滤和分组引用
      const goodRefs = references.filter((ref: any) => {
        const rparts = ref.objectIdentifier?.split(";")
        return rparts && rparts[1] && rparts[0] === "ABAPFullName"
      })

      if (goodRefs.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No valid references found for ${objectName}${searchTerm ? ` (${searchTerm})` : ""}.`
          )
        ])
      }

      const totalRawReferences = goodRefs.length

      // 提供了过滤器则应用
      let filteredRefs = goodRefs
      const filterStats = {
        byObjectName: 0,
        byObjectType: 0,
        bySystemExclusion: 0
      }

      if (filter) {
        // 按对象名称模式过滤
        if (filter.objectNamePattern) {
          const pattern = this.wildcardToRegex(filter.objectNamePattern)
          const beforeCount = filteredRefs.length
          filteredRefs = filteredRefs.filter((ref: any) => {
            const rparts = ref.objectIdentifier?.split(";")
            const objName = rparts[1] || ""
            return pattern.test(objName)
          })
          filterStats.byObjectName = beforeCount - filteredRefs.length
        }

        // 按对象类型过滤
        if (filter.objectTypes && filter.objectTypes.length > 0) {
          const beforeCount = filteredRefs.length
          filteredRefs = filteredRefs.filter((ref: any) => {
            const objType = ref["adtcore:type"] || ""
            return filter?.objectTypes?.includes(objType)
          })
          filterStats.byObjectType = beforeCount - filteredRefs.length
        }

        // 排除 SAP 标准对象（不以 Z 或 Y 开头）
        if (filter.excludeSystemObjects) {
          const beforeCount = filteredRefs.length
          filteredRefs = filteredRefs.filter((ref: any) => {
            const rparts = ref.objectIdentifier?.split(";")
            const objName = rparts[1] || ""
            return /^[ZY]/i.test(objName)
          })
          filterStats.bySystemExclusion = beforeCount - filteredRefs.length
        }
      }

      if (filteredRefs.length === 0) {
        let filterMsg = `No references found after applying filters for ${objectName}.`
        if (filter) {
          filterMsg += `\n\nFilters applied:`
          if (filter.objectNamePattern)
            filterMsg += `\n• Object name pattern: ${filter.objectNamePattern}`
          if (filter.objectTypes?.length)
            filterMsg += `\n• Object types: ${filter.objectTypes.join(", ")}`
          if (filter.excludeSystemObjects) filterMsg += `\n• Exclude SAP standard objects`
          filterMsg += `\n\nTotal references before filtering: ${totalRawReferences}`
        }
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(filterMsg)])
      }

      // 应用分页（startIndex）
      const paginatedRefs = filteredRefs.slice(startIndex, startIndex + maxResults)

      if (paginatedRefs.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No references found at index range ${startIndex}-${startIndex + maxResults}. ` +
              `Total filtered references available: ${filteredRefs.length}. ` +
              `Try a lower startIndex.`
          )
        ])
      }

      let resultText = `ABAP Where-Used Analysis\n`
      resultText += `Object: ${objectName}${objectType ? ` (${objectType})` : ""}\n`

      // 显示在位置找到的实际关键字（提供了行/列或使用了 searchTerm 时）
      if (actualKeyword) {
        resultText += `Analyzing symbol at position: \`${actualKeyword}\` (Line ${searchLine}, Character ${searchCharacter})\n`
      } else {
        if (searchTerm) resultText += `Search Term: ${searchTerm}\n`
        resultText += `Position: Line ${searchLine}, Character ${searchCharacter}\n`
      }

      resultText += `System: ${actualConnectionId}\n\n`

      // 显示过滤和分页信息
      if (filter || startIndex > 0) {
        resultText += `Result Set Info:\n`
        resultText += `• Total references found: ${totalRawReferences}\n`

        if (filter) {
          resultText += `• After filtering: ${filteredRefs.length}\n`
          if (filter.objectNamePattern)
            resultText += `  - Object name pattern: ${filter.objectNamePattern} (filtered ${filterStats.byObjectName})\n`
          if (filter.objectTypes?.length)
            resultText += `  - Object types: ${filter.objectTypes.join(", ")} (filtered ${filterStats.byObjectType})\n`
          if (filter.excludeSystemObjects)
            resultText += `  - Exclude SAP standard (filtered ${filterStats.bySystemExclusion})\n`
        }

        if (startIndex > 0 || filteredRefs.length > maxResults) {
          resultText += `• Showing: ${startIndex + 1} to ${Math.min(startIndex + paginatedRefs.length, filteredRefs.length)} (${paginatedRefs.length} results)\n`
          if (startIndex + maxResults < filteredRefs.length) {
            const remaining = filteredRefs.length - (startIndex + maxResults)
            resultText += `• Remaining: ${remaining} (use startIndex=${startIndex + maxResults} for next batch)\n`
          }
        }

        resultText += `\n`
      } else {
        resultText += `Results: ${paginatedRefs.length} of ${filteredRefs.length} references\n`
        if (filteredRefs.length > maxResults) {
          resultText += `(showing first ${maxResults}, use startIndex to see more)\n`
        }
        resultText += `\n`
      }

      // 按对象分组引用
      const groups = new Map<string, any[]>()
      for (const ref of paginatedRefs) {
        const rparts = ref.objectIdentifier.split(";")
        const fullName = rparts[1]
        if (!groups.has(fullName)) {
          groups.set(fullName, [])
        }
        groups.get(fullName)!.push(ref)
      }

      resultText += `References by Object:\n`

      let refIndex = 1
      let hasUnknownTypes = false
      const allObjects = Array.from(groups.entries())

      // 显示所有对象的详情（已按 maxResults/startIndex 分页）
      for (const [fullName, refs] of allObjects) {
        resultText += `${refIndex}. ${fullName} (${refs.length} reference${refs.length > 1 ? "s" : ""})\n`

        for (const ref of refs) {
          const objType = ref["adtcore:type"] || "Unknown"
          if (objType === "Unknown") hasUnknownTypes = true

          resultText += `   • Type: ${objType}\n`
          resultText += `   • Name: ${ref["adtcore:name"] || "Unknown"}\n`
          if (ref["adtcore:packageName"]) {
            resultText += `   • Package: ${ref["adtcore:packageName"]}\n`
          }
          if (ref["adtcore:description"]) {
            resultText += `   • Description: ${ref["adtcore:description"]}\n`
          }
          resultText += `   • URI: ${ref.uri || "N/A"}\n`
          resultText += `\n`
        }

        refIndex++
      }

      // 添加关于未知类型的提示
      if (hasUnknownTypes) {
        resultText += `\nTip: some references show Type="Unknown". Determine actual type from URI path:\n`
        resultText += `   • /oo/classes/ → Class (CLAS/OC)\n`
        resultText += `   • /programs/programs/ → Program (PROG/P)\n`
        resultText += `   • /functions/groups/ → Function Module (FUGR/FF)\n`
        resultText += `   • /oo/interfaces/ → Interface (INTF/OI)\n`
        resultText += `   • Or use the URI with get_object_by_uri to inspect metadata\n\n`
      }

      // 请求时获取使用片段 - Copilot 通过 includeSnippets 参数控制
      if (includeSnippets) {
        try {
          resultText += `\nUsage Snippets:\n`

          const snippets = await client.statelessClone.usageReferenceSnippets(paginatedRefs)

          let snippetIndex = 1
          for (const s of snippets) {
            if (s.snippets && s.snippets.length > 0) {
              resultText += `${snippetIndex}. ${s.objectIdentifier}\n`

              for (const snippet of s.snippets.slice(0, 3)) {
                // 每个对象最多 3 个片段
                if (snippet.uri && snippet.uri.start) {
                  resultText += `   Line ${snippet.uri.start.line}: ${snippet.content || snippet.matches || "No content"}\n`
                }
              }
              resultText += `\n`
              snippetIndex++
            }
          }
        } catch (snippetError) {
          resultText += `\nCould not retrieve usage snippets: ${snippetError}\n`
        }
      }

      // 汇总统计
      const uniqueObjects = groups.size
      const totalReferences = paginatedRefs.length

      resultText += `\nSummary:\n`
      resultText += `• Total References: ${totalReferences}\n`
      resultText += `• Unique Objects: ${uniqueObjects}\n`
      resultText += `• Avg References/Object: ${Math.round(totalReferences / uniqueObjects)}\n`

      if (filteredRefs.length > paginatedRefs.length) {
        resultText += `• Truncated: Showing ${paginatedRefs.length} of ${filteredRefs.length} filtered references\n`
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
    } catch (error) {
      throw new Error(`Failed to find where-used references: ${String(error)}`)
    }
  }

  // 把通配符模式转换为正则的辅助方法
  private wildcardToRegex(pattern: string): RegExp {
    // 转义除 * 和 ? 之外的特殊正则字符
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // 转换通配符：* -> .*、? -> .
    const regex = escaped.replace(/\*/g, ".*").replace(/\?/g, ".")
    return new RegExp(`^${regex}$`, "i")
  }
}

// ============================================================================
// 注册
// ============================================================================

export function registerWhereUsedTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("find_where_used", new ABAPWhereUsedTool()))
}
