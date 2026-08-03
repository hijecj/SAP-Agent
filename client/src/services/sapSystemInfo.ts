import { getClient } from "../adt/conections"
import { RemoteManager } from "../config"

/**
 * SAP 系统信息服务
 * 从 SAP 表检索全面的系统信息
 * 包含缓存以避免重复查询 SAP
 */

// ============================================================================
// 接口
// ============================================================================

export interface SAPClientInfo {
  clientNumber: string
  clientName: string
  category: string
  logicalSystem: string
  changeProtection: string
}

export type SAPSystemType = "S/4HANA" | "ECC" | "Unknown"

export interface SAPSoftwareComponent {
  component: string
  release: string
  extRelease: string
  componentType: string
}

export interface SAPTimezoneInfo {
  timezone: string // 例如 "CAT"
  description: string // 例如 "Central Africa"
  utcOffset: string // 例如 "UTC+2"
  dstRule: string // 例如 "NONE" 或 DST 规则名
  rawOffset: string // 例如 "P0200"（SAP 原始值）
}

export interface SAPSystemInfo {
  sapRelease: string
  systemType: SAPSystemType
  currentClient: SAPClientInfo | null
  softwareComponents: SAPSoftwareComponent[]
  timezone: SAPTimezoneInfo | null
  queryTimestamp: string
}

// ============================================================================
// 缓存管理
// ============================================================================

interface CachedSystemInfo {
  data: SAPSystemInfo
  timestamp: number
}

// 缓存存储："baseUrl|client" -> 缓存数据
// 用 URL + client 作为键，因为 connectionId 只是用户标签，可能会变
const systemInfoCache = new Map<string, CachedSystemInfo>()

// 默认 TTL：24 小时（毫秒）
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 从 URL 和 client 生成缓存键
 */
function getCacheKey(url: string, client: string): string {
  // 规范化 URL：转小写、移除尾部斜杠
  const normalizedUrl = url.toLowerCase().replace(/\/$/, "")
  return `${normalizedUrl}|${client}`
}

/**
 * 清除系统信息缓存
 * 在扩展停用时调用以释放内存
 */
export function clearSystemInfoCache(): void {
  systemInfoCache.clear()
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取 client 类别描述
 */
function getClientCategoryDescription(category: string): string {
  const categories: Record<string, string> = {
    P: "Production",
    T: "Test",
    C: "Customizing",
    D: "Demo",
    E: "Education/Training",
    S: "SAP Reference",
    "": "Not Classified"
  }
  return categories[category] || category || "Unknown"
}

/**
 * 获取更改保护描述
 */
function getChangeProtectionDescription(indicator: string): string {
  const protections: Record<string, string> = {
    "0": "Changes allowed (no protection)",
    "1": "No changes allowed",
    "2": "No changes allowed, no transports allowed",
    "": "No protection"
  }
  return protections[indicator] || indicator || "Unknown"
}

/**
 * 基于软件组件检测 SAP 系统类型
 * S/4HANA 有 S4CORE 或 S4COREOP 组件
 * ECC 有 SAP_APPL 组件但没有 S4CORE
 */
function detectSystemType(components: SAPSoftwareComponent[]): SAPSystemType {
  const hasS4Core = components.some(c => c.component === "S4CORE" || c.component === "S4COREOP")

  if (hasS4Core) {
    return "S/4HANA"
  }

  // 检查 ECC 指示器
  const hasSapAppl = components.some(c => c.component === "SAP_APPL")
  const hasSapBasis = components.some(c => c.component === "SAP_BASIS")

  if (hasSapAppl || hasSapBasis) {
    return "ECC"
  }

  return "Unknown"
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 获取全面的 SAP 系统信息（带缓存）
 * 缓存 TTL 为 24 小时。使用 clearSystemInfoCache() 强制刷新。
 * @param connectionId - SAP 连接 ID（例如 'dev100'）
 * @param includeComponents - 是否包含完整软件组件列表（默认：false）
 * @returns 带系统详情的 SAPSystemInfo 对象
 */
export async function getSAPSystemInfo(
  connectionId: string,
  includeComponents: boolean = false
): Promise<SAPSystemInfo> {
  // 导入依赖
  // 改用静态导入

  // 获取客户端和配置
  const client = getClient(connectionId)
  if (!client) {
    throw new Error(`No client found for connection: ${connectionId}`)
  }

  const connectionConfig = RemoteManager.get().byId(connectionId)
  if (!connectionConfig) {
    throw new Error(`Connection configuration not found for: ${connectionId}`)
  }

  const url = connectionConfig.url || ""
  const currentClientNumber = connectionConfig.client || ""

  // 先检查缓存
  const cacheKey = getCacheKey(url, currentClientNumber)
  const now = Date.now()

  const cached = systemInfoCache.get(cacheKey)
  if (cached && now - cached.timestamp < DEFAULT_CACHE_TTL_MS) {
    // 返回缓存数据，按请求过滤组件
    const cachedResult = { ...cached.data }
    if (!includeComponents) {
      cachedResult.softwareComponents = []
    }
    return cachedResult
  }

  // 从 SAP 获取新数据
  const result: SAPSystemInfo = {
    sapRelease: "",
    systemType: "Unknown",
    currentClient: null,
    softwareComponents: [],
    timezone: null,
    queryTimestamp: new Date().toISOString()
  }

  // 查询 T000 - Client 信息（仅当前 client）
  try {
    // 用前导零把 client 编号补齐为 3 位
    const paddedClient = currentClientNumber.padStart(3, "0")
    const t000Sql = `SELECT MANDT, MTEXT, CCCATEGORY, LOGSYS, CCNOCLIIND FROM T000 WHERE MANDT = '${paddedClient}'`
    const t000Result = await client.runQuery(t000Sql, 1, true)

    if (
      t000Result &&
      t000Result.values &&
      Array.isArray(t000Result.values) &&
      t000Result.values.length > 0
    ) {
      const row = t000Result.values[0]
      result.currentClient = {
        clientNumber: row.MANDT || "",
        clientName: row.MTEXT || "",
        category: getClientCategoryDescription(row.CCCATEGORY),
        logicalSystem: row.LOGSYS || "",
        changeProtection: getChangeProtectionDescription(row.CCNOCLIIND)
      }
    }
  } catch (error) {
    console.warn("Failed to query T000:", error)
  }

  // 查询 CVERS - 软件组件版本
  try {
    const cversSql = `SELECT COMPONENT, RELEASE, EXTRELEASE, COMP_TYPE FROM CVERS`
    const cversResult = await client.runQuery(cversSql, 500, true)

    if (cversResult && cversResult.values && Array.isArray(cversResult.values)) {
      const allComponents = cversResult.values.map((row: any) => ({
        component: row.COMPONENT || "",
        release: row.RELEASE || "",
        extRelease: row.EXTRELEASE || "",
        componentType: row.COMP_TYPE || ""
      }))

      // 始终基于软件组件检测系统类型
      result.systemType = detectSystemType(allComponents)

      // 始终存储完整组件列表（用于缓存）
      result.softwareComponents = allComponents
    }
  } catch (error) {
    console.warn("Failed to query CVERS:", error)
  }

  // 查询 SVERS - SAP 版本
  try {
    const sversSql = `SELECT VERSION FROM SVERS`
    const sversResult = await client.runQuery(sversSql, 10, true)

    if (
      sversResult &&
      sversResult.values &&
      Array.isArray(sversResult.values) &&
      sversResult.values.length > 0
    ) {
      result.sapRelease = sversResult.values[0].VERSION || ""
    }
  } catch (error) {
    console.warn("Failed to query SVERS:", error)
  }

  // 查询时区 - TTZCU（系统时区）+ TTZZ（时区详情）+ TTZZT（描述）
  try {
    // 从 TTZCU 获取系统时区
    const ttzSql = `SELECT cu~TZONESYS, z~ZONERULE, z~DSTRULE, t~DESCRIPT
      FROM ttzcu AS cu 
      INNER JOIN ttzz AS z ON cu~TZONESYS = z~TZONE
      INNER JOIN ttzzt AS t ON z~TZONE = t~TZONE
      WHERE cu~FLAGACTIVE = 'X' AND t~LANGU = 'E'`
    const ttzResult = await client.runQuery(ttzSql, 1, true)

    if (
      ttzResult &&
      ttzResult.values &&
      Array.isArray(ttzResult.values) &&
      ttzResult.values.length > 0
    ) {
      const row = ttzResult.values[0]
      const rawOffset = row.ZONERULE || ""

      // 解析偏移（例如 "P0200" -> "UTC+2"、"M0500" -> "UTC-5"）
      let utcOffset = rawOffset
      if (rawOffset.startsWith("P") || rawOffset.startsWith("M")) {
        const sign = rawOffset.startsWith("P") ? "+" : "-"
        const hours = parseInt(rawOffset.substring(1, 3), 10)
        const minutes = parseInt(rawOffset.substring(3, 5), 10)
        utcOffset = `UTC${sign}${hours}${minutes > 0 ? ":" + minutes.toString().padStart(2, "0") : ""}`
      }

      result.timezone = {
        timezone: row.TZONESYS || "",
        description: row.DESCRIPT || "",
        utcOffset,
        dstRule: row.DSTRULE || "NONE",
        rawOffset
      }
    }
  } catch (error) {
    console.warn("Failed to query timezone:", error)
  }

  // 存入缓存（始终带完整数据）
  systemInfoCache.set(cacheKey, {
    data: result,
    timestamp: now
  })

  // 按请求返回带或不带组件的
  if (!includeComponents) {
    return { ...result, softwareComponents: [] }
  }

  return result
}

/**
 * 把 SAP 系统信息格式化为供 LLM 使用的可读文本
 */
export function formatSAPSystemInfoAsText(info: SAPSystemInfo): string {
  let output = ""

  output += `📊 SAP SYSTEM INFORMATION\n`
  output += `${"=".repeat(60)}\n`
  output += `Query Timestamp: ${info.queryTimestamp}\n`
  output += `System Type: ${info.systemType}\n\n`

  // SAP 版本
  if (info.sapRelease) {
    output += `🔖 SAP RELEASE\n`
    output += `${"-".repeat(40)}\n`
    output += `Version: ${info.sapRelease}\n\n`
  }

  // 当前 client
  if (info.currentClient) {
    output += `🏢 CURRENT CLIENT (from T000)\n`
    output += `${"-".repeat(40)}\n`
    output += `• Client ${info.currentClient.clientNumber}: ${info.currentClient.clientName}\n`
    output += `  - Category: ${info.currentClient.category}\n`
    output += `  - Logical System: ${info.currentClient.logicalSystem || "N/A"}\n`
    output += `  - Change Protection: ${info.currentClient.changeProtection}\n`
    output += "\n"
  } else {
    output += `🏢 CURRENT CLIENT: No client information available\n\n`
  }

  // 时区信息
  if (info.timezone) {
    output += `🌍 SYSTEM TIMEZONE\n`
    output += `${"-".repeat(40)}\n`
    output += `• Timezone: ${info.timezone.timezone} (${info.timezone.description})\n`
    output += `• UTC Offset: ${info.timezone.utcOffset}\n`
    output += `• DST Rule: ${info.timezone.dstRule === "NONE" ? "No daylight saving time" : info.timezone.dstRule}\n`
    output += "\n"
  }

  // 软件组件（仅在包含时显示）
  if (info.softwareComponents.length > 0) {
    output += `📦 SOFTWARE COMPONENTS (from CVERS)\n`
    output += `${"-".repeat(40)}\n`
    output += `Total Components: ${info.softwareComponents.length}\n\n`

    // 可用时按组件类型分组
    const sapBasis = info.softwareComponents.find(c => c.component === "SAP_BASIS")
    if (sapBasis) {
      output += `SAP_BASIS: ${sapBasis.release} (SP ${sapBasis.extRelease || "N/A"})\n`
    }

    // 先显示关键组件
    const keyComponents = [
      "SAP_BASIS",
      "SAP_ABA",
      "SAP_GWFND",
      "SAP_UI",
      "SAP_BW",
      "S4CORE",
      "S4COREOP"
    ]
    const foundKey = info.softwareComponents.filter(c => keyComponents.includes(c.component))

    if (foundKey.length > 0) {
      output += `\nKey Components:\n`
      foundKey.forEach(comp => {
        output += `• ${comp.component}: ${comp.release} (SP ${comp.extRelease || "N/A"})\n`
      })
    }

    // 列出其余组件
    const otherComponents = info.softwareComponents.filter(
      c => !keyComponents.includes(c.component)
    )
    if (otherComponents.length > 0 && otherComponents.length <= 20) {
      output += `\nOther Components:\n`
      otherComponents.forEach(comp => {
        output += `• ${comp.component}: ${comp.release}\n`
      })
    } else if (otherComponents.length > 20) {
      output += `\n... and ${otherComponents.length} other components\n`
    }
  }
  // 不显示“无组件”消息 - 只是未请求而已

  return output
}
