import { RemoteManager, createClient, createAuthenticatedClient } from "../config"
import { AFsService, Root } from "abapfs"
import { Uri, FileSystemError, workspace } from "vscode"
import { ADTClient } from "abap-adt-api"
import { LogOutPendingDebuggers } from "./debugger"
import { SapSystemValidator } from "../services/sapSystemValidator"
import { LocalFsProvider } from "../fs/LocalFsProvider"
import { log } from "../lib"
export const ADTSCHEME = "adt"
export const ADTURIPATTERN = /\/sap\/bc\/adt\//

const roots = new Map<string, Root>()
const clients = new Map<string, ADTClient>()
const creations = new Map<string, Promise<void>>()

const missing = (connId: string) => {
  return FileSystemError.FileNotFound(`No ABAP server defined for ${connId}`)
}

export const abapUri = (u?: Uri) => u?.scheme === ADTSCHEME && !LocalFsProvider.useLocalStorage(u)

async function create(connId: string) {
  const manager = RemoteManager.get()
  const connection = await manager.byIdAsync(connId)
  if (!connection) throw Error(`Connection not found ${connId}`)

  // 🔐 创建客户端前校验系统访问
  log(`🔍 Validating SAP system access for connection: ${connId}`)
  const validator = SapSystemValidator.getInstance()
  await validator.validateSystemAccess(
    connection.url,
    connection.sapGui?.server,
    connection.username
  )
  log(`✅ SAP system validation passed for: ${connId}`)

  const authMethod = (connection as any).authMethod || "basic"
  const validAuthMethods = ["basic", "cert", "kerberos", "browser_sso", "oauth_onprem"]
  if (!validAuthMethods.includes(authMethod)) {
    log(`⚠️ Unknown authMethod '${authMethod}' for ${connId} — falling back to basic auth`)
  }
  log.debug(
    `[connect] Creating client for ${connId}: authMethod=${authMethod}, hasOAuth=${!!connection.oauth}, hasPassword=${!!connection.password}`
  )
  let client: ADTClient

  if (authMethod !== "basic" && validAuthMethods.includes(authMethod)) {
    log.debug(`[connect] Using createAuthenticatedClient for ${connId} (${authMethod})`)
    client = await createAuthenticatedClient(connection)
    await client.login()
    log.debug(`[connect] client.login() succeeded for ${connId}`)
    await client.statelessClone.login()
    log.debug(`[connect] statelessClone.login() succeeded for ${connId}`)
  } else if (connection.oauth || connection.password) {
    client = createClient(connection)
    await client.login() // 登录问题会抛出异常
    await client.statelessClone.login()
  } else {
    const password = (await manager.askPassword(connection.name)) || ""
    if (!password) throw Error("Can't connect without a password")
    client = await createClient({ ...connection, password })
    await client.login() // 登录问题会抛出异常
    await client.statelessClone.login()
    connection.password = password
    const { name, username } = connection
    await manager.savePassword(name, username, password)
  }

  // @ts-ignore
  const service = new AFsService(client)
  const newRoot = new Root(connId, service)
  roots.set(connId, newRoot)
  clients.set(connId, client)
}

// 跟踪因不可重试错误而失败的连接（例如 SSO 超时、认证被拒）
// 防止 VS Code 文件系统触发无限重试循环
const failedConnections = new Map<string, string>() // connId → 错误消息

function createIfMissing(connId: string) {
  if (roots.get(connId)) return
  // 如果连接之前因不可重试错误失败，不再重试
  const failReason = failedConnections.get(connId)
  if (failReason) {
    return Promise.reject(new Error(failReason))
  }
  let creation = creations.get(connId)
  if (!creation) {
    creation = create(connId).catch(err => {
      // 如果是交互式/认证错误，标记为永久失败
      // 这样 VS Code 文件系统不会持续触发重试循环
      const msg = String(err?.message || err)
      if (
        msg.includes("timed out") ||
        msg.includes("SSO") ||
        msg.includes("authentication") ||
        msg.includes("OAuth") ||
        msg.includes("401") ||
        msg.includes("403") ||
        msg.includes("cancelled") ||
        msg.includes("Can't connect without a password")
      ) {
        log.debug(`[connect] Marking ${connId} as failed (no auto-retry): ${msg.substring(0, 100)}`)
        failedConnections.set(
          connId,
          `Connection failed: ${msg}. Disconnect and reconnect to retry.`
        )
      }
      throw err
    })
    creations.set(connId, creation)
    creation.finally(() => creations.delete(connId))
  }
  return creation
}

/** 清除连接的失败状态（断开/重连时调用）。 */
export function clearConnectionFailure(connId: string) {
  failedConnections.delete(connId)
}

export async function getOrCreateClient(connId: string, clone = true) {
  if (!clients.has(connId)) {
    try {
      await createIfMissing(connId)
    } catch (error) {
      // 重新抛出带原始消息的校验错误，而不是泛化的 "missing" 错误
      throw error // 保留原始的校验错误消息
    }
  }
  return getClient(connId, clone)
}

export function getClient(connId: string, clone = true) {
  const client = clients.get(connId)
  if (client) return clone ? client.statelessClone : client

  // 如果客户端不存在，说明校验失败或连接从未建立
  // 提供更有帮助的反馈，而不是泛化的 "missing" 错误
  throw new Error(
    `SAP system '${connId}' is not accessible. This may be due to whitelist restrictions or connection issues. Check the extension logs for validation details.`
  )
}

export const getRoot = (connId: string) => {
  const root = roots.get(connId)
  if (root) return root
  throw missing(connId)
}

export const uriRoot = (uri: Uri) => {
  if (abapUri(uri)) return getRoot(uri.authority)
  throw missing(uri.toString())
}

export const getOrCreateRoot = async (connId: string) => {
  if (!roots.has(connId)) await createIfMissing(connId)
  return getRoot(connId)
}

export function hasLocks() {
  for (const root of roots.values()) if (root.lockManager.lockedPaths().next().value) return true
}
export async function disconnect() {
  const connected = [...clients.values()]
  const main = connected.map(c => c.logout())
  const clones = connected
    .map(c => c.statelessClone)
    .filter(c => c.loggedin)
    .map(c => c.logout())
  await Promise.all([...main, ...clones, ...LogOutPendingDebuggers()])
  // 清除所有失败状态，以便可以重新连接
  failedConnections.clear()
  return
}

export const rootIsConnected = (connId: string) =>
  !!workspace.workspaceFolders?.find(
    f => f.uri.scheme === ADTSCHEME && f.uri.authority === connId?.toLowerCase()
  )
