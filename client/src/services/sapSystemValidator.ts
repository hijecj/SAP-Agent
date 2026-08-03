import * as vscode from "vscode"
import { StatusBarAlignment, StatusBarItem } from "vscode"
import { funWindow as window } from "./funMessenger"
import * as crypto from "crypto"

/**
 * 中央 SAP 系统与用户白名单校验器
 * 获取允许的系统和用户并校验连接
 */
// 开发人员映射接口
interface DeveloperMapping {
  uniqueId: string
  manager: string
}

export class SapSystemValidator {
  private static instance: SapSystemValidator
  private allowedDomains: string[] = []
  private allowedUsers: string[] = []
  private userMapping: Map<string, DeveloperMapping> = new Map() // userId -> {uniqueId, manager}
  private minimumExtensionVersion: string | null = null // 存储白名单中的最低版本
  private lastFetch: number = 0

  // ⚙️ 配置：设为 true 跳过校验（允许所有）
  // TODO: 组织管理员 - 在构建 VSIX 前设置这些
  private readonly ALLOW_ALL_SYSTEMS = true // 设为 true 允许所有 SAP 系统（跳过系统白名单）
  private readonly ALLOW_ALL_USERS = true // 设为 true 允许所有用户（跳过用户白名单）

  private readonly TTL_MS = 2 * 60 * 60 * 1000 // 2 hour TTL
  // TODO: 替换为组织的白名单文件 URL - 例如 https://example.com/site/whitelist.json
  // 文件必须在你的网络中无需认证即可直接访问（读权限足够）
  // 参见本文件夹中的 whitelist.example.json 获取示例 JSON 白名单文件
  private readonly WHITELIST_URL = "your-whitelist-url-here"

  // 🔒 备份白名单 - 远程白名单获取失败时使用
  private readonly BACKUP_WHITELIST = ["*dev1*", "*dev2*", "*qa1*", "*qa2*", "*prd1*"]

  // 🔒 备份用户 - 远程获取失败时使用
  private readonly BACKUP_USERS: string[] = [
    // 填入备份用户
    "*user1*",
    "*user2*"
  ]

  // 🔄 企业网络重试逻辑
  private whitelistRefreshed: boolean = false
  private retryCount: number = 0
  private readonly MAX_RETRIES = 10 // 最多 10 分钟
  private readonly RETRY_INTERVAL_MS = 60 * 1000 // 60 秒
  private retryTimer: NodeJS.Timeout | null = null
  private statusBarItem: StatusBarItem | null = null

  private constructor() {}

  public static getInstance(): SapSystemValidator {
    if (!SapSystemValidator.instance) {
      SapSystemValidator.instance = new SapSystemValidator()
    }
    return SapSystemValidator.instance
  }

  /**
   * 初始化校验器 - 扩展启动时获取白名单，带企业网络重试逻辑
   */
  public async initialize(): Promise<void> {
    // 如果两个 allow_all 标志都为 true，完全跳过白名单获取
    if (this.ALLOW_ALL_SYSTEMS && this.ALLOW_ALL_USERS) {
      console.log(
        "🔓 SAP System Validator: ALLOW_ALL_SYSTEMS and ALLOW_ALL_USERS enabled - skipping whitelist fetch"
      )
      this.whitelistRefreshed = true
      return
    }

    try {
      await this.fetchWhitelist()
      // 成功 - whitelistRefreshed 已在 fetchWhitelist 中设为 true
      // 初始加载成功时无需状态栏或通知
    } catch (error) {
      // 使用备份白名单作为回退
      this.allowedDomains = [...this.BACKUP_WHITELIST]
      this.allowedUsers = [...this.BACKUP_USERS]
      this.lastFetch = Date.now()

      // 启动企业网络重试逻辑（whitelistRefreshed 保持 false）
      this.startVpnRetryProcess()
    }
  }

  /**
   * 启动企业网络重试流程，带状态栏倒计时
   */
  private startVpnRetryProcess(): void {
    if (this.whitelistRefreshed) return // 已获取白名单

    this.retryCount = 0
    this.createStatusBarItem()
    this.scheduleNextRetry()
  }

  /**
   * 创建并显示用于倒计时的状态栏项
   */
  private createStatusBarItem(): void {
    if (!this.statusBarItem) {
      this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100)
      this.statusBarItem.command = "abapfs.retryWhitelist"
    }
    this.statusBarItem.show()
  }

  /**
   * 用倒计时更新状态栏并安排下次重试
   */
  private scheduleNextRetry(): void {
    if (this.whitelistRefreshed || this.retryCount >= this.MAX_RETRIES) {
      this.handleMaxRetriesReached()
      return
    }

    let secondsLeft = 60
    this.updateStatusBar(secondsLeft)

    // 每秒更新倒计时
    const countdownInterval = setInterval(() => {
      secondsLeft--
      this.updateStatusBar(secondsLeft)

      if (secondsLeft <= 0) {
        clearInterval(countdownInterval)
        this.attemptWhitelistRefresh()
      }
    }, 1000)
  }

  /**
   * 用倒计时更新状态栏文本
   */
  private updateStatusBar(secondsLeft: number): void {
    if (this.statusBarItem) {
      this.statusBarItem.text = `$(sync~spin) SAP Whitelist: Retrying in ${secondsLeft}s (${this.retryCount + 1}/${this.MAX_RETRIES})`
      this.statusBarItem.tooltip = "Click to retry whitelist fetch immediately"
    }
  }

  /**
   * 尝试刷新白名单（倒计时结束后调用）
   */
  private async attemptWhitelistRefresh(): Promise<void> {
    this.retryCount++

    try {
      // 重置上次获取时间以强制刷新
      this.lastFetch = 0
      await this.fetchWhitelist()

      // 如果 fetchWhitelist() 未抛错完成，则成功
      //（whitelistRefreshed 已在内部设为 true）
      this.handleWhitelistSuccess()
    } catch (error) {
      // 再次失败 - 安排下次重试或显示最终错误
      this.scheduleNextRetry()
    }
  }

  /**
   * 处理白名单获取成功（整合的成功逻辑）
   */
  private handleWhitelistSuccess(): void {
    this.clearRetryTimer()

    if (this.statusBarItem) {
      this.statusBarItem.text = "$(check) SAP Whitelist: Connected"
      this.statusBarItem.tooltip = "SAP system whitelist loaded successfully"

      // 5 秒后隐藏成功消息
      setTimeout(() => {
        if (this.statusBarItem) {
          this.statusBarItem.hide()
        }
      }, 5000)
    }

    // 只有重试过才显示通知（初始成功时不显示）
    if (this.retryCount > 0) {
      window.showInformationMessage("✅ SAP system whitelist loaded successfully!")
    }
  }

  /**
   * 处理达到最大重试次数的情况
   */
  private handleMaxRetriesReached(): void {
    // 显示持久的状态栏警告
    if (this.statusBarItem) {
      this.statusBarItem.text = "$(warning) SAP Whitelist: Corporate Network Required"
      this.statusBarItem.tooltip =
        "Connect to corporate network and restart VSCode to load updated SAP system whitelist. Click for help."
      this.statusBarItem.command = "abapfs.showVpnHelp"
      // 永久保持状态栏可见 - 无需弹窗
    }
  }

  /**
   * 清除重试定时器并重置状态
   */
  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  /**
   * 强制立即重试（由命令或用户操作调用）
   */
  public async forceRetryWhitelist(): Promise<void> {
    this.clearRetryTimer()
    this.retryCount = 0
    this.whitelistRefreshed = false
    this.lastFetch = 0

    if (this.statusBarItem) {
      this.statusBarItem.text = "$(sync~spin) SAP Whitelist: Retrying..."
    }

    try {
      await this.fetchWhitelist()

      // 如果 fetchWhitelist() 未抛错完成，则成功
      //（whitelistRefreshed 已在内部设为 true）
      this.handleWhitelistSuccess()
    } catch (error) {
      this.startVpnRetryProcess()
    }
  }

  /**
   * 显示企业网络帮助信息
   */
  public showVpnHelp(): void {
    window
      .showInformationMessage(
        "🔗 SAP System Whitelist Help\n\n" +
          "The extension needs to fetch an updated list of allowed SAP systems and users from the corporate network.\n\n" +
          "📋 Steps to resolve:\n" +
          "1. Connect to corporate network\n" +
          '2. Restart VSCode (Ctrl+Shift+P → "Developer: Reload Window")\n\n' +
          "⚠️ Currently using backup whitelist with limited systems and users.",
        "Retry Now"
      )
      .then(selection => {
        if (selection === "Retry Now") {
          this.forceRetryWhitelist()
        }
      })
  }

  /**
   * 解析白名单数据并创建用户映射
   */
  private parseWhitelistData(data: any): void {
    // 存储最低版本供后续检查
    this.minimumExtensionVersion = data.version?.minimumExtensionVersion || null

    // 先检查版本兼容性
    if (this.minimumExtensionVersion) {
      const currentVersion = this.getCurrentExtensionVersion()

      if (!this.isVersionCompatible(currentVersion, this.minimumExtensionVersion)) {
        throw new Error(
          `Extension version ${currentVersion} is below minimum required version ${this.minimumExtensionVersion}. Please update the extension.`
        )
      }
    }

    // 清除现有映射
    this.userMapping.clear()
    this.allowedUsers = []

    // 处理带 developers 的新格式
    if (data.developers && Array.isArray(data.developers)) {
      data.developers.forEach((developer: any, devIndex: number) => {
        if (developer.manager && developer.userIds && Array.isArray(developer.userIds)) {
          // 为该开发人员生成稳定的唯一标识
          const devHash = crypto
            .createHash("sha256")
            .update(`${developer.manager}_${devIndex}`)
            .digest("hex")
            .substring(0, 16)
          const uniqueId = `dev-${devHash}`

          // 把该开发人员的所有用户 ID 映射到同一唯一标识
          developer.userIds.forEach((userId: string) => {
            this.allowedUsers.push(userId)
            this.userMapping.set(userId.toLowerCase(), {
              uniqueId: uniqueId,
              manager: developer.manager
            })
          })
        }
      })
    }
  }

  /**
   * 获取用于遥测的用户映射（唯一 ID 和经理）
   */
  public getUserMapping(userId: string): DeveloperMapping | null {
    return this.userMapping.get(userId.toLowerCase()) || null
  }

  /**
   * 带 TTL 缓存获取白名单
   */
  private async fetchWhitelist(): Promise<void> {
    const now = Date.now()

    // 检查缓存是否仍有效
    // 如果使用备份列表，不要每次 isSystemAllowed 调用都重试
    if (this.lastFetch > 0 && now - this.lastFetch < this.TTL_MS) {
      return
    }

    try {
      // 增强安全：添加超时并校验响应
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 秒超时

      const response = await fetch(this.WHITELIST_URL, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "ABAP-Copilot-Extension"
        }
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // 校验内容类型
      const contentType = response.headers.get("content-type")
      if (!contentType?.includes("application/json")) {
        throw new Error(`Invalid content type: ${contentType}. Expected application/json`)
      }

      const data = (await response.json()) as any

      if (!data.allowedDomains || !Array.isArray(data.allowedDomains)) {
        throw new Error("Invalid whitelist format: missing allowedDomains array")
      }

      this.allowedDomains = data.allowedDomains

      // 解析带 developers 的新白名单格式
      this.parseWhitelistData(data)

      this.lastFetch = now
      this.whitelistRefreshed = true // 只在成功获取时设为 true
    } catch (error) {
      // console.error('❌ SAP System Validator: Failed to fetch whitelist:', error);

      // 如果还没有加载任何域，使用备份白名单
      if (this.allowedDomains.length === 0) {
        this.allowedDomains = [...this.BACKUP_WHITELIST]
        this.allowedUsers = [...this.BACKUP_USERS]
        this.lastFetch = now
      }

      // 不立即显示警告 - 让重试逻辑处理
      throw error
    }
  }

  /**
   * 检查系统 URL 和用户是否允许（带通配符匹配）
   * 返回详细校验结果
   */
  public async checkSystemAccess(
    url: string,
    server?: string,
    username?: string
  ): Promise<{ allowed: boolean; failureReason?: "system" | "user" | "version" }> {
    try {
      // 如果两个 allow_all 标志都为 true，跳过所有校验
      if (this.ALLOW_ALL_SYSTEMS && this.ALLOW_ALL_USERS) {
        return { allowed: true }
      }

      // 如果尚未加载白名单则获取（校验或遥测分组需要）
      if (this.allowedDomains.length === 0) {
        await this.fetchWhitelist()
      }

      // 使用存储的最低版本检查版本
      if (this.minimumExtensionVersion) {
        const currentVersion = this.getCurrentExtensionVersion()
        if (!this.isVersionCompatible(currentVersion, this.minimumExtensionVersion)) {
          return { allowed: false, failureReason: "version" }
        }
      }

      // 检查系统校验（ALLOW_ALL_SYSTEMS = true 时跳过）
      if (!this.ALLOW_ALL_SYSTEMS) {
        // 从 URL 提取主机名
        const urlHostname = this.extractHostname(url)

        // 先检查 URL - 如果被阻止，无需检查服务器或用户
        const urlAllowed = this.matchesWhitelist(urlHostname)

        if (!urlAllowed) {
          return { allowed: false, failureReason: "system" }
        }

        // URL 已允许，现在检查提供的服务器
        if (server) {
          const serverHostname = this.extractHostname(server)
          const serverAllowed = this.matchesWhitelist(serverHostname)

          if (!serverAllowed) {
            return { allowed: false, failureReason: "system" }
          }
        }
      }

      // 检查用户校验（ALLOW_ALL_USERS = true 时跳过）
      if (!this.ALLOW_ALL_USERS && username) {
        const userAllowed = this.matchesUserWhitelist(username)

        if (!userAllowed) {
          return { allowed: false, failureReason: "user" }
        }
      }

      return { allowed: true }
    } catch (error) {
      // console.error('❌ SAP System Validator: Error during validation:', error);
      // 故障安全：出错时拒绝访问
      return { allowed: false, failureReason: "system" }
    }
  }

  /**
   * 检查系统 URL 和用户是否允许（向后兼容）
   */
  // public async isSystemAllowed(url: string, server?: string, username?: string): Promise<boolean> {
  //     const result = await this.checkSystemAccess(url, server, username);
  //     return result.allowed;
  // }

  /**
   * 从 URL 提取主机名
   */
  private extractHostname(url: string): string {
    try {
      // 处理带或不带协议头的 URL
      const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`)
      return urlObj.hostname.toLowerCase()
    } catch {
      // 如果 URL 解析失败，按纯主机名处理
      return url.toLowerCase()
    }
  }

  /**
   * 检查主机名是否匹配白名单中的任意通配符模式
   * 不区分大小写匹配，方便使用
   */
  private matchesWhitelist(hostname: string): boolean {
    const lowerHostname = hostname.toLowerCase()

    return this.allowedDomains.some(pattern => {
      // 把通配符模式转换为正则（不区分大小写）
      const regexPattern = pattern
        .toLowerCase() // 把模式转为小写
        .replace(/\./g, "\\.") // 转义点号
        .replace(/\*/g, ".*") // 把 * 转换为 .*

      const regex = new RegExp(`^${regexPattern}$`)
      const matches = regex.test(lowerHostname)

      if (matches) {
      }

      return matches
    })
  }

  /**
   * 检查用户名是否匹配用户白名单中的任意通配符模式
   * 不区分大小写匹配，方便使用
   */
  private matchesUserWhitelist(username: string): boolean {
    // 如果未配置用户，允许所有用户（向后兼容）
    if (this.allowedUsers.length === 0) {
      console.log(`✅ No user whitelist configured, allowing all users`)
      return true
    }

    const lowerUsername = username.toLowerCase()

    const matches = this.allowedUsers.some(pattern => {
      // 把通配符模式转换为正则（不区分大小写）
      const regexPattern = pattern
        .toLowerCase() // 把模式转为小写
        .replace(/\./g, "\\.") // 转义点号
        .replace(/\*/g, ".*") // 把 * 转换为 .*

      const regex = new RegExp(`^${regexPattern}$`)
      const matches = regex.test(lowerUsername)

      if (matches) {
      }

      return matches
    })

    if (!matches) {
      console.log(`❌ Username '${username}' does not match any allowed user patterns`)
    }

    return matches
  }

  /**
   * 系统或用户被阻止时显示友好的错误
   */
  public async validateSystemAccess(
    url: string,
    server?: string,
    username?: string
  ): Promise<void> {
    const result = await this.checkSystemAccess(url, server, username)

    if (!result.allowed) {
      const hostname = this.extractHostname(url)

      let errorMessage: string
      let errorDetail: string

      if (result.failureReason === "version") {
        const currentVersion = this.getCurrentExtensionVersion()
        errorMessage = `🚫 Extension Version Outdated

Your extension version (${currentVersion}) is below the minimum required version (${this.minimumExtensionVersion}).

Please update ABAP FS to the latest version.`
        errorDetail = `Extension version ${currentVersion} is below minimum required version ${this.minimumExtensionVersion}`
      } else if (result.failureReason === "user") {
        errorMessage = `🚫 SAP User Access Denied
            
User '${username}' is not authorized to access this system.

Contact your administrator to request user access.`
        errorDetail = `User '${username}' is not in the approved users whitelist`
      } else {
        // 系统失败（或未知失败默认为系统）
        errorMessage = `🚫 SAP System Access Denied
            
System '${hostname}' is not in the approved systems list.

Contact your administrator to request access to this system.`
        errorDetail = `SAP system '${hostname}' is not in the approved systems whitelist`
      }

      // console.error('🚫 SAP System Validator: Access denied');
      window.showErrorMessage(errorMessage)
      throw new Error(errorDetail)
    }
  }

  /**
   * 获取当前白名单用于调试
   */

  /**
   * 强制刷新白名单（用于测试/调试）
   */
  public async refreshWhitelist(): Promise<void> {
    this.lastFetch = 0 // 重置 TTL
    await this.fetchWhitelist()
  }

  /**
   * 获取当前扩展版本
   */
  private getCurrentExtensionVersion(): string {
    try {
      // 用 VS Code API 获取扩展版本（与其他服务相同）
      return (
        vscode.extensions.getExtension("murbani.vscode-abap-remote-fs")?.packageJSON?.version ||
        "0.0.0"
      )
    } catch (error) {
      // 如果扩展不可访问，回退到默认版本
      return "0.0.0"
    }
  }

  /**
   * 检查当前版本是否兼容最低要求版本
   */
  private isVersionCompatible(currentVersion: string, minimumVersion: string): boolean {
    try {
      const current = this.parseVersion(currentVersion)
      const minimum = this.parseVersion(minimumVersion)

      // 比较主、次、补丁版本号
      if (current.major !== minimum.major) {
        return current.major > minimum.major
      }
      if (current.minor !== minimum.minor) {
        return current.minor > minimum.minor
      }
      return current.patch >= minimum.patch
    } catch (error) {
      // 如果版本解析失败，视为不兼容
      return false
    }
  }

  /**
   * 把版本字符串解析为主.次.补丁组件
   */
  private parseVersion(version: string): { major: number; minor: number; patch: number } {
    const parts = version.split(".").map(Number)
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0
    }
  }
}
