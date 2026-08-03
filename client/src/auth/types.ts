/**
 * SAP 系统连接的认证类型和接口。
 *
 * 支持的方法：
 *  - basic：用户名 + 密码（默认）
 *  - cert：X.509 客户端证书（双向 TLS）
 *  - kerberos：通过 Windows SSPI 的 Kerberos/SPNEGO
 *  - browser_sso：交互式浏览器登录 → cookie 捕获
 *
 * OAuth（Cloud Foundry）通过现有的 oauth/ 模块单独处理。
 *
 * AuthMethod、CertAuthConfig、KerberosAuthConfig 在 sharedapi 中定义，
 * 这样语言服务器也可以引用它们。
 */

import type { Agent } from "https"
import type { AuthHttpHeaders, AuthMethod } from "vscode-abap-remote-fs-sharedapi"

// 从 sharedapi 重新导出规范类型，而不是重复定义
export type {
  AuthMethod,
  AuthHttpHeaders,
  CertAuthConfig,
  CertAuthTransport,
  KerberosAuthConfig,
  OAuthOnPremConfig
} from "vscode-abap-remote-fs-sharedapi"

export const AUTH_METHODS = ["basic", "cert", "kerberos", "browser_sso", "oauth_onprem"] as const

export const AUTH_METHOD_LABELS: Record<AuthMethod, string> = {
  basic: "Basic (Username/Password)",
  cert: "X.509 Client Certificate",
  kerberos: "Kerberos / SPNEGO (SSO)",
  browser_sso: "Browser SSO (Cookie Capture)",
  oauth_onprem: "OAuth 2.0 (On-Premise SAP)"
}

/** 认证尝试的结果 — 提供 ADTClient 需要的内容。 */
export interface AuthResult {
  /** ADTClient 构造函数的密码字符串或异步 token 获取器。 */
  passwordOrFetcher: string | (() => Promise<string>)
  /** 自定义 HTTPS agent（用于证书认证）。 */
  httpsAgent?: Agent
  /** 注入到每个请求的额外头（例如 cookie）。 */
  headers?: AuthHttpHeaders
}
