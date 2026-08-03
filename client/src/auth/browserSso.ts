/**
 * 浏览器 SSO 认证
 *
 * 用于使用 SAML 2.0 或 Kerberos SSO 且无法直接协议集成的 SAP 系统。
 * 在浏览器中打开本地辅助页面，让用户在单独标签页中
 * 对 SAP 系统进行认证，然后通过本地 HTTP 回调服务器
 * 捕获粘贴的会话 cookie。
 *
 * 流程：
 *  1. 扩展在随机端口启动本地 HTTP 服务器
 *  2. 在用户默认浏览器中打开本地辅助页面
 *  3. 用户从辅助页面打开 SAP 系统并通过 IdP 认证
 *  4. 用户把结果 cookie 粘贴到辅助页面，它把 cookie POST
 *     回 localhost 回调
 *  5. 扩展捕获 MYSAPSSO2 / SAP_SESSIONID cookie
 *  6. 后续 ADT 请求使用这些 cookie
 *
 * Cookie 存储：PasswordVault（操作系统凭据存储）
 */

import * as http from "http"
import { randomBytes } from "crypto"
import open from "open"
import { AuthResult } from "./types"
import { PasswordVault, log } from "../lib"
import { formatKey } from "../config"
import * as vscode from "vscode"
import { buildCookieHeaders, sanitizeCookie, toStringArray } from "./utils"

const VAULT_SERVICE = "vscode.abapfs.browsersso"

const SSO_COOKIE_TTL_MS = 30 * 60 * 1000 // 30 分钟 — SAP 会话 cookie 通常在 30-60 分钟内过期
const VAULT_TS_SERVICE = "vscode.abapfs.browsersso.ts"
const captureLocks = new Map<string, Promise<string[]>>()

interface CookieCaptureRequest {
  cookies?: string
}

function getListeningPort(server: http.Server): number {
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Cookie capture server did not expose a TCP port")
  }
  return address.port
}

function captureCookiesOnce(connId: string, loginUrl: string): Promise<string[]> {
  let pending = captureLocks.get(connId)
  if (!pending) {
    pending = startCookieCaptureServer(loginUrl, 120_000, vscodeSsoNotify)
      .then(async cookies => {
        await storeSsoCookies(connId, cookies)
        return cookies
      })
      .finally(() => captureLocks.delete(connId))
    captureLocks.set(connId, pending)
  }
  return pending
}

/** 安全存储 SSO cookie（带时间戳）。 */
export async function storeSsoCookies(connId: string, cookies: string[]): Promise<void> {
  const vault = PasswordVault.get()
  await vault.setPassword(VAULT_SERVICE, formatKey(connId), JSON.stringify(cookies))
  await vault.setPassword(VAULT_TS_SERVICE, formatKey(connId), String(Date.now()))
  log.debug(`[browser-sso] Stored ${cookies.length} cookies for ${connId}`)
}

/** 检索存储的 SSO cookie（过期时返回空）。 */
export async function getSsoCookies(connId: string): Promise<string[]> {
  const vault = PasswordVault.get()
  const raw = await vault.getPassword(VAULT_SERVICE, formatKey(connId))
  if (!raw) {
    log.debug(`[browser-sso] No cached cookies for ${connId}`)
    return []
  }
  // 检查时间戳 — TTL 之后视为过期
  const tsRaw = await vault.getPassword(VAULT_TS_SERVICE, formatKey(connId))
  if (tsRaw) {
    const storedAt = parseInt(tsRaw, 10)
    const ageMs = Date.now() - storedAt
    if (ageMs > SSO_COOKIE_TTL_MS) {
      log.debug(
        `[browser-sso] Cookies expired for ${connId} (age=${Math.round(ageMs / 1000)}s, ttl=${SSO_COOKIE_TTL_MS / 1000}s)`
      )
      await clearSsoCookies(connId)
      return []
    }
  }
  try {
    const parsed = JSON.parse(raw)
    const result = toStringArray(parsed)
    log.debug(`[browser-sso] Retrieved ${result.length} cached cookies for ${connId}`)
    return result
  } catch (e) {
    log.debug(`[browser-sso] Failed to parse cached cookies for ${connId}: ${e}`)
    return []
  }
}

/** 清除存储的 SSO cookie。 */
export async function clearSsoCookies(connId: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.deletePassword(VAULT_SERVICE, formatKey(connId))
  await vault.deletePassword(VAULT_TS_SERVICE, formatKey(connId))
  log.debug(`[browser-sso] Cleared cached cookies for ${connId}`)
}

/**
 * 启动提供辅助页面并接收浏览器 POST 回来的 cookie 的临时本地 HTTP 服务器。
 * 返回捕获的 cookie。
 *
 * 安全说明：
 *  - 只绑定 127.0.0.1 回环地址（网络不可访问）
 *  - 在 URL 中使用随机一次性 token，防止其他浏览器标签页的
 *    跨源请求注入伪造 cookie
 *  - 无 CORS 头 — 辅助页面从同一源提供，
 *    因此跨源限制自然生效
 *
 * @param sapUrl     要在浏览器中为 SSO 打开的 SAP URL
 * @param timeoutMs  最大等待时间（默认 120 秒）
 * @param notifyUser 浏览器启动失败时向用户显示辅助 URL 的可选回调
 */
export function startCookieCaptureServer(
  sapUrl: string,
  timeoutMs = 120_000,
  notifyUser?: (helperUrl: string) => void
): Promise<string[]> {
  // 必须出现在 POST 中的随机 token，防止跨源 cookie 注入
  const token = randomBytes(24).toString("hex")

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // 只在 token URL 提供辅助页面
      if (req.method === "GET" && req.url === `/${token}`) {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(getHelperPageHtml(sapUrl, token))
        return
      }

      if (req.method === "POST" && req.url === `/${token}/cookies`) {
        let body = ""
        let rejected = false
        req.on("data", (chunk: Buffer) => {
          const chunkText = chunk.toString("utf8")
          // 追加前检查，可靠地执行限制
          if (rejected || body.length + chunkText.length > 8192) {
            if (!rejected) {
              rejected = true
              res.writeHead(413)
              res.end("Payload too large")
              req.destroy()
            }
            return
          }
          body += chunkText
        })
        req.on("end", () => {
          if (rejected) return
          try {
            const data = JSON.parse(body) as CookieCaptureRequest
            // 清理 cookie：剥离 CR/LF 以防止 HTTP 头注入
            const cookieString = typeof data.cookies === "string" ? data.cookies : ""
            const cookies = cookieString
              .split(";")
              .map(cookie => sanitizeCookie(cookie))
              .filter(cookie => cookie.includes("=") && cookie.length <= 4096)

            if (cookies.length === 0) {
              log.debug(`[browser-sso] POST received but no cookies extracted`)
              res.writeHead(200, { "Content-Type": "application/json" })
              res.end(
                JSON.stringify({ message: "No cookies received. Make sure you are logged in." })
              )
              return
            }

            log.debug(
              `[browser-sso] Captured ${cookies.length} cookies: ${cookies.map(c => c.split("=")[0]).join(",")}`
            )
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(
              JSON.stringify({
                message: `Captured ${cookies.length} cookies. You can close this tab.`
              })
            )

            clearTimeout(timer)
            server.close()
            resolve(cookies)
          } catch (e) {
            log.debug(`[browser-sso] Failed to parse POST body: ${e}`)
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ message: "Invalid request" }))
          }
        })
        return
      }

      res.writeHead(404)
      res.end("Not found")
    })

    // 只在回环地址的随机可用端口上监听
    server.listen(0, "127.0.0.1", () => {
      const helperUrl = `http://127.0.0.1:${getListeningPort(server)}/${token}`

      // 在用户默认浏览器中打开；只在回退时显示通知
      open(helperUrl)
        .then(() => {
          log.debug(`[browser-sso] Browser opened successfully for: ${helperUrl}`)
        })
        .catch(err => {
          log.debug(`[browser-sso] Failed to open browser (${err}), showing notification fallback`)
          if (notifyUser) notifyUser(helperUrl)
        })
    })

    const timer = setTimeout(() => {
      server.close()
      reject(new Error("Browser SSO timed out. No cookies received within the time limit."))
    }, timeoutMs)

    server.on("error", err => {
      clearTimeout(timer)
      reject(new Error(`Cookie capture server error: ${err.message}`))
    })
  })
}

/** 浏览器 SSO 的默认 VS Code 通知回调。 */
function vscodeSsoNotify(helperUrl: string) {
  vscode.window
    .showInformationMessage(
      "Browser SSO: Complete login in the browser window, then paste cookies into the helper page.",
      "Open Browser Page"
    )
    .then((choice: string | undefined) => {
      if (choice === "Open Browser Page") {
        vscode.env.openExternal(vscode.Uri.parse(helperUrl))
      }
    })
}

/**
 * 使用存储或新捕获的 SSO cookie 构建 AuthResult。
 */
export async function buildBrowserSsoAuth(
  connId: string,
  sapUrl: string,
  sapClient: string
): Promise<AuthResult> {
  log.debug(`[browser-sso] buildBrowserSsoAuth starting for ${connId}`)
  let cookies = await getSsoCookies(connId)
  if (cookies.length === 0) {
    log.debug(`[browser-sso] No cached cookies, starting cookie capture for ${connId}`)
    const loginUrl = `${sapUrl}/sap/bc/adt/discovery?sap-client=${encodeURIComponent(sapClient)}`
    cookies = await captureCookiesOnce(connId, loginUrl)
  }

  const headers = buildCookieHeaders(cookies)

  log.debug(`[browser-sso] buildBrowserSsoAuth complete for ${connId}: ${cookies.length} cookies`)
  return {
    passwordOrFetcher: "browser-sso",
    ...(headers ? { headers } : {})
  }
}

/**
 * 重新认证浏览器 SSO（清除 cookie 并重新捕获）。
 */
export async function refreshBrowserSsoAuth(
  connId: string,
  sapUrl: string,
  sapClient: string
): Promise<AuthResult> {
  log.debug(`[browser-sso] refreshBrowserSsoAuth starting for ${connId}`)
  await clearSsoCookies(connId)
  captureLocks.delete(connId)
  const loginUrl = `${sapUrl}/sap/bc/adt/discovery?sap-client=${encodeURIComponent(sapClient)}`
  const cookies = await captureCookiesOnce(connId, loginUrl)

  const headers = buildCookieHeaders(cookies)

  log.debug(`[browser-sso] refreshBrowserSsoAuth complete for ${connId}: ${cookies.length} cookies`)
  return {
    passwordOrFetcher: "browser-sso",
    ...(headers ? { headers } : {})
  }
}

/** 生成用于 cookie 捕获的辅助 HTML 页面。 */
function getHelperPageHtml(sapUrl: string, token: string): string {
  // 嵌入前校验 URL 协议 — 拒绝 javascript: 或 data: URI
  if (!/^https?:\/\//i.test(sapUrl)) {
    sapUrl = "about:blank" // 安全回退；正常操作中不应到达这里
  }
  // 转义 SAP URL 以安全嵌入 HTML
  const escapedUrl = sapUrl
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline';">
  <title>ABAP FS — Browser SSO Login</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           max-width: 600px; margin: 60px auto; padding: 20px; color: #333; }
    h1 { font-size: 20px; margin-bottom: 12px; }
    .step { margin: 16px 0; padding: 12px; background: #f5f5f5; border-radius: 6px; }
    .step b { color: #0066cc; }
    textarea { width: 100%; height: 80px; margin: 8px 0; font-family: monospace; font-size: 12px; }
    button { padding: 10px 20px; background: #0066cc; color: #fff; border: none;
             border-radius: 4px; font-size: 14px; cursor: pointer; }
    button:hover { background: #0052a3; }
    .success { color: #28a745; font-weight: bold; display: none; }
    .error { color: #dc3545; display: none; }
  </style>
</head>
<body>
  <h1>ABAP FS — Browser SSO Login</h1>
  <div class="step">
    <b>Step 1:</b> <a href="${escapedUrl}" target="_blank" rel="noopener">Click here to open your SAP system</a>
    and complete the SSO login in the popup window.
  </div>
  <div class="step">
    <b>Step 2:</b> After you are logged in, open browser DevTools (F12) → Application → Cookies,
    and copy all cookies for the SAP domain. Paste them below:
    <textarea id="cookieInput" placeholder="Paste cookies here (name=value; name2=value2; ...)"></textarea>
    <button onclick="submitCookies()">Submit Cookies</button>
  </div>
  <p class="success" id="success"></p>
  <p class="error" id="error"></p>
  <script>
    function submitCookies() {
      var cookies = document.getElementById('cookieInput').value.trim();
      if (!cookies) { document.getElementById('error').textContent = 'Please paste cookies first.'; document.getElementById('error').style.display = 'block'; return; }
      fetch('/${token}/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookies })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        document.getElementById('success').textContent = d.message;
        document.getElementById('success').style.display = 'block';
        document.getElementById('error').style.display = 'none';
      })
      .catch(function(e) {
        document.getElementById('error').textContent = 'Error: ' + e;
        document.getElementById('error').style.display = 'block';
      });
    }
  </script>
</body>
</html>`
}
