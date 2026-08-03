import { LogData } from "abap-adt-api"
export enum Methods {
  objectDetails = "vscabap.objDetails",
  readConfiguration = "vscabap.readConfig",
  readEditorObjectSource = "vscabap.editObjSource",
  readObjectSourceOrMain = "vscabap.mainObjSource",
  setSearchProgress = "vscabap.setSearchProgress",
  cancelSearch = "vscabap.cancelSearch",
  vsUri = "vscabap.vsUri",
  updateMainProgram = "vscabap.updateMain",
  getToken = "vscabap.getToken",
  getAuthHeaders = "vscabap.getAuthHeaders",
  triggerSyntaxCheck = "vscabap.triggerSyntaxCheck",
  commLogEntry = "vscabap.commLogEntry",
  commLogToggle = "vscabap.commLogToggle"
}

export interface AbapObjectDetail {
  url: string
  mainUrl: string
  mainProgram?: string
  type: string
  name: string
}

/** SAP 连接支持的认证方法。 */
export type AuthMethod = "basic" | "cert" | "kerberos" | "browser_sso" | "oauth_onprem"
export type NonBasicAuthMethod = Exclude<AuthMethod, "basic">

/** X.509 客户端证书配置（仅路径 — 口令在保险库中）。 */
export interface CertAuthConfig {
  certPath: string
  keyPath: string
  caPath?: string
}

/** Kerberos/SPNEGO 配置（所有字段可选 — PowerShell SSPI 使用 UseDefaultCredentials）。 */
export interface KerberosAuthConfig {
  sapHostname?: string
  realm?: string
  spn?: string
}

/** 本地 SAP OAuth 2.0 配置（SOAUTH2）。 */
export interface OAuthOnPremConfig {
  /** 在 SOAUTH2 中注册的 OAuth 客户端 ID。 */
  clientId: string
  /** OAuth 客户端密钥（使用 PKCE 时可省略）。 */
  clientSecret?: string
  /** OAuth 作用域（默认：SAP_ADT）。 */
  scope?: string
}

/** 从扩展主机转发到语言服务器的 HTTP 头。 */
export type AuthHttpHeaders = Readonly<Record<string, string>>

/** 发送到语言服务器以重建 https.Agent 的证书材料。 */
export interface CertAuthTransport extends CertAuthConfig {
  passphrase?: string
}

/** 扩展主机为非 basic 认证方法返回的认证元数据。 */
export interface AuthHeadersResponse {
  httpHeaders?: AuthHttpHeaders
  certAuth?: CertAuthTransport
}

export interface ClientConfiguration {
  name: string
  url: string
  username: string
  password: string
  client: string
  language: string
  allowSelfSigned: boolean
  customCA?: string
  diff_formatter: "ADT formatter" | "AbapLint" | "Simple"
  /** 认证方法。省略时默认为 "basic"（向后兼容）。 */
  authMethod?: AuthMethod
  /** 证书认证配置（只在 authMethod === "cert" 时）。 */
  certAuth?: CertAuthConfig
  /** Kerberos 认证配置（只在 authMethod === "kerberos" 时）。 */
  kerberosAuth?: KerberosAuthConfig
  /** 本地 OAuth 配置（只在 authMethod === "oauth_onprem" 时）。 */
  oauthOnPrem?: OAuthOnPremConfig
  oauth?: {
    clientId: string
    clientSecret: string
    loginUrl: string
    saveCredentials?: boolean
  }
}

export const getAuthMethod = (config: Pick<ClientConfiguration, "authMethod">): AuthMethod =>
  config.authMethod || "basic"

export type ClientConfigurationWithAuth<M extends AuthMethod> = ClientConfiguration & {
  authMethod: M
}

export type CertClientConfiguration = ClientConfigurationWithAuth<"cert"> & {
  certAuth: CertAuthConfig
}

export type OAuthOnPremClientConfiguration = ClientConfigurationWithAuth<"oauth_onprem"> & {
  oauthOnPrem: OAuthOnPremConfig
}

export const hasCertAuthConfig = (config: ClientConfiguration): config is CertClientConfiguration =>
  getAuthMethod(config) === "cert" && !!config.certAuth

export const hasOAuthOnPremConfig = (
  config: ClientConfiguration
): config is OAuthOnPremClientConfiguration =>
  getAuthMethod(config) === "oauth_onprem" && !!config.oauthOnPrem

export interface AbapObjectSource {
  url: string
  source: string
}

export interface StringWrapper {
  s: string
}

export interface UriRequest {
  confKey: string
  uri: string
  mainInclude: boolean
}

export interface SearchProgress {
  progress: number
  hits: number
  ended: boolean
}

export interface MainProgram {
  includeUri: string
  mainProgramUri: string
}

export interface CommLogTogglePayload {
  active: boolean
  connId: string
}

export const urlFromPath = (configKey: string, path: string) => `adt://${configKey}${path}`

export function objectIsValid(obj?: AbapObjectDetail) {
  if (!obj) return false
  return obj.type !== "PROG/I" || !!obj.mainProgram
}

export const stripExtension = (u: string) => u.replace(/\.abap/, "")

/** 从服务器转发到客户端的通信日志条目 */
export interface CommLogEntryData {
  connId: string
  logData: LogData
}
