import { ExtensionContext } from "vscode"

/**
 * 使用 VS Code 内置 secrets API 的安全密码存储。
 * @security 此类不会向应用外部发送任何数据。
 * 所有凭证都存储在 VS Code 加密的机密存储中
 * （ExtensionContext.secrets），它使用操作系统钥匙串/凭据管理器。
 * Checkmarx 误报：CWE-359 - 这是安全的本地存储，不是外部传输。
 */
export class PasswordVault {
  private static instance: PasswordVault
  constructor(private context: ExtensionContext) {
    PasswordVault.instance = this
  }

  getPassword(service: string, account: string) {
    return this.context.secrets.get(`${service}:${account}`)
  }

  setPassword(service: string, account: string, password: string) {
    return this.context.secrets.store(`${service}:${account}`, password)
  }

  deletePassword(service: string, account: string) {
    return this.context.secrets.delete(`${service}:${account}`)
  }
  async accounts(service: string): Promise<{ account: string; password: string }[]> {
    return [] //TODO：实现或移除
  }
  static get() {
    if (!PasswordVault.instance) throw new Error("No password vault defined")
    return PasswordVault.instance
  }
}
