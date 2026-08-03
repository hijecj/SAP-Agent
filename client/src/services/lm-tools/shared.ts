import { getClient } from "../../adt/conections"
import { getObjectTypeConfig } from "abapobject"

/**
 * ABAP 语言模型工具的共享工具和类型
 */

// ============================================================================
// SQL 注入防护
// ============================================================================

/**
 * 清理 SAP 对象名以防止 SQL 注入。
 * SAP 对象名由字母数字、下划线和斜杠（命名空间）组成。
 * 此函数校验并清理输入，确保它可安全用于 SQL 查询。
 *
 * @throws 名称包含无效字符时抛出错误
 */
export function sanitizeObjectName(name: string): string {
  if (!name || typeof name !== "string") {
    throw new Error("Object name is required and must be a string")
  }

  const sanitized = name.trim().toUpperCase()

  // SAP 对象名：字母数字、下划线、正斜杠（命名空间）、百分号（LIKE 通配符）
  // 大多数对象的最大长度通常为 30 个字符，但有些可以更长
  const validPattern = /^[A-Z0-9_/%]+$/

  if (!validPattern.test(sanitized)) {
    throw new Error(
      `Invalid object name: "${name}". Only alphanumeric characters, underscores, forward slashes, and percent signs are allowed.`
    )
  }

  if (sanitized.length > 120) {
    throw new Error(`Object name too long: "${name}". Maximum length is 120 characters.`)
  }

  // 附加检查：无 SQL 关键字或可疑模式
  const suspiciousPatterns = [
    /'/, // 单引号（SQL 字符串定界符）
    /--/, // SQL 注释
    /;/, // 语句终止符
    /\bOR\b/i, // OR 关键字
    /\bAND\b/i, // AND 关键字
    /\bDROP\b/i, // DROP 关键字
    /\bDELETE\b/i, // DELETE 关键字
    /\bUPDATE\b/i, // UPDATE 关键字
    /\bINSERT\b/i // INSERT 关键字
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(sanitized)) {
      throw new Error(`Object name contains suspicious pattern: "${name}"`)
    }
  }

  return sanitized
}

// ============================================================================
// 数据字典查询辅助
// ============================================================================

/**
 * 从 DD40L/DD40T 获取表类型信息
 */
export async function getTableTypeFromDD(client: any, typeName: string): Promise<string> {
  const sanitizedName = sanitizeObjectName(typeName)
  const sql = `SELECT l~TYPENAME, l~ROWTYPE, l~ROWKIND, l~DATATYPE, l~LENG, l~DECIMALS, t~DDTEXT FROM DD40L AS l INNER JOIN DD40T AS t ON l~TYPENAME = t~TYPENAME WHERE l~TYPENAME = '${sanitizedName}' AND l~AS4LOCAL = 'A' AND t~DDLANGUAGE = 'E' AND t~AS4LOCAL = 'A'`

  const result = await client.runQuery(sql, 100, true)

  if (!result || !result.values || result.values.length === 0) {
    return ""
  }

  let structure = `Table Type from DD40L/DD40T:\n`
  result.values.forEach((row: any) => {
    structure += `Type Name: ${row.TYPENAME}\n`
    if (row.DDTEXT) structure += `Description: ${row.DDTEXT}\n`
    structure += `Line Type (ROWTYPE): ${row.ROWTYPE}\n`
    structure += `Row Kind: ${row.ROWKIND}\n`
    if (row.DATATYPE) {
      structure += `Data Type: ${row.DATATYPE}`
      if (row.LENG) structure += `(${row.LENG})`
      if (row.DECIMALS) structure += ` DECIMALS ${row.DECIMALS}`
      structure += `\n`
    }
    structure += `\n This is a table type that references line type ${row.ROWTYPE}. To see the actual fields, query the line type structure.`
  })

  return structure
}

/**
 * 从 DD03M 获取表结构
 */
export async function getTableStructureFromDD(client: any, objectName: string): Promise<string> {
  const sanitizedName = sanitizeObjectName(objectName)
  const sql = `SELECT TABNAME, FIELDNAME, ROLLNAME, DOMNAME, POSITION, KEYFLAG, MANDATORY, CHECKTABLE, INTTYPE, INTLEN, PRECFIELD, ROUTPUTLEN, DATATYPE, LENG, OUTPUTLEN, DECIMALS, DDTEXT, LOWERCASE, SIGNFLAG, LANGFLAG, VALEXI, ENTITYTAB, CONVEXIT FROM DD03M WHERE TABNAME = '${sanitizedName}' AND DDLANGUAGE = 'E' ORDER BY POSITION`

  const result = await client.runQuery(sql, 1000, true)

  if (!result || !result.values || result.values.length === 0) {
    return ""
  }

  let structure = `Fields from DD03M (Data Dictionary with Text):\n`
  result.values.forEach((row: any) => {
    const fieldName = row.FIELDNAME || ""
    const dataElement = row.ROLLNAME || ""
    const domain = row.DOMNAME || ""
    const description = row.DDTEXT || ""
    const keyFlag = row.KEYFLAG === "X" ? " [KEY]" : ""
    const mandatory = row.MANDATORY === "X" ? " [MANDATORY]" : ""
    const intType = row.INTTYPE || ""
    const intLen = row.INTLEN || ""
    const dataType = row.DATATYPE || ""
    const length = row.LENG || ""
    const decimals = row.DECIMALS || ""

    structure += `${fieldName}: ${intType || dataType}`
    if (intLen || length) structure += `(${intLen || length})`
    if (decimals) structure += ` DECIMALS(${decimals})`
    if (description) structure += ` - ${description}`
    if (dataElement) structure += ` [DE:${dataElement}]`
    if (domain) structure += ` [DOM:${domain}]`
    structure += `${keyFlag}${mandatory}\n`
  })

  return structure
}

/**
 * 从 DD02L 获取追加结构
 */
export async function getAppendStructuresFromDD(
  client: any,
  tableName: string
): Promise<Array<{ name: string; fields: number }>> {
  const sanitizedName = sanitizeObjectName(tableName)
  const sql = `SELECT TABNAME, TABCLASS FROM DD02L WHERE SQLTAB = '${sanitizedName}' AND TABCLASS = 'APPEND' AND AS4LOCAL = 'A'`

  const result = await client.runQuery(sql, 100, true)

  if (!result || !result.values || result.values.length === 0) {
    return []
  }

  const appendStructures: Array<{ name: string; fields: number }> = []

  for (const row of result.values) {
    const appendName = row.TABNAME || ""
    if (appendName) {
      // 统计此追加结构中的字段 - appendName 已来自数据库，但为安全仍清理
      const sanitizedAppendName = sanitizeObjectName(appendName)
      const fieldCountSql = `SELECT COUNT(*) AS CNT FROM DD03L WHERE TABNAME = '${sanitizedAppendName}' AND AS4LOCAL = 'A' AND FIELDNAME <> '.INCLUDE'`
      try {
        const fieldResult = await client.runQuery(fieldCountSql, 1, true)
        const fieldCount = fieldResult?.values?.[0]?.CNT || 0
        appendStructures.push({ name: appendName, fields: parseInt(fieldCount, 10) })
      } catch {
        appendStructures.push({ name: appendName, fields: 0 })
      }
    }
  }

  return appendStructures
}

/**
 * 从 DD04L 获取数据元素信息
 */
export async function getDataElementFromDD(client: any, dataElementName: string): Promise<string> {
  const sanitizedName = sanitizeObjectName(dataElementName)
  const sql = `SELECT ROLLNAME, DOMNAME, DATATYPE, LENG, DECIMALS FROM DD04L WHERE ROLLNAME = '${sanitizedName}' AND AS4LOCAL = 'A'`

  const result = await client.runQuery(sql, 100, true)

  if (!result || !result.values || result.values.length === 0) {
    return ""
  }

  let structure = `Data Element from DD04L:\n`
  result.values.forEach((row: any) => {
    structure += `Element: ${row.ROLLNAME}\n`
    structure += `Domain: ${row.DOMNAME}\n`
    structure += `Data Type: ${row.DATATYPE}(${row.LENG})`
    if (row.DECIMALS) structure += ` DECIMALS ${row.DECIMALS}`
    structure += `\n`
  })

  return structure
}

/**
 * 从 DD01L 获取域信息
 */
export async function getDomainFromDD(client: any, domainName: string): Promise<string> {
  const sanitizedName = sanitizeObjectName(domainName)
  const headerSql = `SELECT DOMNAME, DATATYPE, LENG, DECIMALS FROM DD01L WHERE DOMNAME = '${sanitizedName}' AND AS4LOCAL = 'A'`

  const headerResult = await client.runQuery(headerSql, 10, true)

  let structure = `Domain from DD01L:\n`

  if (headerResult && headerResult.values && headerResult.values.length > 0) {
    const header = headerResult.values[0]
    structure += `Domain: ${header.DOMNAME}\n`
    structure += `Data Type: ${header.DATATYPE}(${header.LENG})`
    if (header.DECIMALS) structure += ` DECIMALS ${header.DECIMALS}`
    structure += `\n`
  }

  return structure
}

/**
 * 获取包括追加结构的完整表结构
 */
export async function getCompleteTableStructure(
  connectionId: string,
  objectName: string,
  objectUri: string
): Promise<string> {
  try {
    const client = getClient(connectionId)
    const sanitizedName = sanitizeObjectName(objectName)

    const mainTableURI = getOptimalObjectURI("TABL/TA", objectUri)
    let mainStructure = ""

    try {
      mainStructure = await client.getObjectSource(mainTableURI)
    } catch (mainError) {
      try {
        const tableFields = await getTableStructureFromDD(client, sanitizedName)
        if (tableFields) {
          mainStructure = tableFields

          const completeStructure =
            `Complete Structure for ${sanitizedName} (from DD03L — main object + ALL append structures):\n\n` +
            tableFields

          return completeStructure
        }
      } catch (fallbackError) {
        // 忽略
      }
    }

    let allAppendStructures = ""
    let appendStructuresList: Array<{ name: string; fields: number }> = []

    try {
      appendStructuresList = await getAppendStructuresFromDD(client, sanitizedName)

      if (appendStructuresList.length > 0) {
        allAppendStructures += `\n\nALL APPEND STRUCTURES (${appendStructuresList.length}):\n`
        for (const append of appendStructuresList) {
          allAppendStructures += `• ${append.name} (${append.fields} fields)\n`
        }
      }
    } catch (appendError) {
      // 追加结构是可选的
    }

    let completeStructure = `Complete Table Structure for ${sanitizedName} (SE11-like, includes ALL append structures):\n`
    completeStructure += ` Append Structures Found: ${appendStructuresList.length}\n\n`

    if (mainStructure) {
      completeStructure += `MAIN TABLE STRUCTURE:\n`
      completeStructure += mainStructure + "\n"
    }

    if (allAppendStructures) {
      completeStructure += allAppendStructures
    }

    return completeStructure
  } catch (error) {
    return `Could not retrieve complete table structure for ${objectName}: ${error}`
  }
}

// ============================================================================
// 增强类型和接口
// ============================================================================

/**
 * 增强类型和接口
 */
export interface EnhancementInfo {
  name: string // ENHO implementation name (e.g., 'Z_MY_ENHANCEMENT')
  spot: string // Enhancement spot fullname (e.g., '\PR:<PROG>\EX:<SPOT_NAME>\EI')
  startLine: number
  type: string // e.g., 'ENHANCEMENT'
  code?: string // 只在 needCode = true 时包含
  uri?: string // 用于单独访问的 SAP 增强 URI（每个元素唯一）
}

export interface EnhancementResult {
  hasEnhancements: boolean
  enhancements: EnhancementInfo[]
  totalEnhancements?: number
}

/**
 * 🔧 工具：按对象类型获取最优 URI 路径
 * 使用我们的研究结果判断 XML 元数据是否足够，
 * 或者实际源码是否需要 /source/main
 */
export function getOptimalObjectURI(objectType: string, baseUri: string): string {
  const config = getObjectTypeConfig(objectType)
  if (config) {
    if (config.sourceRequired) {
      const sourceUri = baseUri.endsWith("/source/main") ? baseUri : `${baseUri}/source/main`
      return sourceUri
    }
    if (config.extension?.endsWith(".xml")) {
      return baseUri
    }
  }

  // 未知或回退类型 - 尝试 /source/main
  const sourceUri = baseUri.endsWith("/source/main") ? baseUri : `${baseUri}/source/main`
  return sourceUri
}

/**
 * 🔧 工具：用 findObjectPath 解析正确的 URI 路径
 */
export async function resolveCorrectURI(
  originalUri: string,
  connectionId: string
): Promise<string> {
  try {
    const client = getClient(connectionId)

    const pathSteps = await client.findObjectPath(originalUri)

    if (pathSteps && pathSteps.length > 0) {
      // 使用最后一个路径步骤的 URI，因为它应该是最具体/正确的
      const lastStep = pathSteps[pathSteps.length - 1]
      const resolvedUri = lastStep["adtcore:uri"] || originalUri

      if (resolvedUri !== originalUri) {
      }

      return resolvedUri
    } else {
      // logCommands.warn(`⚠️ No path steps found for URI: ${originalUri}`);
      return originalUri
    }
  } catch (pathError) {
    // logCommands.warn(`⚠️ Path resolution failed for ${originalUri}: ${pathError}`);
    return originalUri // 回退到原始
  }
}

interface CachedEnhancementResult {
  result: EnhancementResult
  timestamp: number
  needCode: boolean
}

const enhancementCache = new Map<string, CachedEnhancementResult>()
const ENHANCEMENT_CACHE_TTL = 10 * 60 * 1000 // 10 分钟
const MAX_CACHE_SIZE = 1000 // 防止无限增长

setInterval(
  () => {
    const now = Date.now()
    const entriesToDelete: string[] = []

    // 第一遍：移除过期条目
    for (const [key, cached] of enhancementCache.entries()) {
      if (now - cached.timestamp > ENHANCEMENT_CACHE_TTL) {
        entriesToDelete.push(key)
      }
    }

    // 删除过期条目
    for (const key of entriesToDelete) {
      enhancementCache.delete(key)
    }

    // 第二遍：如果仍然太大，移除最旧的条目
    if (enhancementCache.size > MAX_CACHE_SIZE) {
      const sortedEntries = Array.from(enhancementCache.entries()).sort(
        ([, a], [, b]) => a.timestamp - b.timestamp
      )

      const toRemove = sortedEntries.slice(0, enhancementCache.size - MAX_CACHE_SIZE)
      for (const [key] of toRemove) {
        enhancementCache.delete(key)
      }
    }
  },
  5 * 60 * 1000
) // 每 5 分钟清理一次

/**
 * 使用 SAP 增强 API 获取 ABAP 对象的增强信息
 * 从语言模型工具、搜索工具和编辑器装饰调用
 */
export async function getObjectEnhancements(
  objectUriOrPath: string,
  connectionId: string,
  needCode: boolean = false
): Promise<EnhancementResult> {
  try {
    const cacheKey = `${connectionId}:${objectUriOrPath}:${needCode}`
    const cached = enhancementCache.get(cacheKey)
    const now = Date.now()

    if (cached && now - cached.timestamp < ENHANCEMENT_CACHE_TTL) {
      // 缓存命中 - 返回缓存结果
      return cached.result
    }

    const client = getClient(connectionId)

    // 确保我们有正确的 source/main 路径
    let sourceMainPath = objectUriOrPath
    if (!sourceMainPath.includes("/source/main")) {
      if (sourceMainPath.endsWith("/source/main")) {
        // 已有 /source/main
      } else {
        // 把 /source/main 添加到路径
        sourceMainPath = sourceMainPath.endsWith("/")
          ? `${sourceMainPath}source/main`
          : `${sourceMainPath}/source/main`
      }
    }

    const result: EnhancementResult = {
      hasEnhancements: false,
      enhancements: [],
      totalEnhancements: 0
    }

    try {
      const apiResult = await client.objectEnhancements(sourceMainPath, undefined, needCode)
      const allEnhancements: EnhancementInfo[] = apiResult.implementations.flatMap(impl =>
        impl.elements.map(el => ({
          name: impl.name, // ENHO 实现名
          spot: el.fullname, // 增强点完整名称（它钩入的位置）
          startLine: el.position?.startLine ?? 0,
          type: "ENHANCEMENT" as const,
          code: el.source,
          uri: el.uri
        }))
      )

      if (allEnhancements.length === 0) return result

      result.hasEnhancements = true
      result.totalEnhancements = allEnhancements.length
      result.enhancements = allEnhancements

      enhancementCache.set(cacheKey, { result, timestamp: now, needCode })
      return result
    } catch (apiError) {
      return result
    }
  } catch (error) {
    // logCommands.error(`❌ Error getting enhancements: ${error}`);
    return {
      hasEnhancements: false,
      enhancements: [],
      totalEnhancements: 0
    }
  }
}
