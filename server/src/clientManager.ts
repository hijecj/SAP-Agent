import { ADTClient, createSSLConfig, LogData, session_types } from "abap-adt-api"
import { createConnection, ProposedFeatures } from "vscode-languageserver"
import { types } from "util"
import * as https from "https"
import { readFileSync, existsSync } from "fs"
import { readConfiguration } from "./clientapis"
import {
  ClientConfiguration,
  AuthHeadersResponse,
  CertAuthTransport,
  getAuthMethod,
  Methods,
  CommLogTogglePayload
} from "vscode-abap-remote-fs-sharedapi"
import { isString } from "./functions"
const clients: Map<string, ADTClient> = new Map()

type ServerSslConfig = ReturnType<typeof createSSLConfig> & {
  debugCallback?: (logData: LogData) => void
  httpsAgent?: https.Agent
  headers?: Record<string, string>
}

/**
 * 语言服务器进程的共享连接对象。
 */
export const connection = createConnection(ProposedFeatures.all)

/**
 * 通过语言服务器连接记录错误。
 */
export const error = (...params: unknown[]) => connection.console.error(convertParams(...params))

/**
 * 通过语言服务器连接记录警告。
 */
export const warn = (...params: unknown[]) => connection.console.warn(convertParams(...params))

/**
 * 通过语言服务器连接记录信息输出。
 */
export const info = (...params: unknown[]) => connection.console.info(convertParams(...params))

/**
 * 通过语言服务器连接记录消息。
 */
export const log = (...params: unknown[]) => connection.console.log(convertParams(...params))

/**
 * 从 ADT URI 提取连接键，让服务器可以复用同一客户端实例。
 */
export function clientKeyFromUrl(url: string) {
  const match = url.match(/adt:\/\/([^\/]*)/)
  return match && match[1]
}

function createFetchToken(conf: ClientConfiguration) {
  if (conf.oauth)
    return () => connection.sendRequest(Methods.getToken, conf.name) as Promise<string>
}

/** 从客户端扩展获取非 basic 认证方法的认证头。 */
async function fetchAuthHeaders(connName: string): Promise<AuthHeadersResponse | undefined> {
  try {
    const headers = await connection.sendRequest(Methods.getAuthHeaders, connName)
    if (headers && typeof headers === "object") {
      return headers as AuthHeadersResponse
    }
  } catch {
    // 客户端可能不支持此方法（旧版本）— 静默回退
  }
  return undefined
}

/** 客户端是否打开了通信日志面板 */
const activeConnections = new Set<string>()

/**
 * 跟踪连接是否应从服务器接收通信日志通知。
 */
export function setCommLogActive(active: CommLogTogglePayload) {
  if (active.active) activeConnections.add(active.connId)
  else activeConnections.delete(active.connId)
}

/** 构建链接 MongoDB 跟踪和通信日志转发的 debugCallback */
function buildServerDebugCallback(connId: string) {
  return (logData: LogData) =>
    activeConnections.has(connId) &&
    connection.sendNotification(Methods.commLogEntry, { logData, connId })
}

function createServerSslConfig(conf: ClientConfiguration, connId: string): ServerSslConfig {
  const sslconf: ServerSslConfig = conf.url.match(/https:/i)
    ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
    : {}
  sslconf.debugCallback = buildServerDebugCallback(connId)
  return sslconf
}

function buildCertificateAgent(
  certInfo: CertAuthTransport,
  allowSelfSigned: boolean,
  fallbackCa?: string
): https.Agent {
  const allowedExts = /\.(pem|crt|cer|key|p12|pfx)$/i
  const isPkcs12 = /\.(p12|pfx)$/i.test(certInfo.certPath || "")

  if (
    !certInfo.certPath ||
    !allowedExts.test(certInfo.certPath) ||
    !existsSync(certInfo.certPath)
  ) {
    throw new Error(`Client certificate not found or invalid extension: ${certInfo.certPath}`)
  }
  if (
    !isPkcs12 &&
    (!certInfo.keyPath || !allowedExts.test(certInfo.keyPath) || !existsSync(certInfo.keyPath))
  ) {
    throw new Error(`Private key not found or invalid extension: ${certInfo.keyPath}`)
  }

  const agentOptions: https.AgentOptions = {
    rejectUnauthorized: !allowSelfSigned,
    keepAlive: true
  }

  if (isPkcs12) {
    agentOptions.pfx = readFileSync(certInfo.certPath)
  } else {
    agentOptions.cert = readFileSync(certInfo.certPath)
    agentOptions.key = readFileSync(certInfo.keyPath)
  }

  if (certInfo.passphrase) {
    agentOptions.passphrase = certInfo.passphrase
  }

  const caSource = certInfo.caPath || fallbackCa
  if (caSource) {
    if (existsSync(caSource)) {
      agentOptions.ca = readFileSync(caSource)
    } else if (caSource.includes("-----BEGIN CERTIFICATE-----")) {
      agentOptions.ca = caSource
    } else {
      throw new Error(`CA certificate not found: ${caSource}`)
    }
  }

  return new https.Agent(agentOptions)
}

const refreshClient = async (key: string, conf: ClientConfiguration) => {
  const oldClient = clients.get(key)
  const sslconf = createServerSslConfig(conf, key)

  const authMethod = getAuthMethod(conf)
  let pwdOrFetch: string | (() => Promise<string>)

  if (authMethod !== "basic" && !conf.oauth) {
    const authResponse = await fetchAuthHeaders(conf.name)
    log(
      `[server] refreshClient: auth response received for ${key}: ${authResponse ? [authResponse.httpHeaders ? "httpHeaders" : undefined, authResponse.certAuth ? "certAuth" : undefined].filter(Boolean).join(",") : "null"}`
    )

    if (authMethod === "cert") {
      log(`[server] refreshClient: reconstructing cert agent for ${key}`)
      if (authResponse?.certAuth) {
        try {
          sslconf.httpsAgent = buildCertificateAgent(
            authResponse.certAuth,
            !!conf.allowSelfSigned,
            conf.customCA
          )
        } catch (e) {
          warn(`Failed to reconstruct cert httpsAgent for ${key}: ${e}`)
          // 不要创建损坏的客户端 — 传播错误
          throw new Error(`Certificate auth setup failed for ${key}: ${e}`)
        }
      } else {
        warn(
          `Cert auth configured for ${key} but no cert paths received — language features will fail`
        )
      }
      pwdOrFetch = "cert-auth"
    } else if (authMethod === "oauth_onprem" && authResponse?.httpHeaders?.Authorization) {
      log(`[server] refreshClient: setting up OAuth on-prem token fetcher for ${key}`)
      const currentToken = authResponse.httpHeaders.Authorization.replace(/^Bearer\s+/i, "")
      pwdOrFetch = () =>
        fetchAuthHeaders(conf.name).then(h => {
          const t = h?.httpHeaders?.Authorization?.replace(/^Bearer\s+/i, "")
          return t || currentToken
        })
    } else {
      if (authResponse?.httpHeaders) {
        sslconf.headers = { ...sslconf.headers, ...authResponse.httpHeaders }
      } else if (authMethod === "kerberos" || authMethod === "browser_sso") {
        warn(`${authMethod} auth headers missing for ${key} — user may need to reconnect`)
      }
      pwdOrFetch = `${authMethod}-auth`
    }
  } else {
    pwdOrFetch = createFetchToken(conf) || conf.password
  }

  const baseclient = new ADTClient(
    conf.url,
    conf.username,
    pwdOrFetch,
    conf.client,
    conf.language,
    sslconf
  )
  baseclient.stateful = session_types.stateful
  clients.set(key, baseclient)
  if (oldClient) {
    setTimeout(() => {
      oldClient.stateful = session_types.stateless
      oldClient.logout()
    }, 2000)
  }
}

export async function clientFromKey(key: string) {
  key = decodeURIComponent(key)
  let client = clients.get(key)
  if (!client) {
    const conf = await readConfiguration(key)
    if (conf) {
      await refreshClient(key, conf)
      // 由于客户端是有状态的，它们通常会过期，一般 10 分钟。所以我们需要每 4 分钟刷新一次
      setInterval(() => refreshClient(key, conf), 240000)
    }
  }
  return client
}

export async function clientFromUrl(url: string) {
  const key = clientKeyFromUrl(url)
  if (!key) return
  return clientFromKey(key)
}

function convertParams(...params: unknown[]) {
  let msg = ""
  for (const x of params) {
    try {
      if (types.isNativeError(x)) msg += `\nError ${x.name}\n${x.message}\n\n${x.stack}\n`
      else msg += isString(x) ? x : JSON.stringify(x)
    } catch (e) {
      msg += String(x)
    }
    msg += " "
  }
  return msg
}
