/**
 * 认证模块的桶状导出。
 *
 * 重新导出所有认证类型和策略构建器。
 */

export { AUTH_METHODS, AUTH_METHOD_LABELS } from "./types"
export type {
  AuthMethod,
  AuthHttpHeaders,
  AuthResult,
  CertAuthConfig,
  CertAuthTransport,
  KerberosAuthConfig,
  OAuthOnPremConfig
} from "./types"
export {
  buildCertAuth,
  storeCertPassphrase,
  getCertPassphrase,
  clearCertPassphrase
} from "./certificate"
export { buildKerberosAuth, refreshKerberosAuth, clearKerberosCookies } from "./kerberos"
export { buildBrowserSsoAuth, refreshBrowserSsoAuth, clearSsoCookies } from "./browserSso"
export { buildOAuthOnPremAuth, clearOAuthOnPremTokens } from "./oauthOnPrem"
