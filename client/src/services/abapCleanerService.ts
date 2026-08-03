/**
 * ABAP Cleaner 服务
 *
 * 与 SAP 的 ABAP Cleaner 工具集成，用于自动代码格式化
 * https://github.com/SAP/abap-cleaner
 */

import * as vscode from "vscode"
import { funWindow as window } from "./funMessenger"
import * as path from "path"
import * as fs from "fs"
import { promisify } from "util"
import { logTelemetry } from "./telemetry"
import { exec } from "child_process"
import { log } from "../lib"

const execAsync = promisify(exec)

export interface CleanerConfig {
  enabled: boolean
  executablePath: string
  profilePath?: string
  targetRelease: string
  showStatistics: boolean
  showAppliedRules: boolean
  cleanOnSave: boolean
  lineRange?: {
    enabled: boolean
    expandRange: boolean
  }
  timeout: number
}

export interface CleanerResult {
  success: boolean
  cleanedCode?: string
  statistics?: string
  appliedRules?: string[]
  error?: string
  changed: boolean
}

export class ABAPCleanerService {
  private static instance: ABAPCleanerService
  private config: CleanerConfig
  private tempFileCounter = 0

  private constructor() {
    this.config = this.loadConfiguration()

    // 监听配置变化
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("abapfs.cleaner")) {
        this.config = this.loadConfiguration()
        this.updateContext()
        log("🔧 ABAP Cleaner configuration updated")
      }
    })

    this.updateContext()
  }

  public static getInstance(): ABAPCleanerService {
    if (!ABAPCleanerService.instance) {
      ABAPCleanerService.instance = new ABAPCleanerService()
    }
    return ABAPCleanerService.instance
  }

  private loadConfiguration(): CleanerConfig {
    const config = vscode.workspace.getConfiguration("abapfs.cleaner")
    return {
      enabled: config.get("enabled", false),
      executablePath: config.get("executablePath", ""),
      profilePath: config.get("profilePath", ""),
      targetRelease: config.get("targetRelease", "latest"),
      showStatistics: config.get("showStatistics", true),
      showAppliedRules: config.get("showAppliedRules", false),
      cleanOnSave: config.get("cleanOnSave", false),
      lineRange: config.get("lineRange", { enabled: false, expandRange: true }),
      timeout: config.get("timeout", 30000)
    }
  }

  private updateContext(): void {
    const isAvailable = this.isAvailable()
    vscode.commands.executeCommand("setContext", "abapfs.cleanerAvailable", isAvailable)
  }

  public isAvailable(): boolean {
    return this.config.enabled && this.isExecutableValid()
  }

  public isExecutableValid(): boolean {
    if (!this.config.executablePath) {
      return false
    }

    try {
      return fs.existsSync(this.config.executablePath)
    } catch (error) {
      log(`❌ Error checking cleaner executable: ${error}`)
      return false
    }
  }

  /**
   * 校验并清理文件路径，防止命令注入
   */
  private validatePath(filePath: string, description: string): void {
    if (!filePath || typeof filePath !== "string") {
      throw new Error(`${description} path is required`)
    }

    // 防止路径遍历和命令注入
    if (
      filePath.includes("..") ||
      filePath.includes(";") ||
      filePath.includes("&") ||
      filePath.includes("|") ||
      filePath.includes("`") ||
      filePath.includes("$")
    ) {
      throw new Error(`${description} path contains invalid characters`)
    }

    // 确保路径是绝对的，防止相对路径攻击
    if (!path.isAbsolute(filePath)) {
      throw new Error(`${description} path must be absolute`)
    }
  }

  /**
   * 使用已配置的清理器清理 ABAP 代码
   */
  public async cleanCode(
    code: string,
    options?: {
      startLine?: number
      endLine?: number
      fileName?: string
    }
  ): Promise<CleanerResult> {
    if (!this.isAvailable()) {
      return {
        success: false,
        error: "ABAP Cleaner is not available. Please check configuration.",
        changed: false
      }
    }

    // 使用前校验可执行文件路径
    try {
      this.validatePath(this.config.executablePath, "Executable")
      if (this.config.profilePath) {
        this.validatePath(this.config.profilePath, "Profile")
      }
    } catch (error) {
      return {
        success: false,
        error: `Security validation failed: ${error}`,
        changed: false
      }
    }

    try {
      log("🧹 Starting ABAP code cleaning...")

      // 创建临时文件
      const tempInputFile = await this.createTempFile(code, "input.abap")
      const tempOutputFile = await this.createTempFile("", "output.abap")

      // 校验临时文件路径
      this.validatePath(tempInputFile, "Temporary input file")
      this.validatePath(tempOutputFile, "Temporary output file")

      try {
        // 构建命令
        const command = await this.buildCleanCommand(tempInputFile, tempOutputFile, options)

        // 执行清理器
        const { stdout, stderr } = await execAsync(command, {
          timeout: this.config.timeout,
          cwd: path.dirname(this.config.executablePath)
        })

        // 读取清理后的代码
        const cleanedCode = await this.readTempFile(tempOutputFile)
        const changed = cleanedCode !== code

        const result: CleanerResult = {
          success: true,
          cleanedCode,
          changed,
          statistics: this.config.showStatistics ? this.extractStatistics(stdout) : undefined,
          appliedRules: this.config.showAppliedRules ? this.extractAppliedRules(stdout) : undefined
        }

        if (changed) {
        } else {
          log(`✅ ABAP code processed. No changes needed.`)
        }

        if (stderr && stderr.trim()) {
          log(`⚠️ Cleaner warnings: ${stderr}`)
        }

        return result
      } finally {
        // 清理临时文件
        await this.deleteTempFile(tempInputFile)
        await this.deleteTempFile(tempOutputFile)
      }
    } catch (error) {
      log(`❌ ABAP Cleaner error: ${error}`)
      return {
        success: false,
        error: `ABAP Cleaner failed: ${error}`,
        changed: false
      }
    }
  }

  /**
   * 清理当前活动编辑器
   */
  public async cleanActiveEditor(): Promise<boolean> {
    const editor = window.activeTextEditor
    logTelemetry("command_cleaner_called", { activeEditor: editor })

    if (!editor) {
      window.showWarningMessage("No active editor found")
      return false
    }

    if (editor.document.languageId !== "abap") {
      window.showWarningMessage("Current file is not an ABAP file")
      return false
    }

    const document = editor.document
    const selection = editor.selection

    // 确定要清理的内容
    let textToClean: string
    let startLine: number | undefined
    let endLine: number | undefined
    let range: vscode.Range

    if (!selection.isEmpty && this.config.lineRange?.enabled) {
      // 清理选区
      range = new vscode.Range(selection.start, selection.end)
      textToClean = document.getText(range)
      startLine = selection.start.line + 1 // 转换为从 1 开始
      endLine = selection.end.line + 1
      log(`🎯 Cleaning selected lines ${startLine}-${endLine}`)
    } else {
      // 清理整个文档
      range = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      )
      textToClean = document.getText()
    }

    // 显示进度
    return window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "ABAP Cleaner",
        cancellable: false
      },
      async progress => {
        progress.report({ message: "Cleaning ABAP code..." })

        const result = await this.cleanCode(textToClean, {
          startLine,
          endLine,
          fileName: document.fileName
        })

        if (!result.success) {
          window.showErrorMessage(`ABAP Cleaner failed: ${result.error}`)
          return false
        }

        if (!result.changed) {
          window.showInformationMessage("✨ ABAP code is already clean - no changes needed")
          return true
        }

        if (result.cleanedCode) {
          // 应用更改
          const edit = new vscode.WorkspaceEdit()
          edit.replace(document.uri, range, result.cleanedCode)

          const applied = await vscode.workspace.applyEdit(edit)

          if (applied) {
            // 可用时显示统计
            let message = "✨ ABAP code cleaned successfully"
            if (result.statistics) {
              message += `\n${result.statistics}`
            }

            window.showInformationMessage(message)

            if (result.appliedRules && result.appliedRules.length > 0) {
              const rules = result.appliedRules.slice(0, 5).join(", ")
              const moreRules =
                result.appliedRules.length > 5 ? ` and ${result.appliedRules.length - 5} more` : ""
            }

            return true
          } else {
            window.showErrorMessage("Failed to apply ABAP Cleaner changes")
            return false
          }
        }

        return false
      }
    )
  }

  /**
   * ABAP Cleaner 配置的设置向导
   */
  public async setupWizard(): Promise<void> {
    logTelemetry("command_setup_abap_cleaner_integration_called") // 无可用上下文
    try {
      // 第 1 步：检查是否已配置
      if (this.isAvailable()) {
        const reconfigure = await window.showQuickPick(
          ["Keep current configuration", "Reconfigure ABAP Cleaner"],
          {
            placeHolder: "ABAP Cleaner is already configured. What would you like to do?",
            ignoreFocusOut: true
          }
        )

        if (reconfigure !== "Reconfigure ABAP Cleaner") {
          return
        }
      }

      // 第 2 步：选择可执行文件
      const executablePath = await this.selectExecutable()
      if (!executablePath) {
        return
      }

      // 第 3 步：用新选择的路径测试可执行文件
      const testResult = await window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "ABAP Cleaner Setup",
          cancellable: false
        },
        async progress => {
          progress.report({ message: "Testing ABAP Cleaner executable..." })
          return await this.testExecutable(executablePath)
        }
      )

      if (!testResult.success) {
        window.showErrorMessage(`ABAP Cleaner test failed: ${testResult.error}`)
        return
      }

      // 第 4 步：可选配置文件选择
      const profilePath = await this.selectProfile()

      // 第 5 步：目标版本选择
      const targetRelease = await this.selectTargetRelease()
      if (!targetRelease) {
        return
      }

      // 第 6 步：附加选项
      const options = await this.selectOptions()
      if (!options) {
        return
      }

      // 第 7 步：保存配置
      await this.saveConfiguration({
        enabled: true,
        executablePath,
        profilePath,
        targetRelease,
        ...options
      })

      window.showInformationMessage(
        "✅ ABAP Cleaner configured successfully! You can now use the clean code icon in the toolbar."
      )

      log("✅ AbapFs ABAP Cleaner setup completed successfully")
    } catch (error) {
      log(`❌ Setup wizard error: ${error}`)
      window.showErrorMessage(`Setup failed: ${error}`)
    }
  }

  private async selectExecutable(): Promise<string | undefined> {
    const options: vscode.QuickPickItem[] = [
      {
        label: "📁 Browse for executable",
        description: "Select abap-cleanerc.exe file manually"
      },
      {
        label: "🔗 Download ABAP Cleaner",
        description: "Open GitHub releases page to download"
      }
    ]

    const selection = await window.showQuickPick(options, {
      placeHolder: "How would you like to set up ABAP Cleaner?",
      ignoreFocusOut: true
    })

    if (!selection) {
      return undefined
    }

    if (selection.label.includes("Download")) {
      vscode.env.openExternal(vscode.Uri.parse("https://github.com/SAP/abap-cleaner/releases"))
      window.showInformationMessage(
        "Please download abap-cleaner, extract it, and then run the setup wizard again."
      )
      return undefined
    }

    // 浏览文件 - 用 file:// URI 强制本地文件系统
    // 把用户主目录作为默认起点
    const os = require("os")
    const homeDir = os.homedir()
    const defaultUri = vscode.Uri.file(homeDir)

    const result = await window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: defaultUri, // Start in user's home directory
      filters: {
        "ABAP Cleaner Executable": ["exe"],
        "All Files": ["*"]
      },
      title: "Select abap-cleanerc.exe (command line version) from your LOCAL computer",
      openLabel: "Select ABAP Cleaner Executable"
    })

    if (result && result[0]) {
      const selectedPath = result[0].fsPath

      // 校验它是本地文件（不是来自 ABAP 文件系统）
      if (selectedPath.includes("adt://")) {
        window.showErrorMessage(
          "Please select the ABAP Cleaner executable from your local computer, not from the ABAP system."
        )
        return undefined
      }

      // 校验它是正确的可执行文件
      if (!selectedPath.toLowerCase().includes("cleaner")) {
        const proceed = await window.showWarningMessage(
          "The selected file does not appear to be ABAP Cleaner. Continue anyway?",
          "Yes",
          "No"
        )
        if (proceed !== "Yes") {
          return undefined
        }
      }

      log(`📁 Selected ABAP Cleaner executable: ${selectedPath}`)
      return selectedPath
    }

    return undefined
  }

  private async testExecutable(
    executablePath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 用简单的 ABAP 代码片段测试
      const testCode = "DATA: lv_test TYPE string.\nlv_test = 'Hello World'."
      const tempFile = await this.createTempFile(testCode, "test.abap")

      try {
        const command = `"${executablePath}" --sourcefile "${tempFile}" --overwrite`

        // 针对首次测试失败问题的重试机制
        let lastError: any
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            log(`🔄 Test attempt ${attempt}/3`)

            // 确保文件已完全写入且可访问
            await new Promise(resolve => setTimeout(resolve, 100)) // 短暂延迟

            // 验证临时文件存在且可读
            if (!fs.existsSync(tempFile)) {
              throw new Error(`Temp file ${tempFile} does not exist`)
            }

            await execAsync(command, {
              timeout: 15000, // Increased timeout
              cwd: path.dirname(executablePath)
            })

            log(`✅ ABAP Cleaner test successful on attempt ${attempt}`)
            return { success: true }
          } catch (error) {
            lastError = error
            log(`⚠️ Test attempt ${attempt} failed: ${error}`)

            if (attempt < 3) {
              // 重试前等待
              await new Promise(resolve => setTimeout(resolve, 1000))
            }
          }
        }

        // 所有尝试都失败
        throw lastError
      } finally {
        await this.deleteTempFile(tempFile)
      }
    } catch (error) {
      log(`❌ ABAP Cleaner test failed: ${error}`)
      return { success: false, error: `${error}` }
    }
  }

  private async selectProfile(): Promise<string | undefined> {
    const useProfile = await window.showQuickPick(
      ["Use default profile", "Select custom profile"],
      {
        placeHolder: "Which cleanup profile would you like to use?",
        ignoreFocusOut: true
      }
    )

    if (useProfile === "Select custom profile") {
      // 从主目录开始强制本地文件系统
      const os = require("os")
      const homeDir = os.homedir()
      const defaultUri = vscode.Uri.file(homeDir)

      const result = await window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri: defaultUri, // Start in user's home directory
        filters: {
          "ABAP Cleaner Profile": ["cfj"],
          "All Files": ["*"]
        },
        title: "Select ABAP Cleaner profile (.cfj file) from your LOCAL computer",
        openLabel: "Select Profile"
      })

      if (result && result[0]) {
        const selectedPath = result[0].fsPath

        // 校验它是本地文件（不是来自 ABAP 文件系统）
        if (selectedPath.includes("adt://")) {
          window.showErrorMessage(
            "Please select the profile file from your local computer, not from the ABAP system."
          )
          return undefined
        }

        return selectedPath
      }
    }

    return undefined
  }

  private async selectTargetRelease(): Promise<string | undefined> {
    const releases = [
      { label: "Latest", description: "Use the latest ABAP features", value: "latest" },
      { label: "ABAP 7.57", description: "SAP NetWeaver 7.57", value: "7.57" },
      { label: "ABAP 7.56", description: "SAP NetWeaver 7.56", value: "7.56" },
      { label: "ABAP 7.55", description: "SAP NetWeaver 7.55", value: "7.55" },
      { label: "ABAP 7.54", description: "SAP NetWeaver 7.54", value: "7.54" },
      { label: "ABAP 7.53", description: "SAP NetWeaver 7.53", value: "7.53" },
      { label: "ABAP 7.52", description: "SAP NetWeaver 7.52", value: "7.52" },
      { label: "ABAP 7.51", description: "SAP NetWeaver 7.51", value: "7.51" },
      { label: "ABAP 7.50", description: "SAP NetWeaver 7.50", value: "7.50" },
      { label: "ABAP 7.40", description: "SAP NetWeaver 7.40", value: "7.40" },
      { label: "ABAP 7.03", description: "SAP NetWeaver 7.03", value: "7.03" },
      { label: "ABAP 7.02", description: "SAP NetWeaver 7.02", value: "7.02" }
    ]

    const selection = await window.showQuickPick(releases, {
      placeHolder: "Select target ABAP release",
      ignoreFocusOut: true
    })

    return selection?.value
  }

  private async selectOptions(): Promise<any> {
    const options = await window.showQuickPick(
      [
        { label: "Show statistics after cleaning", picked: true },
        { label: "Show applied rules (verbose)", picked: false },
        { label: "Clean code automatically on save", picked: false }
      ],
      {
        placeHolder: "Select additional options (use space to toggle)",
        canPickMany: true,
        ignoreFocusOut: true
      }
    )

    if (!options) {
      return undefined
    }

    return {
      showStatistics: options.some(o => o.label.includes("statistics")),
      showAppliedRules: options.some(o => o.label.includes("applied rules")),
      cleanOnSave: options.some(o => o.label.includes("on save"))
    }
  }

  private async saveConfiguration(config: Partial<CleanerConfig>): Promise<void> {
    try {
      // 获取当前清理器配置
      const currentConfig = vscode.workspace.getConfiguration("abapfs").get("cleaner", {})

      // 与新配置合并
      const updatedConfig = { ...currentConfig, ...config }

      // 一次保存整个清理器配置对象
      await vscode.workspace
        .getConfiguration("abapfs")
        .update("cleaner", updatedConfig, vscode.ConfigurationTarget.Global)

      log(`✅ Saved ABAP Cleaner configuration successfully`)

      // 保存后强制重新加载配置
      this.config = this.loadConfiguration()
      this.updateContext()
      log(`🔄 Configuration reloaded and context updated`)
    } catch (error) {
      log(`❌ Failed to save ABAP Cleaner configuration: ${error}`)
      throw error
    }
  }

  private async buildCleanCommand(
    inputFile: string,
    outputFile: string,
    options?: { startLine?: number; endLine?: number }
  ): Promise<string> {
    let command = `"${this.config.executablePath}" --sourcefile "${inputFile}" --targetfile "${outputFile}" --overwrite`

    // 配置了则添加配置文件
    if (this.config.profilePath) {
      command += ` --profile "${this.config.profilePath}"`
    }

    // 添加目标版本
    if (this.config.targetRelease && this.config.targetRelease !== "latest") {
      command += ` --release ${this.config.targetRelease}`
    }

    // 指定时添加行范围
    if (options?.startLine && options?.endLine && this.config.lineRange?.enabled) {
      command += ` --linerange ${options.startLine}-${options.endLine}`
    }

    // 添加统计标志
    if (this.config.showStatistics) {
      command += ` --stats`
    }

    // 添加已应用规则标志
    if (this.config.showAppliedRules) {
      command += ` --usedrules`
    }

    return command
  }

  private async createTempFile(content: string, suffix: string): Promise<string> {
    const tempDir = require("os").tmpdir()
    const tempFile = path.join(
      tempDir,
      `abap-cleaner-${Date.now()}-${this.tempFileCounter++}-${suffix}`
    )

    // 用显式同步写入文件，确保刷新到磁盘
    await promisify(fs.writeFile)(tempFile, content, { encoding: "utf8", flag: "w" })

    // 性能优化：只验证文件存在，不验证内容
    // 内容验证造成了不必要的 I/O 开销
    try {
      await promisify(fs.access)(tempFile, fs.constants.F_OK)
    } catch (error) {
      throw new Error(`Failed to create temp file ${tempFile}: ${error}`)
    }

    log(`📝 Created temp file: ${tempFile}`)
    return tempFile
  }

  private async readTempFile(filePath: string): Promise<string> {
    return promisify(fs.readFile)(filePath, "utf8")
  }

  private async deleteTempFile(filePath: string): Promise<void> {
    try {
      await promisify(fs.unlink)(filePath)
    } catch (error) {
      // 忽略清理错误
      log(`⚠️ Failed to delete temp file ${filePath}: ${error}`)
    }
  }

  private extractStatistics(output: string): string | undefined {
    // 从清理器输出提取统计
    const lines = output.split("\n")
    const statsLine = lines.find(
      line => line.includes("changed") || line.includes("rule") || line.includes("statement")
    )
    return statsLine?.trim()
  }

  private extractAppliedRules(output: string): string[] | undefined {
    // 从清理器输出提取已应用规则
    const lines = output.split("\n")
    const rules: string[] = []

    let inRulesSection = false
    for (const line of lines) {
      if (line.includes("Applied rules:") || line.includes("Rules used:")) {
        inRulesSection = true
        continue
      }

      if (inRulesSection && line.trim()) {
        if (line.startsWith("  ") || line.startsWith("\t")) {
          rules.push(line.trim())
        } else {
          break
        }
      }
    }

    return rules.length > 0 ? rules : undefined
  }

  /**
   * 获取保存时自动清理的配置
   */
  public shouldCleanOnSave(): boolean {
    return this.config.cleanOnSave && this.isAvailable()
  }
}
