import { ADTClient, DebugVariable, DebugChildVariablesHierarchy } from "abap-adt-api"
import { CapturedVariable, CapturedScope, CaptureOptions, DEFAULT_CAPTURE_OPTIONS } from "./types"
import { log, caughtToString } from "../../../lib"

/** 单次 ADT API 调用的最大 ID 数，避免服务器过载 */
const MAX_IDS_PER_CALL = 500

/** 录制期间自动捕获的最大表行数 */

const RECORDING_MAX_TABLE_ROWS = 2000

/**
 * 录制模式的快速批量捕获，带可配置深度。
 *
 * 使用跨多个深度级别的广度优先展开和批量 API 调用：
 *   第 1 轮：debuggerChildVariables(["@ROOT"]) → 作用域 ID
 *   第 2 轮：debuggerChildVariables([所有作用域 ID]) → 所有顶级变量
 *   第 3...N 轮：对每个深度级别：
 *     - 批量当前级别的所有结构 ID → 全部展开
 *     - 批量当前级别的所有表行键 → 全部获取
 *
 * 使用 maxDepth=4（默认），通常 5-8 次 HTTP 调用即可捕获 4 层深度（约 1.5-3 秒）。
 * 使用 maxDepth=2，3-4 次调用即可捕获 2 层（约 0.8-1.5 秒）。
 */
export async function captureScopesBatched(
  client: ADTClient,
  options: CaptureOptions = DEFAULT_CAPTURE_OPTIONS
): Promise<CapturedScope[]> {
  // 第 1 轮：获取作用域层次（1 次 HTTP 调用）
  const { hierarchies } = await client.debuggerChildVariables(["@ROOT"])
  const scopeIds = hierarchies.map(h => h.CHILD_ID)
  if (!scopeIds.some(id => id === "SY")) scopeIds.push("SY")

  const scopeNames = new Map<string, string>()
  for (const h of hierarchies) scopeNames.set(h.CHILD_ID, h.CHILD_NAME || h.CHILD_ID)
  scopeNames.set("SY", "SY")

  // 第 2 轮：一次调用获取所有作用域变量（1 次 HTTP 调用）
  const allResult = await batchedChildVariables(client, scopeIds)
  const scopeVarMap = groupByParent(scopeIds, allResult.hierarchies, allResult.variables)

  // 构建初始变量树
  const varTree = new Map<string, VarNode>()
  for (const [scopeId, vars] of scopeVarMap) {
    for (const v of vars) {
      varTree.set(v.ID, { variable: v, children: new Map(), depth: 0 })
    }
  }

  // 使用 BFS 展开到 maxDepth 层
  for (let depth = 1; depth < options.maxDepth; depth++) {
    const didExpand = await expandOneLevel(client, varTree, depth)
    if (!didExpand) break // 此级别没有更多可展开项
  }

  // 从 varTree 组装作用域树
  const scopes: CapturedScope[] = []
  for (const scopeId of scopeIds) {
    const name = scopeNames.get(scopeId) || scopeId
    const vars = scopeVarMap.get(scopeId) || []
    const captured = vars.map(v => buildCapturedTree(v.ID, varTree))
    scopes.push({ name, variables: captured })
  }

  return scopes
}

// ── 展开引擎 ──

interface VarNode {
  variable: DebugVariable
  children: Map<string, VarNode>
  depth: number
}

/**
 * 展开给定深度级别的所有结构和表。
 * 有任何展开发生则返回 true，无可展开则返回 false。
 */
async function expandOneLevel(
  client: ADTClient,
  varTree: Map<string, VarNode>,
  depth: number
): Promise<boolean> {
  const structIds: string[] = []
  const tableSpecs: TableSpec[] = []

  // 收集此深度的所有可展开项
  for (const node of varTree.values()) {
    if (node.depth !== depth - 1) continue
    const v = node.variable
    if (v.META_TYPE === "structure") {
      structIds.push(v.ID)
    } else if (v.META_TYPE === "table") {
      const lines = v.TABLE_LINES || 0
      if (lines > 0) {
        tableSpecs.push({ id: v.ID, rows: Math.min(lines, RECORDING_MAX_TABLE_ROWS) })
      }
    }
  }

  if (structIds.length === 0 && tableSpecs.length === 0) return false

  // 并行运行结构展开和表行获取
  const structPromise =
    structIds.length > 0 ? batchedChildVariables(client, structIds) : Promise.resolve(null)

  // 构建表行键
  const allKeys: string[] = []
  const keyToTableId = new Map<string, string>()
  for (const spec of tableSpecs) {
    const cleanId = spec.id.replace(/\[\]$/, "")
    for (let i = 1; i <= spec.rows; i++) {
      const key = `${cleanId}[${i}]`
      allKeys.push(key)
      keyToTableId.set(key, spec.id)
    }
  }
  const tablePromise = allKeys.length > 0 ? batchedVariables(client, allKeys) : Promise.resolve([])

  const [structResult, rowVars] = await Promise.all([structPromise, tablePromise])

  // 应用结构结果
  if (structResult) {
    const grouped = groupByParent(structIds, structResult.hierarchies, structResult.variables)
    for (const [parentId, children] of grouped) {
      const parentNode = varTree.get(parentId)
      if (!parentNode) continue
      for (const child of children) {
        const childNode: VarNode = { variable: child, children: new Map(), depth }
        parentNode.children.set(child.ID, childNode)
        varTree.set(child.ID, childNode)
      }
    }
  }

  // 应用表行结果
  for (const rowVar of rowVars) {
    const tableId = keyToTableId.get(rowVar.ID) || inferTableId(rowVar.ID)
    const tableNode = varTree.get(tableId)
    if (!tableNode) continue
    const rowNode: VarNode = { variable: rowVar, children: new Map(), depth }
    tableNode.children.set(rowVar.ID, rowNode)
    varTree.set(rowVar.ID, rowNode)
  }

  return true
}

/**
 * 从 VarNode 树递归构建 CapturedVariable 树。
 */
function buildCapturedTree(varId: string, varTree: Map<string, VarNode>): CapturedVariable {
  const node = varTree.get(varId)
  if (!node) {
    // 不应发生，但返回占位符
    return { id: varId, name: varId, value: "", type: "", metaType: "unknown" }
  }

  const v = node.variable
  const cv: CapturedVariable = {
    id: v.ID,
    name: v.NAME,
    value: v.VALUE,
    type: v.TECHNICAL_TYPE,
    metaType: v.META_TYPE,
    tableLines: v.TABLE_LINES
  }

  if (node.children.size > 0) {
    cv.children = Array.from(node.children.values()).map(child =>
      buildCapturedTree(child.variable.ID, varTree)
    )
    // 为被截断的表添加跳过原因
    if (v.META_TYPE === "table" && cv.children.length < (v.TABLE_LINES || 0)) {
      cv.skipReason = `Captured ${cv.children.length} of ${v.TABLE_LINES} rows`
    }
  } else if (v.META_TYPE === "table" && (v.TABLE_LINES || 0) > 0 && node.children.size === 0) {
    cv.skipReason = `No rows captured (table may have been empty at deeper depth levels)`
  }

  return cv
}

// ── 批量 API 辅助 ──

interface TableSpec {
  id: string
  rows: number
}

interface BatchedChildResult {
  hierarchies: DebugChildVariablesHierarchy[]
  variables: DebugVariable[]
}

/** 需要时以子批次调用 debuggerChildVariables */
async function batchedChildVariables(
  client: ADTClient,
  ids: string[]
): Promise<BatchedChildResult> {
  if (ids.length <= MAX_IDS_PER_CALL) {
    return client.debuggerChildVariables(ids)
  }
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) {
    batches.push(ids.slice(i, i + MAX_IDS_PER_CALL))
  }
  const results = await Promise.all(batches.map(batch => client.debuggerChildVariables(batch)))
  const allHierarchies: DebugChildVariablesHierarchy[] = []
  const allVariables: DebugVariable[] = []
  for (const result of results) {
    allHierarchies.push(...result.hierarchies)
    allVariables.push(...result.variables)
  }
  return { hierarchies: allHierarchies, variables: allVariables }
}

/** 需要时以子批次调用 debuggerVariables */
async function batchedVariables(client: ADTClient, ids: string[]): Promise<DebugVariable[]> {
  if (ids.length <= MAX_IDS_PER_CALL) {
    return client.debuggerVariables(ids)
  }
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) {
    batches.push(ids.slice(i, i + MAX_IDS_PER_CALL))
  }
  const results = await Promise.allSettled(batches.map(batch => client.debuggerVariables(batch)))
  const all: DebugVariable[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === "fulfilled") {
      all.push(...result.value)
    } else {
      log(
        `Failed batch variables ${i * MAX_IDS_PER_CALL + 1}-${Math.min((i + 1) * MAX_IDS_PER_CALL, ids.length)}: ${caughtToString(result.reason)}`
      )
    }
  }
  return all
}

// ── 分组和组装 ──

/** 使用层次信息把扁平变量列表分组回其父 ID */
function groupByParent(
  parentIds: string[],
  hierarchies: DebugChildVariablesHierarchy[],
  variables: DebugVariable[]
): Map<string, DebugVariable[]> {
  const result = new Map<string, DebugVariable[]>()
  for (const pid of parentIds) result.set(pid, [])

  // 从层次构建子→父查找
  const childToParent = new Map<string, string>()
  for (const h of hierarchies) {
    childToParent.set(h.CHILD_ID, h.PARENT_ID)
  }

  for (const v of variables) {
    // 先尝试层次映射
    const parent = childToParent.get(v.ID)
    if (parent && result.has(parent)) {
      result.get(parent)!.push(v)
      continue
    }
    // 回退：按 ID 前缀匹配
    for (const pid of parentIds) {
      if (v.ID.startsWith(pid)) {
        result.get(pid)!.push(v)
        break
      }
    }
  }

  return result
}

function inferTableId(rowId: string): string {
  const match = rowId.match(/^(.+)\[\d+\]$/)
  return match ? match[1] : rowId
}
