import { ADTClient, AdtLock, TextElement, TextElementsResult } from "abap-adt-api"
import { log } from "../lib"
import { selectTransport } from "./AdtTransports"

export type { TextElement, TextElementsResult }

export interface LockResult {
  lockHandle: string
  corrUserId?: string
  corrUser?: string
  isLocal?: boolean
  modificationSupport?: boolean
  transportInfo?: {
    corrNr?: string
    corrText?: string
  }
}

/** 把 AdtLock 映射到本模块使用的 LockResult 形状。 */
function adtLockToLockResult(lock: AdtLock): LockResult {
  const corrNr = lock.CORRNR?.toString()
  const corrText = lock.CORRTEXT?.toString()
  return {
    lockHandle: lock.LOCK_HANDLE,
    corrUserId: lock.CORRUSER?.toString(),
    corrUser: lock.CORRUSER?.toString(),
    isLocal: lock.IS_LOCAL === "X",
    modificationSupport: lock.MODIFICATION_SUPPORT === "X",
    transportInfo: corrNr ? { corrNr, corrText } : undefined
  }
}

/**
 * 文本元素的对象类型检测和 URL 工具
 */

export enum ObjectType {
  PROGRAM = "PROGRAM",
  CLASS = "CLASS",
  FUNCTION_GROUP = "FUNCTION_GROUP",
  FUNCTION_MODULE = "FUNCTION_MODULE"
}

export interface ObjectInfo {
  name: string
  type: ObjectType
  cleanName: string // 不带扩展名的名称
}

/**
 * 解析对象名并确定类型
 * 自动处理命名空间对象的 URL 编码
 * 同时处理常规正斜杠（/）和除法斜杠（∕）字符
 */
export function parseObjectName(objectName: string, explicitType?: string): ObjectInfo {
  // 清理对象名 - 处理 URL 编码和文件扩展名
  let cleanName = objectName

  // 如果包含 URL 编码字符则 URL 解码（用于命名空间对象）
  if (cleanName.includes("%")) {
    try {
      cleanName = decodeURIComponent(cleanName)
    } catch (error) {
      log(`[TextElements] Failed to URL decode '${objectName}': ${error}`)
      // 解码失败时继续使用原始名称
    }
  }

  // 把除法斜杠（∕）规范化为正斜杠（/）以保持一致处理
  if (cleanName.includes("∕")) {
    const originalName = cleanName
    cleanName = cleanName.replace(/∕/g, "/")
  }

  // 提供显式类型时始终使用它（Copilot 知道对象类型）
  if (explicitType) {
    const type = explicitType.toUpperCase()
    if (type === "CLASS" || type.includes("CLAS")) {
      const finalCleanName = cleanName.replace(/\.clas\.abap$/i, "")
      return { name: objectName, type: ObjectType.CLASS, cleanName: finalCleanName }
    } else if (type === "FUNCTION_GROUP" || type.includes("FUGR") || type.includes("FUNCTION")) {
      const finalCleanName = cleanName.replace(/\.fugr\.abap$/i, "")
      return { name: objectName, type: ObjectType.FUNCTION_GROUP, cleanName: finalCleanName }
    } else {
      const finalCleanName = cleanName.replace(/\.prog\.abap$/i, "")
      return { name: objectName, type: ObjectType.PROGRAM, cleanName: finalCleanName }
    }
  }

  // 回退：只从文件扩展名检测（不做基于名称的猜测）
  const name = cleanName.toLowerCase()
  if (name.endsWith(".clas.abap")) {
    const finalCleanName = name.replace(".clas.abap", "")
    return { name: objectName, type: ObjectType.CLASS, cleanName: finalCleanName }
  } else if (name.endsWith(".fugr.abap")) {
    const finalCleanName = name.replace(".fugr.abap", "")
    return { name: objectName, type: ObjectType.FUNCTION_GROUP, cleanName: finalCleanName }
  } else if (name.endsWith(".func.abap")) {
    // 函数模块（单个函数，不是函数组）
    const finalCleanName = name.replace(".func.abap", "")
    return { name: objectName, type: ObjectType.FUNCTION_MODULE, cleanName: finalCleanName }
  } else if (name.endsWith(".prog.abap")) {
    const finalCleanName = name.replace(".prog.abap", "")
    return { name: objectName, type: ObjectType.PROGRAM, cleanName: finalCleanName }
  } else {
    // 对普通名称默认为程序（不做智能猜测）
    return { name: objectName, type: ObjectType.PROGRAM, cleanName: cleanName }
  }
}

/**
 * 确定与 ObjectInfo 的 apiTextElementsUrl 一起使用的 ADT 类型前缀。
 */
function objectInfoToAdtType(type: ObjectType): string {
  switch (type) {
    case ObjectType.CLASS:
      return "CLAS"
    case ObjectType.FUNCTION_GROUP:
      return "FUGR"
    default:
      return "PROG"
  }
}

/**
 * 使用 abap-adt-api 辅助基于对象信息获取文本元素基础 URL。
 */
export function getTextElementsUrlFromObjectInfo(objectInfo: ObjectInfo): string {
  return ADTClient.textElementsUrl(objectInfoToAdtType(objectInfo.type), objectInfo.cleanName)
}

/**
 * 基于对象信息获取锁定 URL（与文本元素基础 URL 相同）。
 */
export function getTextElementsLockUrlFromObjectInfo(objectInfo: ObjectInfo): string {
  return getTextElementsUrlFromObjectInfo(objectInfo)
}

/**
 * 基于对象信息获取传输对象路径。
 */
export function getTransportObjectPathFromObjectInfo(objectInfo: ObjectInfo): string {
  return getTextElementsUrlFromObjectInfo(objectInfo)
}

/**
 * 基于对象名/类型确定文本元素基础 URL。
 */
function getTextElementsBaseUrl(objectName: string, objectType?: string): string {
  const objectInfo = parseObjectName(objectName, objectType)
  return getTextElementsUrlFromObjectInfo(objectInfo)
}

/**
 * 使用 ADT 客户端获取 ABAP 对象的文本元素。
 */
export async function getTextElements(
  connection: ADTClient,
  objectName: string,
  objectType?: string
): Promise<TextElementsResult> {
  const url = getTextElementsBaseUrl(objectName, objectType)
  try {
    return await connection.getTextElements(url, "symbols")
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { textElements: [], programName: objectName.toUpperCase() }
    }
    throw new Error(`Failed to get text elements for ${objectName}: ${error.message}`)
  }
}

/**
 * 通过标准 ADT 锁定 API 锁定文本元素以进行修改。
 */
export async function lockTextElements(
  connection: ADTClient,
  objectName: string,
  objectType?: string
): Promise<LockResult> {
  const url = getTextElementsBaseUrl(objectName, objectType)
  try {
    const lock = await connection.lock(url, "MODIFY")
    return adtLockToLockResult(lock)
  } catch (error: any) {
    throw new Error(`Failed to lock text elements for ${objectName}: ${error.message}`)
  }
}

/**
 * 设置 ABAP 对象的文本元素。
 * 通过 ADT 客户端写入元素，然后解锁并激活。
 */
export async function setTextElements(
  connection: ADTClient,
  objectName: string,
  textElements: TextElement[],
  lockHandle: string,
  corrNr?: string,
  objectType?: string
): Promise<void> {
  const url = getTextElementsBaseUrl(objectName, objectType)
  try {
    await connection.setTextElements(url, "symbols", textElements, lockHandle, corrNr)
    await connection.unLock(url, lockHandle).catch(() => undefined)
    await connection.activate(objectName.toUpperCase(), url)
  } catch (error: any) {
    throw new Error(`Failed to set text elements for ${objectName}: ${error.message}`)
  }
}

/**
 * 对象名的简单校验
 */
function validateObjectName(objectName: string): void {
  if (!objectName || typeof objectName !== "string" || objectName.trim().length === 0) {
    throw new Error("Object name is required and must be a non-empty string")
  }
}

/**
 * 校验文本元素数组
 */
function validateTextElements(textElements: TextElement[]): void {
  if (!Array.isArray(textElements)) {
    throw new Error("Text elements must be an array")
  }

  if (textElements.length === 0) {
    throw new Error("At least one text element is required")
  }

  const usedIds = new Set<string>()

  for (const element of textElements) {
    if (!element.id || typeof element.id !== "string") {
      throw new Error("Each text element must have a valid id")
    }

    if (!element.text || typeof element.text !== "string") {
      throw new Error("Each text element must have valid text")
    }

    const id = element.id.toUpperCase()

    if (usedIds.has(id)) {
      throw new Error(`Duplicate text element ID: ${id}`)
    }
    usedIds.add(id)

    // 未提供或无效时自动计算 maxLength
    if (element.maxLength === undefined || element.maxLength === null || isNaN(element.maxLength)) {
      element.maxLength = Math.max(element.text.length, 10) // 至少 10，或文本长度
    }

    if (typeof element.maxLength !== "number" || element.maxLength < 1 || element.maxLength > 255) {
      throw new Error(`Invalid maxLength for element ${id}: must be between 1 and 255`)
    }

    if (element.text.length > element.maxLength) {
      throw new Error(
        `Text length exceeds maxLength for element ${id}: ${element.text.length} > ${element.maxLength}`
      )
    }
  }
}

/**
 * 带校验获取文本元素的安全包装器
 */
export async function getTextElementsSafe(
  connection: ADTClient,
  objectName: string,
  objectType?: string
): Promise<TextElementsResult> {
  validateObjectName(objectName)
  return getTextElements(connection, objectName, objectType)
}

export async function updateTextElementsWithTransport(
  connection: ADTClient,
  objectName: string,
  textElements: TextElement[],
  objectType?: string // 可选 - 只从 Copilot 调用时需要
): Promise<void> {
  validateObjectName(objectName)
  validateTextElements(textElements)

  let lockResult: LockResult | undefined

  try {
    lockResult = await lockTextElements(connection, objectName, objectType)

    let transportToUse: string | undefined

    if (lockResult.transportInfo?.corrNr) {
      transportToUse = lockResult.transportInfo.corrNr
    } else if (!lockResult.isLocal) {
      const objContentPath = getTextElementsBaseUrl(objectName, objectType)
      const transportSelection = await selectTransport(
        objContentPath,
        "",
        connection,
        false,
        "",
        ""
      )

      if (transportSelection.cancelled) {
        throw new Error("Transport selection was cancelled. Text elements update aborted.")
      }

      transportToUse = transportSelection.transport
    }

    await setTextElements(
      connection,
      objectName,
      textElements,
      lockResult.lockHandle,
      transportToUse,
      objectType
    )
  } catch (error) {
    if (lockResult) {
      await connection
        .unLock(getTextElementsBaseUrl(objectName, objectType), lockResult.lockHandle)
        .catch(() => undefined)
    }
    throw error
  }
}
