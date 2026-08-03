import { Token } from "client-oauth2"
import { context } from "../extension"
import { PasswordVault, log } from "../lib"

export interface TokenData {
  tokenType: string
  accessToken: string
  refreshToken: string
}

const KEY = "oauth_grants"
const tokens = new Map<string, TokenData>()

export const strip = (t: TokenData): TokenData => {
  const { accessToken, refreshToken, tokenType } = t
  return { accessToken, refreshToken, tokenType }
}

export function getToken(connId: string) {
  return tokens.get(connId)
}

export function setToken(connId: string, token: TokenData) {
  tokens.set(connId, strip(token))
}

export async function storeTokens() {
  try {
    const vault = PasswordVault.get()
    const tokenEntries = [...tokens.entries()]

    // 使用 VSCode secrets API 安全存储每个 token
    for (const [connId, token] of tokenEntries) {
      await vault.setPassword("oauth-tokens", connId, JSON.stringify(strip(token)))
    }

    // 从全局状态清除（旧版清理）
    await context.globalState.update(KEY, undefined)
  } catch (error) {
    log(`❌ Failed to store OAuth tokens securely: ${error}`)
    // 回退到旧方法以保持功能
    const t = [...tokens.entries()]
    return context.globalState.update(KEY, t)
  }
}

export async function clearTokens() {
  try {
    const vault = PasswordVault.get()
    const tokenEntries = [...tokens.entries()]

    // 从安全存储清除
    for (const [connId] of tokenEntries) {
      await vault.deletePassword("oauth-tokens", connId)
    }

    // 从内存清除
    tokens.clear()

    // 从全局状态清除（旧版清理）
    await context.globalState.update(KEY, undefined)
  } catch (error) {
    log(`❌ Failed to clear OAuth tokens securely: ${error}`)
    // 回退到旧方法
    context.globalState.update(KEY, undefined)
  }
}

export async function loadTokens() {
  try {
    const vault = PasswordVault.get()

    // 先尝试从安全存储加载
    // 注意：我们无法枚举 secrets，所以需要时从全局状态迁移
    const legacyEntries: [string, Token][] = context.globalState.get(KEY, [])

    if (legacyEntries.length > 0) {
      // 把旧版 token 迁移到安全存储
      for (const [connId, token] of legacyEntries) {
        tokens.set(connId, strip(token))
        await vault.setPassword("oauth-tokens", connId, JSON.stringify(strip(token)))
      }

      // 迁移后清除旧版存储
      await context.globalState.update(KEY, undefined)
    }
  } catch (error) {
    log(`❌ Failed to load OAuth tokens securely, falling back: ${error}`)
    // 回退到旧版方法
    const entries: [string, Token][] = context.globalState.get(KEY, [])
    entries.forEach(e => tokens.set(...e))
  }
}
