/**
 * X.509 客户端证书认证
 *
 * 用用户的客户端证书 + 私钥构建 https.Agent。
 * SAP 通过把证书映射到 SAP 用户来认证用户
 * （通过 SAP 侧的 CERTRULE / STRUST 配置）。
 *
 * 存储位置：
 *  - certPath、keyPath、caPath → VS Code 设置（非机密路径）
 *  - passphrase → PasswordVault（操作系统凭据存储）
 *
 * ADTClient 收到一个虚拟用户名占位符；实际认证
 * 通过自定义 httpsAgent 在 TLS 层发生。
 */

import * as https from "https"
import { readFileSync, existsSync } from "fs"
import { AuthResult, CertAuthConfig } from "./types"
import { PasswordVault, log } from "../lib"
import { formatKey } from "../config"

const VAULT_SERVICE = "vscode.abapfs.cert"

/** 安全存储证书口令。 */
export async function storeCertPassphrase(connId: string, passphrase: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.setPassword(VAULT_SERVICE, formatKey(connId), passphrase)
}

/** 从安全存储检索证书口令。 */
export async function getCertPassphrase(connId: string): Promise<string> {
  const vault = PasswordVault.get()
  return (await vault.getPassword(VAULT_SERVICE, formatKey(connId))) || ""
}

/** 从安全存储清除证书口令。 */
export async function clearCertPassphrase(connId: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.deletePassword(VAULT_SERVICE, formatKey(connId))
}

/**
 * 为证书认证构建 AuthResult。
 *
 * @param connId     连接标识符（用于保险库查找）
 * @param certConfig 来自设置的证书路径
 * @param skipSsl    是否跳过服务器证书校验
 * @param customCA   可选的自定义 CA 证书内容或路径
 */
export async function buildCertAuth(
  connId: string,
  certConfig: CertAuthConfig,
  skipSsl: boolean,
  customCA?: string
): Promise<AuthResult> {
  log.debug(`[cert] buildCertAuth starting for ${connId}`)
  const allowedExts = /\.(pem|crt|cer|key|p12|pfx)$/i
  const isPkcs12 = /\.(p12|pfx)$/i.test(certConfig.certPath || "")
  log.debug(
    `[cert] certPath=${certConfig.certPath}, keyPath=${certConfig.keyPath}, isPkcs12=${isPkcs12}`
  )
  if (
    !certConfig.certPath ||
    !allowedExts.test(certConfig.certPath) ||
    !existsSync(certConfig.certPath)
  ) {
    throw new Error(`Client certificate not found or invalid extension: ${certConfig.certPath}`)
  }
  // keyPath 只对 PEM 格式必需，PKCS#12（.p12/.pfx）容器不需要
  if (!isPkcs12) {
    if (
      !certConfig.keyPath ||
      !allowedExts.test(certConfig.keyPath) ||
      !existsSync(certConfig.keyPath)
    ) {
      throw new Error(`Private key not found or invalid extension: ${certConfig.keyPath}`)
    }
  }

  const agentOptions: https.AgentOptions = {
    rejectUnauthorized: !skipSsl,
    keepAlive: true
  }

  // .p12/.pfx 文件是 PKCS#12 容器 — 使用 `pfx` 选项，而不是 cert+key
  if (/\.(p12|pfx)$/i.test(certConfig.certPath)) {
    agentOptions.pfx = readFileSync(certConfig.certPath)
    // keyPath 不用于 PFX 容器
  } else {
    agentOptions.cert = readFileSync(certConfig.certPath)
    agentOptions.key = readFileSync(certConfig.keyPath)
  }

  const passphrase = await getCertPassphrase(connId)
  if (passphrase) {
    agentOptions.passphrase = passphrase
  }

  // CA 链：优先使用证书配置中的显式 caPath，然后是连接级 customCA
  const caPath = certConfig.caPath || customCA
  if (caPath) {
    if (existsSync(caPath)) {
      agentOptions.ca = readFileSync(caPath)
    } else if (caPath.includes("-----BEGIN CERTIFICATE-----")) {
      agentOptions.ca = caPath // 已是 PEM 内容
    } else {
      throw new Error(`CA certificate not found: ${caPath}`)
    }
  }

  const agent = new https.Agent(agentOptions)

  log.debug(
    `[cert] buildCertAuth complete for ${connId}: agent created, hasPassphrase=${!!passphrase}, hasCA=${!!caPath}`
  )
  return {
    passwordOrFetcher: "x509-cert-auth",
    httpsAgent: agent
  }
}
