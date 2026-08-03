/**
 * Kerberos / SPNEGO 认证
 *
 * 使用操作系统原生凭证栈，通过 Kerberos/SPNEGO 认证到 SAP 系统
 * （例如 Windows 上的 SAP Secure Login Client）。
 *
 * 在 Windows 上：调用带 .NET HttpWebRequest 的 PowerShell +
 *   UseDefaultCredentials，自动使用 Windows SSPI。
 *   零原生模块依赖 — 不需要 `kerberos` npm 包。
 *
 * 流程：
 *  1. Windows 域用户拥有 Kerberos TGT（域登录或 SAP Secure Login Client）
 *  2. PowerShell 用 UseDefaultCredentials=true 向 SAP 发起 HTTP 请求
 *  3. .NET/SSPI 透明处理完整的 SPNEGO Negotiate 握手
 *  4. 我们从响应中捕获会话 cookie（MYSAPSSO2、SAP_SESSIONID_*）
 *  5. 后续 ADT 请求通过自定义头使用这些 cookie
 *
 * 前置条件：
 *  - 已加入 Windows 域且具有有效 Kerberos TGT 的机器
 *  - 为 SPNego 认证配置的 SAP ICF 服务
 */

import { execFile } from "child_process"
import { AuthResult, KerberosAuthConfig } from "./types"
import { PasswordVault, log } from "../lib"
import { formatKey } from "../config"
import { buildCookieHeaders, errorMessage, sanitizeCookie, toStringArray } from "./utils"

const VAULT_SERVICE = "vscode.abapfs.kerberos"

/** 表示认证成功的 SAP 会话 cookie 名称模式。 */
const SAP_AUTH_COOKIE_PATTERNS = [
  /^MYSAPSSO2$/i,
  /^SAP_SESSIONID_/i,
  /^sap-XCSRF/i,
  /^SAP_CLIENTID/i
]

function isAuthCookie(name: string): boolean {
  return SAP_AUTH_COOKIE_PATTERNS.some(p => p.test(name))
}

/** 安全存储捕获的会话 cookie。 */
export async function storeKerberosCookies(connId: string, cookies: string[]): Promise<void> {
  const vault = PasswordVault.get()
  await vault.setPassword(VAULT_SERVICE, formatKey(connId), JSON.stringify(cookies))
  log.debug(`[kerberos] Stored ${cookies.length} cookies for ${connId}`)
}

/** 检索存储的会话 cookie。 */
export async function getKerberosCookies(connId: string): Promise<string[]> {
  const vault = PasswordVault.get()
  const raw = await vault.getPassword(VAULT_SERVICE, formatKey(connId))
  if (!raw) {
    log.debug(`[kerberos] No cached cookies for ${connId}`)
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    const result = toStringArray(parsed)
    log.debug(`[kerberos] Retrieved ${result.length} cached cookies for ${connId}`)
    return result
  } catch (e) {
    log.debug(`[kerberos] Failed to parse cached cookies for ${connId}: ${e}`)
    return []
  }
}

/** 清除存储的会话 cookie。 */
export async function clearKerberosCookies(connId: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.deletePassword(VAULT_SERVICE, formatKey(connId))
  log.debug(`[kerberos] Cleared cached cookies for ${connId}`)
}

/**
 * 构建执行 Windows SSO 认证的 PowerShell 脚本。
 *
 * 策略（两阶段回退）：
 *  阶段 1：尝试 UseDefaultCredentials（NTLM/Kerberos/SPNEGO）
 *           适用于具有有效 Kerberos TGT 的已加入域机器。
 *  阶段 2：如果阶段 1 返回 401，扫描 Windows 证书存储
 *           （CurrentUser\My）中的客户端认证证书，并用
 *           客户端证书认证重试。
 *           适用于 SAP Secure Login Client（SLC），它会把 X.509
 *           证书安装到 Windows 证书存储中。
 *
 * 输出：JSON，包含 { method, status, cookies, authHeader, certSubject?, error? }
 */
function buildNegotiateScript(skipSsl: boolean): string {
  const lines: string[] = []
  lines.push(
    `param([string]$TargetUrl)`,
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`,
    ``,
    `function DoRequest($uri, $useDefaultCreds, $cert) {`,
    `  if ($TargetSpn) {`,
    `    [System.Net.AuthenticationManager]::CustomTargetNameDictionary[$uri.AbsoluteUri] = $TargetSpn`,
    `    [System.Net.AuthenticationManager]::CustomTargetNameDictionary[$uri.GetLeftPart([System.UriPartial]::Authority)] = $TargetSpn`,
    `  }`,
    `  $req = [System.Net.HttpWebRequest]::Create($uri)`,
    `  $req.Method = 'GET'`,
    `  $req.AllowAutoRedirect = $false`,
    `  $req.CookieContainer = New-Object System.Net.CookieContainer`
  )
  if (skipSsl) {
    lines.push(
      `  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }`
    )
  }
  lines.push(
    `  if ($useDefaultCreds) {`,
    `    $req.UseDefaultCredentials = $true`,
    `    $req.PreAuthenticate = $true`,
    `  }`,
    `  if ($cert) {`,
    `    $req.ClientCertificates.Add($cert) | Out-Null`,
    `  }`,
    `  $resp = $null`,
    `  try { $resp = $req.GetResponse() } catch [System.Net.WebException] {`,
    `    if ($_.Exception.Response) { $resp = $_.Exception.Response }`,
    `    else { throw }`,
    `  }`,
    `  $status = [int]$resp.StatusCode`,
    `  $cookies = @()`,
    `  foreach ($c in $resp.Cookies) {`,
    `    $cookies += "$($c.Name)=$($c.Value)"`,
    `  }`,
    `  $setCookieHeader = $resp.Headers['Set-Cookie']`,
    `  if ($setCookieHeader) {`,
    `    foreach ($part in $setCookieHeader -split ',(?=[^ ])') {`,
    `      $kv = ($part.Trim() -split ';')[0].Trim()`,
    `      if ($kv -match '=') {`,
    `        $name = ($kv -split '=')[0]`,
    `        $found = $false`,
    `        foreach ($existing in $cookies) { if ($existing.StartsWith("$name=")) { $found = $true } }`,
    `        if (-not $found) { $cookies += $kv }`,
    `      }`,
    `    }`,
    `  }`,
    `  $authHeader = $resp.Headers['WWW-Authenticate']`,
    `  $resp.Close()`,
    `  return @{ status = $status; cookies = $cookies; authHeader = $authHeader }`,
    `}`,
    ``,
    `try {`,
    `  $uri = [System.Uri]::new($TargetUrl)`,
    ``,
    `  # ── Phase 1: Kerberos/NTLM via UseDefaultCredentials ──`,
    `  $r1 = DoRequest $uri $true $null`,
    `  if ($r1.status -ge 200 -and $r1.status -lt 400) {`,
    `    @{ method = 'kerberos'; status = $r1.status; cookies = $r1.cookies; authHeader = $r1.authHeader } | ConvertTo-Json -Compress`,
    `    exit`,
    `  }`,
    ``,
    `  # Phase 1 failed — log it`,
    `  $phase1Status = $r1.status`,
    `  $phase1Auth = $r1.authHeader`,
    ``,
    `  # ── Phase 2: Client certificate from Windows cert store (SLC) ──`,
    `  $certs = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object {`,
    `    $_.HasPrivateKey -and`,
    `    $_.NotAfter -gt (Get-Date) -and`,
    `    ($_.EnhancedKeyUsageList.Count -eq 0 -or ($_.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq '1.3.6.1.5.5.7.3.2' }))`,
    `  } | Sort-Object NotAfter -Descending`,
    ``,
    `  $certCount = @($certs).Count`,
    `  $triedCerts = @()`,
    ``,
    `  foreach ($cert in $certs) {`,
    `    $subj = $cert.Subject`,
    `    $thumb = $cert.Thumbprint`,
    `    $triedCerts += "$subj ($thumb)"`,
    `    try {`,
    `      $r2 = DoRequest $uri $false $cert`,
    `      if ($r2.status -ge 200 -and $r2.status -lt 400) {`,
    `        @{ method = 'certificate'; status = $r2.status; cookies = $r2.cookies; authHeader = $r2.authHeader; certSubject = $subj } | ConvertTo-Json -Compress`,
    `        exit`,
    `      }`,
    `    } catch {`,
    `      # This cert didn't work, try next`,
    `    }`,
    `  }`,
    ``,
    `  # Both phases failed`,
    `  @{`,
    `    error = "All SSO methods failed"`,
    `    phase1Status = $phase1Status`,
    `    phase1Auth = $phase1Auth`,
    `    certsFound = $certCount`,
    `    certsTried = $triedCerts`,
    `  } | ConvertTo-Json -Compress`,
    `} catch {`,
    `  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress`,
    `}`
  )
  return lines.join("\n")
}

interface NegotiateResult {
  method: "kerberos" | "certificate"
  status: number
  cookies: string[]
  authHeader?: string
  certSubject?: string // 哪个证书生效（用于证书方法）
}

interface NegotiateFailureResult {
  error: string
  phase1Status?: number
  phase1Auth?: string
  certsFound?: number
  certsTried?: string[]
}

type PowerShellNegotiateResult = NegotiateResult | NegotiateFailureResult

function normalizeKerberosSpn(value: string): string {
  return value.trim()
}

function buildKerberosSpn(
  kerberosConfig: KerberosAuthConfig | undefined,
  sapBaseUrl: string
): string | undefined {
  const explicitSpn = kerberosConfig?.spn?.trim()
  if (explicitSpn) {
    return normalizeKerberosSpn(explicitSpn)
  }

  const sapHostname = kerberosConfig?.sapHostname?.trim()
  const realm = kerberosConfig?.realm?.trim().toUpperCase()
  if (!sapHostname && !realm) {
    return undefined
  }

  const baseHost = sapHostname || new URL(sapBaseUrl).hostname
  return `HTTP/${baseHost}${realm ? `@${realm}` : ""}`
}

function isNegotiateFailureResult(
  result: PowerShellNegotiateResult
): result is NegotiateFailureResult {
  return "error" in result
}

/**
 * 通过 PowerShell 执行 Windows SSO 并返回会话 cookie。
 * 超时：30 秒。
 *
 * 安全：URL 作为 PowerShell 单引号字符串字面量嵌入。
 * PowerShell 中的单引号字符串是逐字的 — 不发生变量展开
 * 或转义。唯一需要转义的字符是 '（加倍为 ''）。
 */
function runPowerShellNegotiate(
  url: string,
  skipSsl: boolean,
  targetSpn?: string
): Promise<NegotiateResult> {
  return new Promise((resolve, reject) => {
    const safeUrl = url.replace(/'/g, "''")
    const safeTargetSpn = targetSpn ? targetSpn.replace(/'/g, "''") : undefined
    const script = buildNegotiateScript(skipSsl)
    const finalScript = script.replace(
      "param([string]$TargetUrl)",
      [
        `$TargetUrl = '${safeUrl}'`,
        `$TargetSpn = ${safeTargetSpn ? `'${safeTargetSpn}'` : "$null"}`
      ].join("\n")
    )
    log.debug(
      `[sso] Launching PowerShell SSO handshake for: ${url}${targetSpn ? `, targetSpn=${targetSpn}` : ""}`
    )
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", finalScript],
      { timeout: 30_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          log.debug(`[sso] PowerShell process error: ${error.message}`)
          if (stderr) log.debug(`[sso] PowerShell stderr: ${stderr.substring(0, 500)}`)
          reject(new Error(`Windows SSO failed: ${error.message}${stderr ? `\n${stderr}` : ""}`))
          return
        }
        if (stderr) log.debug(`[sso] PowerShell stderr: ${stderr.substring(0, 300)}`)
        log.debug(`[sso] PowerShell raw output: ${stdout.substring(0, 600)}`)
        try {
          const result = JSON.parse(stdout.trim()) as PowerShellNegotiateResult
          if (isNegotiateFailureResult(result) && result.error !== "All SSO methods failed") {
            log.debug(`[sso] Script error: ${result.error}`)
            reject(new Error(`Windows SSO failed: ${result.error}`))
            return
          }
          if (isNegotiateFailureResult(result) && result.error === "All SSO methods failed") {
            // 结构化失败 — 构建描述性错误
            const p1 = `Phase 1 (Kerberos/NTLM): HTTP ${result.phase1Status}, WWW-Authenticate: ${result.phase1Auth || "absent"}`
            const p2 = `Phase 2 (Certificate): found ${result.certsFound || 0} certs in Windows store`
            const tried = (result.certsTried || []).join(", ") || "none"
            log.debug(`[sso] Both phases failed. ${p1}. ${p2}. Tried: ${tried}`)
            reject(
              new Error(
                `Windows SSO authentication failed.\n` +
                  `  ${p1}\n` +
                  `  ${p2}\n` +
                  `  Certificates tried: ${tried}\n\n` +
                  `Possible causes:\n` +
                  `  • No valid Kerberos TGT (for SPNEGO)\n` +
                  `  • SAP Secure Login Client not running or not logged in (for certificate SSO)\n` +
                  `  • Certificate not mapped to a SAP user (check CERTRULE/STRUST in SAP)\n` +
                  `  • SPNego or certificate auth not enabled on the SAP ICF service`
              )
            )
            return
          }
          if (isNegotiateFailureResult(result)) {
            reject(new Error(`Windows SSO failed: ${result.error}`))
            return
          }
          log.debug(
            `[sso] Success via ${result.method}: HTTP ${result.status}, cookies=${(result.cookies || []).length}${result.certSubject ? `, cert=${result.certSubject}` : ""}`
          )
          resolve({
            method: result.method || "unknown",
            status: result.status || 0,
            cookies: result.cookies || [],
            authHeader: result.authHeader || undefined,
            certSubject: result.certSubject || undefined
          })
        } catch (e) {
          log.debug(`[sso] Failed to parse PowerShell output: ${errorMessage(e)}`)
          reject(new Error(`Failed to parse SSO result: ${stdout.substring(0, 200)}`))
        }
      }
    )
    child.stdin?.end()
  })
}

/** 即使认证失败也会发送的 SAP 跟踪 cookie — 必须排除。 */
const SAP_TRACKING_COOKIES = [/^sap-usercontext$/i, /^sap-contextid$/i]

function isTrackingCookie(name: string): boolean {
  return SAP_TRACKING_COOKIES.some(p => p.test(name))
}

/**
 * 对 SAP 执行 Windows SSO 认证并捕获会话 cookie。
 * 先尝试 Kerberos/NTLM，然后回退到 Windows 证书存储（SLC）。
 */
async function negotiateWithSap(
  kerberosConfig: KerberosAuthConfig | undefined,
  sapBaseUrl: string,
  sapClient: string,
  skipSsl: boolean
): Promise<string[]> {
  if (process.platform !== "win32") {
    throw new Error(
      "Kerberos/SPNEGO authentication is currently supported on Windows only. " +
        "Your machine must be domain-joined with a valid Kerberos TGT, or have SAP Secure Login Client running."
    )
  }

  if (!/^https?:\/\//i.test(sapBaseUrl)) {
    throw new Error("Windows SSO requires an HTTP(S) URL")
  }

  const url = `${sapBaseUrl}/sap/bc/adt/discovery?sap-client=${encodeURIComponent(sapClient)}`
  const targetSpn = buildKerberosSpn(kerberosConfig, sapBaseUrl)
  log.debug(
    `[sso] Starting Windows SSO negotiation with: ${url}${targetSpn ? `, targetSpn=${targetSpn}` : ""}`
  )
  const result = await runPowerShellNegotiate(url, skipSsl, targetSpn)

  // 过滤掉 SAP 跟踪 cookie（sap-usercontext 等）— 这些会在所有
  // 响应（包括 401 失败）中发送，不表示认证成功。
  const allCookies = result.cookies.map(cookie => sanitizeCookie(cookie))
  const sessionCookies = allCookies.filter(c => !isTrackingCookie(c.split("=")[0]))

  log.debug(
    `[sso] Cookies: total=${allCookies.length}, session=${sessionCookies.length} (${sessionCookies.map(c => c.split("=")[0]).join(",")})`
  )

  if (sessionCookies.length === 0) {
    // runPowerShellNegotiate 在认证失败时已抛出异常，但以防万一仍加防护
    throw new Error(
      `SSO handshake returned HTTP ${result.status} but no session cookies. ` +
        `Tracking cookies were filtered. Raw cookies: ${allCookies.map(c => c.split("=")[0]).join(", ")}`
    )
  }

  if (result.method === "certificate") {
    log.debug(`[sso] Authenticated via SLC certificate: ${result.certSubject}`)
  } else {
    log.debug(`[sso] Authenticated via Kerberos/NTLM`)
  }

  return sessionCookies
}

/**
 * 为 Kerberos/SPNEGO/SLC 认证构建 AuthResult。
 *
 * 执行 SSO 握手、捕获 cookie、安全存储它们，
 * 并返回在每个请求中注入这些 cookie 的 AuthResult。
 */
export async function buildKerberosAuth(
  connId: string,
  kerberosConfig: KerberosAuthConfig | undefined,
  sapBaseUrl: string,
  sapClient: string,
  skipSsl: boolean
): Promise<AuthResult> {
  log.debug(`[sso] buildKerberosAuth starting for ${connId}`)
  const cookies = await negotiateWithSap(kerberosConfig, sapBaseUrl, sapClient, skipSsl)
  await storeKerberosCookies(connId, cookies)

  const headers = buildCookieHeaders(cookies)

  log.debug(`[sso] buildKerberosAuth complete for ${connId}: ${cookies.length} cookies`)
  return {
    passwordOrFetcher: "kerberos-sso",
    ...(headers ? { headers } : {})
  }
}

/**
 * 重新认证（清除缓存 cookie 并重做 SSO 握手）。
 */
export async function refreshKerberosAuth(
  connId: string,
  kerberosConfig: KerberosAuthConfig | undefined,
  sapBaseUrl: string,
  sapClient: string,
  skipSsl: boolean
): Promise<AuthResult> {
  log.debug(`[sso] refreshKerberosAuth starting for ${connId}`)
  await clearKerberosCookies(connId)
  const cookies = await negotiateWithSap(kerberosConfig, sapBaseUrl, sapClient, skipSsl)
  await storeKerberosCookies(connId, cookies)

  const headers = buildCookieHeaders(cookies)

  log.debug(`[sso] refreshKerberosAuth complete for ${connId}: ${cookies.length} cookies`)
  return {
    passwordOrFetcher: "kerberos-sso",
    ...(headers ? { headers } : {})
  }
}
