/**
 * S/4HANA 就绪仪表盘的数据获取和连接逻辑。
 *
 * 从 SAP 获取 SYCM 表并在 JS 中执行连接
 * （因为 ADT SQL 有 255 字符查询限制，所以需要这样做）。
 */

import { ADTClient } from "abap-adt-api"
import {
  CustomReference,
  GroupedData,
  ItemGroup,
  ItemPiecelistLink,
  PiecelistEntry,
  SimplificationItem
} from "./types"
import { log } from "../../lib"

const LOG_PREFIX = "[S4H Data]"
const INITIAL_LIMIT = 150000
const INCREMENT = 50000
const ABSOLUTE_MAX = 500000

/**
 * 带自动分页运行查询。从 INITIAL_LIMIT 行开始，
 * 如果 ADT 提示还有更多（返回 limit+1 行），用更高的
 * 限制重试，直到获取所有行或达到 ABSOLUTE_MAX。
 */
async function safeQuery(client: ADTClient, sql: string, context: string): Promise<any[]> {
  let limit = INITIAL_LIMIT
  while (limit <= ABSOLUTE_MAX) {
    log.debug(`${LOG_PREFIX} ${context}: querying with limit=${limit}`)
    const result = await client.runQuery(sql, limit + 1, true)
    if (!result?.values) return []
    if (result.values.length <= limit) {
      log.debug(`${LOG_PREFIX} ${context}: got ${result.values.length} rows (complete)`)
      return result.values
    }
    // 还有更多行 — 增加限制并重试
    log.debug(
      `${LOG_PREFIX} ${context}: got ${result.values.length} rows, more available — retrying with higher limit`
    )
    limit += INCREMENT
  }
  // 达到绝对上限 — 以该限制最后获取一次
  log.warn(
    `${LOG_PREFIX} ${context}: hit absolute max (${ABSOLUTE_MAX}), results may be incomplete`
  )
  const result = await client.runQuery(sql, ABSOLUTE_MAX, true)
  return result?.values || []
}

export async function fetchSimplificationItems(client: ADTClient): Promise<SimplificationItem[]> {
  log.debug(`${LOG_PREFIX} fetchSimplificationItems: querying sycm_sitem`)
  const values = await safeQuery(
    client,
    "SELECT id, version, title, note, replacement_id FROM sycm_sitem",
    "fetchSimplificationItems"
  )
  log.debug(`${LOG_PREFIX} fetchSimplificationItems: got ${values.length} items`)
  return values.map((row: any) => ({
    id: (row.ID || "").trim(),
    version: (row.VERSION || "").trim(),
    title: (row.TITLE || "").trim(),
    note: parseInt(row.NOTE, 10) || 0,
    replacementId: (row.REPLACEMENT_ID || "").trim()
  }))
}

export async function fetchCustomRefs(client: ADTClient): Promise<CustomReference[]> {
  log.debug(`${LOG_PREFIX} fetchCustomRefs: querying sycm_cust_refs`)
  const values = await safeQuery(client, "SELECT * FROM sycm_cust_refs", "fetchCustomRefs")
  log.debug(`${LOG_PREFIX} fetchCustomRefs: got ${values.length} refs`)
  return values
    .filter((row: any) => (row.OBJ_NAME || "").trim() !== "")
    .map((row: any) => ({
      extractionSysid: (row.EXTRACTION_SYSID || "").trim(),
      extractionName: (row.EXTRACTION_NAME || "").trim(),
      referenceKind: (row.REFERENCE_KIND || "").trim(),
      hash: (row.HASH || "").trim(),
      refObjType: (row.REF_OBJ_TYPE || "").trim(),
      refObjName: (row.REF_OBJ_NAME || "").trim(),
      refSubType: (row.REF_SUB_TYPE || "").trim(),
      refSubName: (row.REF_SUB_NAME || "").trim(),
      refIntType: (row.REF_INT_TYPE || "").trim(),
      refIntName: (row.REF_INT_NAME || "").trim(),
      objType: (row.OBJ_TYPE || "").trim(),
      objName: (row.OBJ_NAME || "").trim(),
      subType: (row.SUB_TYPE || "").trim(),
      subName: (row.SUB_NAME || "").trim(),
      includeName: (row.INCLUDE_NAME || "").trim(),
      devclass: (row.DEVCLASS || "").trim(),
      genflag: (row.GENFLAG || "").trim(),
      dlvunit: (row.DLVUNIT || "").trim(),
      refApplComponent: (row.REF_APPL_COMPONENT || "").trim()
    }))
}

export async function fetchItemPiecelistLinks(client: ADTClient): Promise<ItemPiecelistLink[]> {
  log.debug(`${LOG_PREFIX} fetchItemPiecelistLinks: querying sycm_sitem_plist`)
  const values = await safeQuery(
    client,
    "SELECT id, version, piecelist_id FROM sycm_sitem_plist",
    "fetchItemPiecelistLinks"
  )
  log.debug(`${LOG_PREFIX} fetchItemPiecelistLinks: got ${values.length} links`)
  return values.map((row: any) => ({
    id: (row.ID || "").trim(),
    version: (row.VERSION || "").trim(),
    piecelistId: (row.PIECELIST_ID || "").trim()
  }))
}

/**
 * 在单次 ADT 调用中获取整个 piecelist 表。
 * 此表把 piecelist ID 映射到受影响的 SAP 对象名。
 * 通常有 10 万-20 万行，但单次调用远比数百次按 ID 查询好。
 */
export async function fetchPiecelist(client: ADTClient): Promise<PiecelistEntry[]> {
  log.debug(`${LOG_PREFIX} fetchPiecelist: querying full sycm_piecelist`)
  const values = await safeQuery(
    client,
    "SELECT piecelist_id, object_type, object_name FROM sycm_piecelist",
    "fetchPiecelist"
  )
  log.debug(`${LOG_PREFIX} fetchPiecelist: got ${values.length} entries`)
  return values.map(mapPiecelistRow)
}

function mapPiecelistRow(row: any): PiecelistEntry {
  return {
    piecelistId: (row.PIECELIST_ID || "").trim(),
    pgmid: "",
    objectType: (row.OBJECT_TYPE || "").trim(),
    objectName: (row.OBJECT_NAME || "").trim(),
    packageName: "",
    applicationComponent: ""
  }
}

/**
 * 通过 piecelist 把自定义引用连接到简化项。
 *
 * 连接路径：CUST_REFS.REF_OBJ_NAME → PIECELIST.OBJECT_NAME
 *          → PIECELIST.PIECELIST_ID → SITEM_PLIST.PIECELIST_ID
 *          → SITEM_PLIST.ID → SITEM.ID
 */
export function joinData(
  items: SimplificationItem[],
  refs: CustomReference[],
  piecelist: PiecelistEntry[],
  itemPiecelistLinks: ItemPiecelistLink[]
): GroupedData {
  // 构建查找：piecelistId → 项 ID 集合
  const piecelistToItemIds = new Map<string, Set<string>>()
  for (const link of itemPiecelistLinks) {
    let set = piecelistToItemIds.get(link.piecelistId)
    if (!set) {
      set = new Set()
      piecelistToItemIds.set(link.piecelistId, set)
    }
    set.add(link.id)
  }

  // 构建查找：objectName → piecelist ID 集合
  const objNameToPiecelistIds = new Map<string, Set<string>>()
  for (const p of piecelist) {
    let set = objNameToPiecelistIds.get(p.objectName)
    if (!set) {
      set = new Set()
      objNameToPiecelistIds.set(p.objectName, set)
    }
    set.add(p.piecelistId)
  }

  // 构建项查找
  const itemMap = new Map<string, SimplificationItem>()
  for (const item of items) {
    itemMap.set(item.id, item)
  }

  // 对每个引用，找到它属于哪个项
  const groupMap = new Map<string, CustomReference[]>() // itemId → 引用
  const ungrouped: CustomReference[] = []

  for (const ref of refs) {
    const piecelistIds = objNameToPiecelistIds.get(ref.refObjName)
    if (!piecelistIds) {
      ungrouped.push(ref)
      continue
    }

    let matched = false
    for (const plId of piecelistIds) {
      const itemIds = piecelistToItemIds.get(plId)
      if (itemIds) {
        for (const itemId of itemIds) {
          if (itemMap.has(itemId)) {
            let arr = groupMap.get(itemId)
            if (!arr) {
              arr = []
              groupMap.set(itemId, arr)
            }
            arr.push(ref)
            matched = true
            break // 分配给第一个匹配的项
          }
        }
        if (matched) break
      }
    }
    if (!matched) {
      ungrouped.push(ref)
    }
  }

  const groups: ItemGroup[] = []
  for (const [itemId, itemRefs] of groupMap) {
    const item = itemMap.get(itemId)!
    groups.push({ item, refs: itemRefs })
  }

  // 合并共享相同标题+注释的分组（同一项的不同版本）
  const mergedMap = new Map<string, ItemGroup>()
  for (const group of groups) {
    const key = `${group.item.title}||${group.item.note}`
    const existing = mergedMap.get(key)
    if (existing) {
      existing.refs.push(...group.refs)
    } else {
      mergedMap.set(key, { item: group.item, refs: [...group.refs] })
    }
  }
  const mergedGroups = [...mergedMap.values()]

  // 按引用数降序排序分组
  mergedGroups.sort((a, b) => b.refs.length - a.refs.length)

  return { groups: mergedGroups, ungrouped, totalRefs: refs.length }
}

/**
 * 编排连接的完整数据获取 + 连接。
 */
export async function loadReadinessData(
  client: ADTClient,
  onProgress?: (message: string) => void
): Promise<GroupedData> {
  const report = onProgress || (() => {})
  log.debug(`${LOG_PREFIX} loadReadinessData: starting`)
  report("Fetching simplification items & custom references...")
  // 并行获取项和链接（小表）
  const [items, itemLinks, refs] = await Promise.all([
    fetchSimplificationItems(client),
    fetchItemPiecelistLinks(client),
    fetchCustomRefs(client)
  ])
  report(`Found ${refs.length} custom references, ${items.length} simplification items`)

  if (refs.length === 0) {
    log(`${LOG_PREFIX} loadReadinessData: no custom refs found`)
    return { groups: [], ungrouped: [], totalRefs: 0 }
  }

  // 一次调用获取完整 piecelist（通常 10 万-20 万行）
  // 远比可能 500+ 次顺序调用的按 ID 查询快
  report("Fetching piecelist (this may take a moment)...")
  const piecelist = await fetchPiecelist(client)
  report(`Got ${piecelist.length} piecelist entries, joining data...`)

  log.debug(`${LOG_PREFIX} loadReadinessData: joining data...`)
  const result = joinData(items, refs, piecelist, itemLinks)
  log.debug(
    `${LOG_PREFIX} loadReadinessData: done. ${result.groups.length} groups, ${result.ungrouped.length} ungrouped`
  )
  return result
}
