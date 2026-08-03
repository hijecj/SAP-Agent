/**
 * 本地 SAP OAuth 2.0 认证（授权码 + PKCE）
 *
 * 使用通过事务 SOAUTH2 配置的 SAP 内置 OAuth 2.0 提供器。
 * SAP 系统本身就是 OAuth 服务器 — 无需外部 IdP URL。
 *
 * 端点：
 *   授权：{sapUrl}/sap/bc/sec/oauth2/authorize
 *   Token：{sapUrl}/sap/bc/sec/oauth2/token
 *
 * 流程：
 *  1. 生成 PKCE 代码验证器 + SHA-256 挑战
 *  2. 在浏览器中打开 SAP 授权端点
 *  3. 用户认证（SAP 登录或通过 IdP 的 SSO）
 *  4. SAP 用授权码重定向到 localhost 回调
 *  5. 用代码换取访问 + 刷新 token
 *  6. Bearer token 用于所有 ADT 请求
 *  7. 过期前通过刷新 token 自动刷新
 *
 * 前置条件：
 *  - 在 SAP 系统上配置了 SOAUTH2
 *  - OAuth 客户端注册了重定向 URI：http://localhost:{port}/callback
 *  - 作用域包含 ADT 访问（通常是 "SAP_ADT"）
 */

import * as http from "http"
import * as https from "https"
import { randomBytes, createHash } from "crypto"
import * as vscode from "vscode"
import { AuthResult } from "./types"
import { OAuthOnPremConfig } from "vscode-abap-remote-fs-sharedapi"
import { PasswordVault, log } from "../lib"
import { formatKey } from "../config"
import { errorMessage } from "./utils"

const VAULT_SERVICE = "vscode.abapfs.oauth_onprem"

interface TokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number // 纪元毫秒
}

interface OAuthTokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
}

function normalizeStoredTokenSet(value: unknown): TokenSet | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const candidate = value as Partial<TokenSet>
  if (typeof candidate.accessToken !== "string" || typeof candidate.expiresAt !== "number") {
    return null
  }

  return {
    accessToken: candidate.accessToken,
    refreshToken: typeof candidate.refreshToken === "string" ? candidate.refreshToken : "",
    expiresAt: candidate.expiresAt
  }
}

function getCallbackPort(server: http.Server): number {
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("OAuth callback server did not expose a TCP port")
  }
  return address.port
}

function parseExpiresInSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 3600
}

function parseTokenSet(body: string): TokenSet {
  const data = JSON.parse(body) as OAuthTokenResponse
  if (!data.access_token || typeof data.access_token !== "string") {
    throw new Error(`Token response missing access_token: ${body.substring(0, 200)}`)
  }

  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : "",
    expiresAt: Date.now() + parseExpiresInSeconds(data.expires_in) * 1000
  }
}

/** 在操作系统凭据管理器中安全存储 token。 */
async function storeTokens(connId: string, tokens: TokenSet): Promise<void> {
  const vault = PasswordVault.get()
  await vault.setPassword(VAULT_SERVICE, formatKey(connId), JSON.stringify(tokens))
  log.debug(
    `[oauth-onprem] Stored tokens for ${connId}, expiresAt=${new Date(tokens.expiresAt).toISOString()}`
  )
}

/** 检索存储的 token。 */
async function getTokens(connId: string): Promise<TokenSet | null> {
  const vault = PasswordVault.get()
  const raw = await vault.getPassword(VAULT_SERVICE, formatKey(connId))
  if (!raw) {
    log.debug(`[oauth-onprem] No cached tokens for ${connId}`)
    return null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    const tokens = normalizeStoredTokenSet(parsed)
    if (!tokens) {
      return null
    }
    const remainingMs = tokens.expiresAt - Date.now()
    log.debug(
      `[oauth-onprem] Retrieved cached tokens for ${connId}, expires in ${Math.round(remainingMs / 1000)}s`
    )
    return tokens
  } catch (e) {
    log.debug(`[oauth-onprem] Failed to parse cached tokens for ${connId}: ${e}`)
    return null
  }
}

/** 清除存储的 token。 */
export async function clearOAuthOnPremTokens(connId: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.deletePassword(VAULT_SERVICE, formatKey(connId))
  log.debug(`[oauth-onprem] Cleared tokens for ${connId}`)
}

/**
 * 执行完整的 OAuth 授权码 + PKCE 流程。
 *
 * 在用户浏览器中打开 SAP 的授权端点，
 * 在本地 HTTP 服务器上监听重定向回调，
 * 用代码换取 token，并返回它们。
 */
async function authorizeInteractive(
  sapUrl: string,
  sapClient: string,
  config: OAuthOnPremConfig,
  skipSsl: boolean
): Promise<TokenSet> {
  // PKCE：生成代码验证器和挑战
  const codeVerifier = randomBytes(32).toString("base64url")
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
  const state = randomBytes(16).toString("hex")

  return new Promise((resolve, reject) => {
    const cspHeader = "Content-Security-Policy"
    const cspValue = "default-src 'none'"

    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith("/callback?") && req.url !== "/callback") {
        res.writeHead(404)
        res.end("Not found")
        return
      }

      const url = new URL(req.url, `http://localhost`)
      const code = url.searchParams.get("code")
      const receivedState = url.searchParams.get("state")
      const error = url.searchParams.get("error")

      if (error) {
        log.debug(
          `[oauth-onprem] SAP returned OAuth error: ${error} — ${url.searchParams.get("error_description") || ""}`
        )
        res.writeHead(200, { "Content-Type": "text/html", [cspHeader]: cspValue })
        res.end(
          "<html><body><h2>Authentication Failed</h2><p>SAP returned an error. You can close this tab.</p></body></html>"
        )
        clearTimeout(timer)
        server.close()
        reject(
          new Error(
            `OAuth error from SAP: ${error} — ${url.searchParams.get("error_description") || ""}`
          )
        )
        return
      }

      if (!code || receivedState !== state) {
        log.debug(
          `[oauth-onprem] State mismatch or missing code: receivedState=${receivedState}, expectedState=${state}, hasCode=${!!code}`
        )
        res.writeHead(400, { "Content-Type": "text/html", [cspHeader]: cspValue })
        res.end(
          "<html><body><h2>Invalid Response</h2><p>Missing authorization code or state mismatch.</p></body></html>"
        )
        clearTimeout(timer)
        server.close()
        reject(new Error("OAuth state mismatch — possible CSRF attack"))
        return
      }

      // 用代码换取 token
      try {
        const tokens = await exchangeCodeForTokens(
          sapUrl,
          sapClient,
          config,
          code,
          codeVerifier,
          getCallbackPort(server),
          skipSsl
        )
        log.debug(
          `[oauth-onprem] Token exchange successful, accessToken length=${tokens.accessToken.length}`
        )
        res.writeHead(200, { "Content-Type": "text/html", [cspHeader]: cspValue })
        res.end(
          "<html><body><h2>Authentication Successful</h2><p>You can close this tab and return to VS Code.</p></body></html>"
        )
        clearTimeout(timer)
        server.close()
        resolve(tokens)
      } catch (err) {
        const message = errorMessage(err)
        log.debug(`[oauth-onprem] Token exchange failed: ${message}`)
        res.writeHead(200, { "Content-Type": "text/html", [cspHeader]: cspValue })
        res.end(
          `<html><body><h2>Token Exchange Failed</h2><p>${escapeHtml(message)}</p></body></html>`
        )
        clearTimeout(timer)
        server.close()
        reject(err)
      }
    })

    // 在回环地址的随机端口上监听
    server.listen(0, "127.0.0.1", () => {
      const redirectUri = `http://localhost:${getCallbackPort(server)}/callback`

      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: config.scope || "SAP_ADT",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        "sap-client": sapClient
      })

      const authUrl = `${sapUrl}/sap/bc/sec/oauth2/authorize?${params.toString()}`

      // 在用户默认浏览器中打开
      vscode.env.openExternal(vscode.Uri.parse(authUrl))
      vscode.window.showInformationMessage(
        "OAuth: Complete the login in your browser. Waiting for redirect..."
      )
    })

    const timer = setTimeout(() => {
      server.close()
      reject(new Error("OAuth login timed out (120 seconds). No authorization code received."))
    }, 120_000)

    server.on("error", err => {
      clearTimeout(timer)
      reject(new Error(`OAuth callback server error: ${err.message}`))
    })
  })
}

/**
 * 用授权码换取访问 + 刷新 token。
 */
async function exchangeCodeForTokens(
  sapUrl: string,
  sapClient: string,
  config: OAuthOnPremConfig,
  code: string,
  codeVerifier: string,
  callbackPort: number,
  skipSsl: boolean
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `http://localhost:${callbackPort}/callback`,
    client_id: config.clientId,
    code_verifier: codeVerifier
  })

  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret)
  }

  const tokenUrl = `${sapUrl}/sap/bc/sec/oauth2/token?sap-client=${encodeURIComponent(sapClient)}`
  const resp = await doPost(tokenUrl, body.toString(), skipSsl)

  if (!resp.ok) {
    throw new Error(`Token exchange failed: HTTP ${resp.status} — ${resp.body.substring(0, 200)}`)
  }

  return parseTokenSet(resp.body)
}

/**
 * 用刷新 token 刷新访问 token。
 */
async function refreshTokens(
  sapUrl: string,
  sapClient: string,
  config: OAuthOnPremConfig,
  refreshToken: string,
  skipSsl: boolean
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId
  })

  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret)
  }

  const tokenUrl = `${sapUrl}/sap/bc/sec/oauth2/token?sap-client=${encodeURIComponent(sapClient)}`
  log.debug(`[oauth-onprem] Refreshing tokens at: ${tokenUrl}`)
  const resp = await doPost(tokenUrl, body.toString(), skipSsl)

  if (!resp.ok) {
    log.debug(`[oauth-onprem] Token refresh HTTP error: ${resp.status}`)
    throw new Error(`Token refresh failed: HTTP ${resp.status}`)
  }

  const tokens = parseTokenSet(resp.body)
  return {
    ...tokens,
    refreshToken: tokens.refreshToken || refreshToken
  }
}

/**
 * 为本地 OAuth 构建 AuthResult。
 *
 * 先尝试存储的 token（过期时刷新），
 * 回退到交互式浏览器登录。
 */
export async function buildOAuthOnPremAuth(
  connId: string,
  sapUrl: string,
  sapClient: string,
  config: OAuthOnPremConfig,
  skipSsl: boolean
): Promise<AuthResult> {
  log.debug(
    `[oauth-onprem] buildOAuthOnPremAuth starting for ${connId}, clientId=${config.clientId}`
  )
  // 如果未内联，从保险库解析客户端密钥
  if (!config.clientSecret) {
    const vault = PasswordVault.get()
    const secret = await vault.getPassword("vscode.abapfs.oauth_onprem_secret", formatKey(connId))
    if (secret) config = { ...config, clientSecret: secret }
  }

  let tokens = await getTokens(connId)

  if (tokens) {
    // 检查访问 token 是否过期（带 60 秒缓冲）
    if (tokens.expiresAt < Date.now() + 60_000) {
      // 尝试刷新
      if (tokens.refreshToken) {
        try {
          log.debug(`[oauth-onprem] Token expired, attempting refresh for ${connId}`)
          tokens = await refreshTokens(sapUrl, sapClient, config, tokens.refreshToken, skipSsl)
          await storeTokens(connId, tokens)
        } catch (e) {
          log.debug(
            `[oauth-onprem] Token refresh failed for ${connId}, will do interactive login: ${e}`
          )
          tokens = null
        }
      } else {
        log.debug(`[oauth-onprem] Token expired and no refresh token for ${connId}`)
        tokens = null
      }
    }
  }

  if (!tokens) {
    log.debug(`[oauth-onprem] No valid tokens, starting interactive login for ${connId}`)
    tokens = await authorizeInteractive(sapUrl, sapClient, config, skipSsl)
    await storeTokens(connId, tokens)
  }

  // 返回自动刷新的 token 获取器
  const fetchToken = createTokenFetcher(connId, sapUrl, sapClient, config, skipSsl)

  log.debug(`[oauth-onprem] buildOAuthOnPremAuth complete for ${connId}`)
  return {
    passwordOrFetcher: fetchToken
  }
}

/**
 * 创建 ADTClient 在每个请求时调用的 token 获取器函数。
 * 处理 token 接近过期时的自动刷新。
 * 使用按连接互斥锁防止并发刷新竞争。
 */
const refreshLocks = new Map<string, Promise<TokenSet>>()

function createTokenFetcher(
  connId: string,
  sapUrl: string,
  sapClient: string,
  config: OAuthOnPremConfig,
  skipSsl: boolean
): () => Promise<string> {
  return async () => {
    let tokens = await getTokens(connId)
    if (!tokens) throw new Error("OAuth tokens not available — reconnect required")

    // 过期时刷新（60 秒缓冲）
    if (tokens.expiresAt < Date.now() + 60_000 && tokens.refreshToken) {
      log.debug(`[oauth-onprem] Token near expiry in fetcher, refreshing for ${connId}`)
      // 互斥锁：每个连接同时只允许一次刷新
      let pending = refreshLocks.get(connId)
      if (!pending) {
        pending = refreshTokens(sapUrl, sapClient, config, tokens.refreshToken, skipSsl)
          .then(async newTokens => {
            await storeTokens(connId, newTokens)
            return newTokens
          })
          .finally(() => refreshLocks.delete(connId))
        refreshLocks.set(connId, pending)
      }
      try {
        tokens = await pending
      } catch (e) {
        log.debug(`[oauth-onprem] Token refresh failed in fetcher for ${connId}: ${e}`)
        throw new Error("OAuth token refresh failed — reconnect required")
      }
    }

    return tokens.accessToken
  }
}

/** 使用 Node.js 内置 https 模块的简单 HTTPS POST 辅助。拒绝非 HTTPS URL。 */
function doPost(
  url: string,
  body: string,
  skipSsl: boolean
): Promise<{ ok: boolean; status: number; body: string }> {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:") {
    return Promise.reject(
      new Error(
        "OAuth token exchange requires HTTPS. Refusing to send credentials over plaintext HTTP."
      )
    )
  }

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search || ""}`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      },
      rejectUnauthorized: !skipSsl,
      timeout: 30_000
    }

    const req = https.request(options, res => {
      let data = ""
      const maxSize = 1024 * 1024 // 1 MB 响应限制
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString("utf8")
        if (data.length > maxSize) {
          req.destroy()
          reject(new Error("OAuth token response too large (>1MB)"))
        }
      })
      res.on("end", () => {
        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          status: res.statusCode!,
          body: data
        })
      })
    })
    req.on("timeout", () => {
      req.destroy(new Error("OAuth token request timed out (30s)"))
    })
    req.on("error", reject)
    req.write(body)
    req.end()
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
