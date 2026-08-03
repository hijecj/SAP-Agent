import * as vscode from "vscode"
import { funWindow as window } from "./funMessenger"
import { getClient, getOrCreateRoot } from "../adt/conections"
import { caughtToString, log } from "../lib"
import { UsageReference } from "abap-adt-api"
import { WebviewManager } from "./webviewManager"
import { isAbapFile } from "abapfs"
import { getOptimalObjectURI } from "./lm-tools/shared"

export interface GraphNode {
  id: string
  name: string
  type: string
  description?: string
  isRoot?: boolean
  isCustom?: boolean // Z* 或 Y*
  responsible?: string // 谁拥有此对象
  package?: string // 包名
  packageUri?: string // 包 URI
  canExpand?: boolean // 能否获取更多依赖
  uri?: string // 用于打开的 ADT URI
  line?: number // 使用位置的行号
  column?: number // 使用位置的列
  objectIdentifier?: string // 用于按需获取代码片段
  parentClass?: string // 对方法，父类名（用于过滤）
  parentUri?: string // 来自引用的父 URI
  usageInformation?: string // 来自引用的使用信息
}

export interface GraphEdge {
  source: string
  target: string
  usageType?: string // 使用方式：READ、WRITE、CALL 等
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface DependencyGraphFilters {
  showCustomOnly: boolean
  showStandardOnly: boolean
  objectTypes: string[]
  usageTypes: string[] // 按对象使用方式过滤（READ、WRITE、CALL 等）
}

/**
 * 解析 UsageReference 以提取对象信息
 */
function parseUsageReference(ref: UsageReference): {
  name: string
  type: string
  description?: string
  responsible?: string
  package?: string
  packageUri?: string
  usageType?: string
  canExpand?: boolean
  uri?: string
  line?: number
  column?: number
  objectIdentifier?: string
  parentClass?: string
  parentUri?: string
  usageInformation?: string
} | null {
  try {
    const rparts = ref.objectIdentifier?.split(";")
    if (!rparts || rparts.length < 2 || rparts[0] !== "ABAPFullName") {
      return null
    }

    let objectType = ref["adtcore:type"] || ""

    // 处理空类型的特殊情况
    if (!objectType) {
      const name = ref["adtcore:name"]
      // 类部分有描述性名称但没有类型
      if (name === "Public Section" || name === "Protected Section" || name === "Private Section") {
        objectType = "CLAS/SECTION"
      } else if (ref.uri && ref.uri.includes("/oo/classes/")) {
        objectType = "CLAS/OC" // 类相关对象的默认值
      } else {
        objectType = "UNKNOWN"
      }
    }

    // 按类型确定正确的对象名
    // objectIdentifier 格式：ABAPFullName;PROGRAM_NAME;INCLUDE_NAME;...
    let objectName = rparts[1]

    // 提取方法的父类名（用于过滤）
    let parentClass: string | undefined = undefined

    if (objectType === "PROG/I" && rparts.length >= 3 && rparts[2]) {
      // 对 include，使用 rparts[2] 中的 include 名
      objectName = rparts[2]
    } else if ((objectType === "FUGR/FF" || objectType === "CLAS/OM") && ref["adtcore:name"]) {
      // 对函数模块和方法，使用 adtcore:name（实际的 FM/方法名）
      objectName = ref["adtcore:name"]

      // 对方法，从 objectIdentifier 提取父类名
      if (objectType === "CLAS/OM" && rparts[1]) {
        // 格式：ABAPFullName;ZCL_CLASS_NAME======CP;...
        const className = rparts[1].split("=")[0] // 移除 ======CP 后缀
        parentClass = className
      }
    }

    return {
      name: objectName,
      type: objectType,
      description: ref["adtcore:description"] || "",
      responsible: ref["adtcore:responsible"] || "",
      package: ref.packageRef?.["adtcore:name"] || "",
      packageUri: ref.packageRef?.["adtcore:uri"] || "",
      usageType: ref.usageInformation || "",
      canExpand: ref.canHaveChildren,
      uri: ref.uri,
      line: undefined, // 打开时按需获取
      column: undefined,
      objectIdentifier: ref.objectIdentifier,
      parentClass: parentClass,
      parentUri: ref.parentUri,
      usageInformation: ref.usageInformation
    }
  } catch (error) {
    console.error("Error parsing usage reference:", error)
    return null
  }
}

/**
 * 检查对象是否为自定义（以 Z 或 Y 开头）
 * 满足以下条件即为自定义：
 * - 对象名以 Z 或 Y 开头，或者
 * - 包名以 Z 或 Y 开头
 */
function isCustomObject(objectName: string, packageName?: string): boolean {
  const nameIsCustom = /^[ZY]/i.test(objectName)
  const packageIsCustom = packageName ? /^[ZY]/i.test(packageName) : false
  return nameIsCustom || packageIsCustom
}

/**
 * 获取带位置信息的 ABAP 对象的 where-used 数据
 */
export async function fetchWhereUsedData(
  objectUri: string,
  connectionId: string,
  line?: number,
  character?: number
): Promise<UsageReference[]> {
  const client = getClient(connectionId.toLowerCase())

  try {
    const references = await client.statelessClone.usageReferences(
      objectUri,
      line || 1,
      character || 0
    )

    // 不要提前获取代码片段 - 大图会很慢
    // 用户双击节点时按需获取代码片段

    return references || []
  } catch (error) {
    console.error("Error fetching where-used data:", error)
    throw new Error(`Failed to fetch where-used data: ${error}`)
  }
}

/**
 * 从 objectIdentifier 提取实际被搜索的符号
 * 格式：ABAPFullName;PROGRAM;INCLUDE;\PR:PROGRAM\TY:TYPE\ME:METHOD\DA:VAR;...
 * objectIdentifier 可以链式包含多个符号 - 我们想要最后一个（最具体的）
 */
function extractActualSymbol(objectIdentifier: string): { name: string; type: string } | null {
  if (!objectIdentifier) return null

  // 查找所有符号标记：\TY:、\FU:、\ME:、\DA: 等
  const symbolMatches = objectIdentifier.match(/\\([A-Z]+):([^\\;]+)/g)
  if (symbolMatches && symbolMatches.length > 0) {
    // 取链中的最后一个符号（最具体）
    const lastSymbol = symbolMatches[symbolMatches.length - 1]
    const parts = lastSymbol.match(/\\([A-Z]+):(.+)/)

    if (parts) {
      const symbolTypeCode = parts[1]
      const symbolName = parts[2]

      // 映射为可读类型
      const typeMap: Record<string, string> = {
        TY: "TYPE",
        FU: "FUNCTION",
        ME: "METHOD",
        CL: "CLASS",
        TA: "TABLE",
        DA: "DATA",
        VA: "VARIABLE",
        CO: "CONSTANT",
        IN: "INTERFACE",
        ST: "STRUCTURE",
        PR: "PROGRAM"
      }

      // 始终返回符号 - 不在映射中时使用原始类型代码
      return {
        name: symbolName,
        type: typeMap[symbolTypeCode] || symbolTypeCode
      }
    }
  }

  return null
}

/**
 * 从 where-used 引用构建图数据
 * @param skipSymbolExtraction - 为 true 时按原样使用 rootObjectName/Type（用于节点展开）
 */
export function buildGraphData(
  rootObjectName: string,
  rootObjectType: string,
  references: UsageReference[],
  skipSymbolExtraction: boolean = false
): GraphData {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const nodeMap = new Map<string, GraphNode>()

  // 尝试从第一个有效引用提取实际符号（除非正在展开）
  let actualRootName = rootObjectName
  let actualRootType = rootObjectType

  if (!skipSymbolExtraction) {
    for (const ref of references) {
      if (ref.objectIdentifier) {
        const symbol = extractActualSymbol(ref.objectIdentifier)
        if (symbol) {
          actualRootName = symbol.name
          actualRootType = symbol.type
          break // 使用找到的第一个
        }
      }
    }
  }

  // 用实际符号添加根节点
  const rootId = `${actualRootName}::${actualRootType}`
  const rootNode: GraphNode = {
    id: rootId,
    name: actualRootName,
    type: actualRootType,
    isRoot: true,
    isCustom: isCustomObject(actualRootName)
  }
  nodes.push(rootNode)
  nodeMap.set(rootId, rootNode)

  // 处理引用 - 过滤掉无效的
  const validRefs = references.filter(ref => {
    const rparts = ref.objectIdentifier?.split(";")
    return rparts && rparts[1] && rparts[0] === "ABAPFullName"
  })

  // 构建节点和边
  for (const ref of validRefs) {
    const parsed = parseUsageReference(ref)
    if (!parsed) continue

    const nodeId = `${parsed.name}::${parsed.type}`

    // 不存在时添加节点
    if (!nodeMap.has(nodeId)) {
      // 对方法，检查父类是否为自定义，而不是方法名
      // 同时检查包名 - 对象/类名或包以 Z/Y 开头即为自定义
      const isCustomNode = parsed.parentClass
        ? isCustomObject(parsed.parentClass, parsed.package)
        : isCustomObject(parsed.name, parsed.package)

      const node: GraphNode = {
        id: nodeId,
        name: parsed.name,
        type: parsed.type,
        description: parsed.description,
        isRoot: false,
        isCustom: isCustomNode,
        responsible: parsed.responsible,
        package: parsed.package,
        packageUri: parsed.packageUri,
        canExpand: parsed.canExpand,
        uri: parsed.uri,
        line: parsed.line,
        column: parsed.column,
        objectIdentifier: parsed.objectIdentifier,
        parentClass: parsed.parentClass,
        parentUri: parsed.parentUri,
        usageInformation: parsed.usageInformation
      }
      nodes.push(node)
      nodeMap.set(nodeId, node)
    }

    // 添加从依赖者到根节点的边（谁使用根），带使用类型
    // 跳过自引用边
    if (nodeId !== rootId) {
      edges.push({
        source: nodeId,
        target: rootId,
        usageType: parsed.usageType
      })
    }
  }

  return { nodes, edges }
}

/**
 * 把新图数据合并到现有图
 * 用于展开节点时 - 保留现有节点并添加新节点
 */
export function mergeGraphData(existingGraph: GraphData, newGraph: GraphData): GraphData {
  const nodeMap = new Map<string, GraphNode>()
  const edgeMap = new Map<string, GraphEdge>()

  // 添加所有现有节点
  for (const node of existingGraph.nodes) {
    nodeMap.set(node.id, node)
  }

  // 添加新节点（避免重复）
  for (const node of newGraph.nodes) {
    if (!nodeMap.has(node.id)) {
      nodeMap.set(node.id, { ...node, isRoot: false }) // 新节点不是根
    }
  }

  // 添加所有现有边（保留包括 usageType 的完整边对象）
  for (const edge of existingGraph.edges) {
    const key = `${edge.source}::${edge.target}`
    edgeMap.set(key, edge)
  }

  // 添加新边（避免重复，保留 usageType）
  for (const edge of newGraph.edges) {
    const key = `${edge.source}::${edge.target}`
    if (!edgeMap.has(key)) {
      edgeMap.set(key, edge)
    }
  }

  // 转回数组
  const nodes = Array.from(nodeMap.values())
  const edges = Array.from(edgeMap.values())

  return { nodes, edges }
}

/**
 * 对图数据应用过滤器
 */
export function applyFilters(graphData: GraphData, filters: DependencyGraphFilters): GraphData {
  let filteredNodes = graphData.nodes

  // 按自定义/标准过滤
  if (filters.showCustomOnly) {
    filteredNodes = filteredNodes.filter(node => node.isCustom || node.isRoot)
  } else if (filters.showStandardOnly) {
    filteredNodes = filteredNodes.filter(node => !node.isCustom || node.isRoot)
  }

  // 按对象类型过滤
  if (filters.objectTypes.length > 0) {
    filteredNodes = filteredNodes.filter(
      node => node.isRoot || filters.objectTypes.includes(node.type)
    )
  }

  // 创建节点 ID 集合用于过滤边
  const nodeIds = new Set(filteredNodes.map(n => n.id))

  // 过滤边 - 只保留两个节点都存在的边
  let filteredEdges = graphData.edges.filter(
    edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)
  )

  // 指定时按使用类型过滤
  if (filters.usageTypes.length > 0) {
    filteredEdges = filteredEdges.filter(
      edge => edge.usageType && filters.usageTypes.includes(edge.usageType)
    )
  }

  return {
    nodes: filteredNodes,
    edges: filteredEdges
  }
}

/**
 * 从图数据获取唯一的对象类型
 */
export function getObjectTypes(graphData: GraphData): string[] {
  const types = new Set<string>()
  for (const node of graphData.nodes) {
    if (node.type) {
      types.add(node.type)
    }
  }
  return Array.from(types).sort()
}

/**
 * 从图边获取唯一的使用类型
 */
export function getUsageTypes(graphData: GraphData): string[] {
  const types = new Set<string>()
  for (const edge of graphData.edges) {
    if (edge.usageType) {
      types.add(edge.usageType)
    }
  }
  return Array.from(types).sort()
}

/**
 * 可视化依赖关系图的主命令
 */
export async function visualizeDependencyGraph(uri?: vscode.Uri) {
  try {
    // 获取活动编辑器以捕获光标位置
    const editor = window.activeTextEditor

    // 未提供 URI 时获取活动 ABAP 文件
    if (!uri) {
      if (!editor) {
        window.showErrorMessage("No active ABAP file")
        return
      }
      uri = editor.document.uri
    }

    // 校验它是 ADT URI
    if (uri.scheme !== "adt") {
      window.showErrorMessage("Dependency graph is only available for ABAP objects")
      return
    }

    // 从 URI 提取连接 ID
    const connectionMatch = uri.authority.match(/^([^\/]+)/)
    if (!connectionMatch) {
      window.showErrorMessage("Could not determine SAP connection")
      return
    }
    const connectionId = connectionMatch[1]

    // 编辑器在同一文件时获取光标位置
    let cursorLine: number | undefined = undefined
    let cursorCharacter: number | undefined = undefined
    if (editor && editor.document.uri.toString() === uri.toString()) {
      // 如果选区不为空，使用选区起点
      const selection = editor.selection
      const position = selection.isEmpty ? selection.active : selection.start
      cursorLine = position.line + 1 // ADT 使用从 1 开始的行号
      cursorCharacter = position.character
    } else {
    }

    // 显示进度
    await window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Hold on to your hat..Building dependency graph...`,
        cancellable: false
      },
      async progress => {
        progress.report({ increment: 20, message: "Getting object details..." })

        // 从文件系统根获取对象详情（对间歇性失败带重试）
        // getOrCreateRoot 和 isAbapFile 已在顶部静态导入

        const root = await getOrCreateRoot(uri!.authority)

        // 对间歇性元数据获取失败的重试逻辑
        let node
        let lastError
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            node = await root.getNodeAsync(uri!.path)
            break // 成功
          } catch (error) {
            lastError = error
            const errorStr = String(error)

            // 跳过增强对象 - 它们不支持标准元数据
            if (errorStr.includes("ENHO/")) {
              throw new Error(
                `Enhancement objects (ENHO/) are not supported for dependency graphs. Please use regular ABAP objects.`
              )
            }

            if (attempt < 3) {
              // 重试前等待：100ms、200ms
              await new Promise(resolve => setTimeout(resolve, attempt * 200))
            }
          }
        }

        if (!node) {
          throw new Error(`Failed to retrieve object metadata after 3 attempts: ${lastError}`)
        }

        if (!isAbapFile(node)) {
          throw new Error("Nope.Not an ABAP file")
        }

        const objectName = node.object.name.toUpperCase()
        const objectType = node.object.type || ""
        let mainUrl = node.object.contentsPath()
        // 使用 getOptimalObjectURI 逻辑获取正确的 where-used URL（对表等）
        try {
          mainUrl = getOptimalObjectURI(node.object.type, mainUrl)
        } catch (e) {
          // 回退：使用原始 mainUrl
        }

        progress.report({ increment: 20, message: "Fetching where-used data..." })

        // 带光标位置获取 where-used 数据，用于符号级搜索
        const references = await fetchWhereUsedData(
          mainUrl,
          connectionId,
          cursorLine,
          cursorCharacter
        )

        progress.report({ increment: 30, message: "Building graph..." })

        // 用对象名/类型作为根 - ADT API 处理符号级解析
        // 如果提供了光标位置，API 返回对该特定符号的引用
        // 根节点表示 API 实际搜索的内容
        const rootObjectName = node.object.name.toUpperCase()
        const rootObjectType = node.object.type || ""
        const graphData = buildGraphData(rootObjectName, rootObjectType, references)

        progress.report({ increment: 20, message: "Opening visualization..." })

        // 获取实际根节点名（如果提取了符号，可能与文件名不同）
        const actualRootNode = graphData.nodes.find(n => n.isRoot)
        const actualRootName = actualRootNode?.name || rootObjectName
        const actualRootType = actualRootNode?.type || rootObjectType

        // 获取 Webview 管理器并创建面板
        const webviewManager = WebviewManager.getInstance()
        await webviewManager.showDependencyGraph(
          connectionId,
          actualRootName,
          actualRootType,
          graphData,
          mainUrl
        )

        progress.report({ increment: 10, message: "Done!" })
      }
    )
  } catch (error) {
    window.showErrorMessage(`Failed to visualize dependency graph: ${error}`)
    console.error("Error visualizing dependency graph:", error)
  }
}
