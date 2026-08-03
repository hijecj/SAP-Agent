import * as vscode from "vscode"
import { funWindow as window } from "../services/funMessenger"

export class AbapHoverProviderV2 implements vscode.HoverProvider {
  constructor(private log?: (message: string) => void) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const startTime = Date.now()

    try {
      // 针对 ABAP 专属 token（如 TEXT-001、SY-SUBRC 等）的自定义单词范围检测
      let wordRange = this.getAbapWordRange(document, position)
      if (!wordRange) {
        wordRange = document.getWordRangeAtPosition(position)
        if (!wordRange) return
      }

      const word = document.getText(wordRange)
      const line = document.lineAt(position.line).text

      // 1. 优先级：用现有的“转到定义”解析用户悬停的内容
      const definitionHover = await this.getDefinitionBasedHover(document, position, word)
      if (definitionHover) {
        return new vscode.Hover(definitionHover, wordRange)
      }

      // 2. 优先级：上下文感知关键字（MESSAGE TYPE 等）- 针对语言构造
      const contextAwareHover = this.getContextAwareHover(word, line)
      if (contextAwareHover) {
        return new vscode.Hover(contextAwareHover, wordRange)
      }

      // 2.5. 文本符号：已禁用（需要 ADT API 集成）
      // const textSymbolHover = await this.getTextSymbolHover(word, document);
      // if (textSymbolHover) {
      //     return new vscode.Hover(textSymbolHover, wordRange);
      // }

      // 3. 回退：内置类型（仅作为最后手段）
      const builtInHover = this.getBuiltInTypeHover(word)
      if (builtInHover) {
        return new vscode.Hover(builtInHover, wordRange)
      }
    } catch (error) {
      this.log?.(`[V2] ❌ Error in hover provider: ${error}`)
      console.error("[V2] Error in hover provider:", error)
    }

    return undefined
  }

  // 针对 ABAP 专属模式的自定义单词范围检测
  private getAbapWordRange(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Range | undefined {
    const line = document.lineAt(position.line)
    const text = line.text
    const character = position.character

    // 检查 TEXT-XXX 模式
    const textSymbolPattern = /\bTEXT-\d{3}\b/g
    let match
    while ((match = textSymbolPattern.exec(text)) !== null) {
      const start = match.index
      const end = match.index + match[0].length
      if (character >= start && character < end) {
        return new vscode.Range(
          new vscode.Position(position.line, start),
          new vscode.Position(position.line, end)
        )
      }
    }

    // 检查 SY-XXX 模式（系统变量）
    const syVarPattern = /\bSY-\w+\b/gi
    syVarPattern.lastIndex = 0 // 重置正则
    while ((match = syVarPattern.exec(text)) !== null) {
      const start = match.index
      const end = match.index + match[0].length
      if (character >= start && character < end) {
        return new vscode.Range(
          new vscode.Position(position.line, start),
          new vscode.Position(position.line, end)
        )
      }
    }

    // 检查 SYST-XXX 模式（替代的系统变量格式）
    const systVarPattern = /\bSYST-\w+\b/gi
    systVarPattern.lastIndex = 0 // 重置正则
    while ((match = systVarPattern.exec(text)) !== null) {
      const start = match.index
      const end = match.index + match[0].length
      if (character >= start && character < end) {
        //   this.log?.(`[V2] 🎯 Detected SYST variable: ${match[0]}`);
        return new vscode.Range(
          new vscode.Position(position.line, start),
          new vscode.Position(position.line, end)
        )
      }
    }

    return undefined
  }

  // ============================================================================
  // 基于定义的悬停
  // ============================================================================

  private async getDefinitionBasedHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    word: string
  ): Promise<vscode.MarkdownString | undefined> {
    try {
      //   this.log?.(`[V2] 🔍 Using Go to Definition for: ${word}`);

      const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeDefinitionProvider",
        document.uri,
        position
      )

      if (!definitions || definitions.length === 0) {
        //  this.log?.(`[V2] ⚠️ No definition found for: ${word}`);
        return undefined
      }

      const definition = definitions[0]

      // 检查文档是否已打开，避免刷新它
      const existingEditor = window.visibleTextEditors.find(
        editor => editor.document.uri.toString() === definition.uri.toString()
      )

      let definitionDoc: vscode.TextDocument
      if (existingEditor) {
        // 文档已打开，使用现有文档
        definitionDoc = existingEditor.document
      } else {
        // 文档未打开，可以安全打开
        definitionDoc = await vscode.workspace.openTextDocument(definition.uri)
      }
      const definitionLine = definitionDoc.lineAt(definition.range.start.line)
      const definitionText = definitionLine.text.trim()

      // this.log?.(`[V2] ✅ Definition found at: ${definition.uri.fsPath}:${definition.range.start.line + 1}`);
      //  this.log?.(`[V2] 📖 Definition content: "${definitionText}"`);

      // 如果定义看起来不完整（结构类型常见），尝试获取更多上下文
      if (
        definitionText.includes("define structure") ||
        definitionText.includes("@EndUserText") ||
        definitionText.includes("@AbapCatalog") ||
        (definitionText.length < 50 && definitionText.includes("{"))
      ) {
        // this.log?.(`[V2] 🔍 Definition appears to be a structure, extracting complete definition`);
        const completeDefinition = await this.extractCompleteStructureDefinition(
          definitionDoc,
          definition.range.start.line,
          word
        )
        if (completeDefinition) {
          // 使用完整定义而不是基础定义
          return this.createDefinitionHover(
            word,
            definition,
            completeDefinition,
            definitionDoc,
            document,
            position
          )
        }
      }

      return this.createDefinitionHover(
        word,
        definition,
        definitionText,
        definitionDoc,
        document,
        position
      )
    } catch (error) {
      this.log?.(`[V2] ❌ Error in definition-based hover: ${error}`)
      return undefined
    }
  }

  private async createDefinitionHover(
    word: string,
    definition: vscode.Location,
    definitionText: string,
    definitionDoc: vscode.TextDocument,
    originalDocument: vscode.TextDocument,
    originalPosition: vscode.Position
  ): Promise<vscode.MarkdownString | undefined> {
    const markdown = new vscode.MarkdownString()
    markdown.supportHtml = true

    const fileName = definition.uri.path.split("/").pop() || "Unknown"
    const lineNumber = definition.range.start.line + 1
    const definitionUpper = definitionText.toUpperCase()

    let signatureInfo: string | undefined

    if (definitionUpper.startsWith("FUNCTION")) {
      markdown.appendMarkdown(`⚙️ **Function Module**: \`${word}\`\n\n`)
      signatureInfo = await this.extractSignature(
        definitionDoc,
        definition.range.start.line,
        "ENDFUNCTION"
      )
    } else if (definitionUpper.startsWith("METHOD ")) {
      // 注意空格 - 匹配 "METHOD xyz" 但不匹配 "METHODS xyz"
      markdown.appendMarkdown(`🔧 **Method**: \`${word}\`\n\n`)

      // 确定悬停位置：声明（METHODS）、实现（METHOD）还是调用点
      const originalLine = originalDocument.lineAt(originalPosition.line).text.trim().toUpperCase()
      const isAtDeclaration = originalLine.includes("METHODS ") // 复数 = 声明
      const isAtImplementation =
        originalDocument.uri.toString() === definition.uri.toString() &&
        originalPosition.line === definition.range.start.line

      try {
        if (isAtDeclaration) {
          // 在声明处 - 只显示实现（签名在编辑器中已可见）
          const implCode = await this.extractSignature(
            definitionDoc,
            definition.range.start.line,
            "ENDMETHOD"
          )
          if (implCode) {
            markdown.appendMarkdown(`**Implementation:**\n`)
            markdown.appendCodeblock(implCode, "abap")
            markdown.appendMarkdown(`\n---\n`)
            markdown.appendMarkdown(`*Defined in ${fileName} (Line ${lineNumber})*`)
            return markdown
          }
        } else if (isAtImplementation) {
          // 在实现处 - 只显示签名（实现在编辑器中已可见）
          const declDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeImplementationProvider",
            originalDocument.uri,
            originalPosition
          )
          if (declDefinitions && declDefinitions.length > 0) {
            const declDoc = await vscode.workspace.openTextDocument(declDefinitions[0].uri)
            const methodDecl = await this.extractMethodDeclaration(
              declDoc,
              declDefinitions[0].range.start.line
            )
            if (methodDecl) {
              markdown.appendMarkdown(`**Signature:**\n`)
              markdown.appendCodeblock(methodDecl, "abap")
              markdown.appendMarkdown(`\n---\n`)
              markdown.appendMarkdown(`*Defined in ${fileName} (Line ${lineNumber})*`)
              return markdown
            }
          }
        } else {
          // 在调用点 - 同时显示签名和实现
          const declDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeImplementationProvider",
            originalDocument.uri,
            originalPosition
          )
          if (declDefinitions && declDefinitions.length > 0) {
            const declDoc = await vscode.workspace.openTextDocument(declDefinitions[0].uri)
            const methodDecl = await this.extractMethodDeclaration(
              declDoc,
              declDefinitions[0].range.start.line
            )
            const implCode = await this.extractSignature(
              definitionDoc,
              definition.range.start.line,
              "ENDMETHOD"
            )

            if (methodDecl && implCode) {
              markdown.appendMarkdown(`**Signature:**\n`)
              markdown.appendCodeblock(methodDecl, "abap")
              markdown.appendMarkdown(`\n**Implementation:**\n`)
              markdown.appendCodeblock(implCode, "abap")
              markdown.appendMarkdown(`\n---\n`)
              markdown.appendMarkdown(`*Defined in ${fileName} (Line ${lineNumber})*`)
              return markdown
            }
          }
        }
      } catch (e) {
        // 出现任何错误时回退到默认行为
      }

      signatureInfo = await this.extractSignature(
        definitionDoc,
        definition.range.start.line,
        "ENDMETHOD"
      )
    } else if (definitionUpper.startsWith("CLASS")) {
      markdown.appendMarkdown(`🏗️ **Class**: \`${word}\`\n\n`)
      signatureInfo = await this.extractSignature(
        definitionDoc,
        definition.range.start.line,
        "ENDCLASS"
      )
    } else if (definitionUpper.startsWith("TYPES")) {
      // TYPES 声明 - 显示完整类型定义，尤其是结构类型
      markdown.appendMarkdown(`🏗️ **Type Definition**: \`${word}\`\n\n`)

      // 检查是否为结构类型（BEGIN OF / END OF）
      if (definitionUpper.includes("BEGIN OF")) {
        signatureInfo = await this.extractStructuredType(definitionDoc, definition.range.start.line)
      }
    } else if (
      definitionUpper.startsWith("DEFINE STRUCTURE") ||
      definitionUpper.includes("DEFINE STRUCTURE")
    ) {
      // CDS/DDIC 结构定义 - 显示带注解的完整结构
      markdown.appendMarkdown(`🏗️ **Structure Definition**: \`${word}\`\n\n`)
      signatureInfo = await this.extractCompleteStructureDefinition(
        definitionDoc,
        definition.range.start.line,
        word
      )
    } else if (
      definitionUpper.startsWith("@") ||
      (definitionUpper.includes("@") && definitionUpper.includes("DEFINE STRUCTURE"))
    ) {
      // 带注解的结构 - 捕获包括注解在内的所有内容
      markdown.appendMarkdown(`🏗️ **Annotated Structure**: \`${word}\`\n\n`)
      signatureInfo = await this.extractCompleteStructureDefinition(
        definitionDoc,
        definition.range.start.line,
        word
      )
    } else if (definitionUpper.startsWith("DATA")) {
      markdown.appendMarkdown(`📦 **Variable**: \`${word}\`\n\n`)
    } else if (definitionUpper.startsWith("PARAMETERS")) {
      markdown.appendMarkdown(`🔧 **Parameter**: \`${word}\`\n\n`)
    } else if (definitionUpper.startsWith("TABLES")) {
      markdown.appendMarkdown(`🗃️ **Table Work Area**: \`${word}\`\n\n`)
    } else if (definitionUpper.startsWith("INCLUDE")) {
      markdown.appendMarkdown(`📄 **Include**: \`${word}\`\n\n`)
    } else {
      // 检查这可能是一个方法声明（无关键字前缀）
      const isMethodDeclaration = await this.isMethodDeclaration(
        definitionDoc,
        definition.range.start.line,
        definitionText,
        word
      )

      if (isMethodDeclaration) {
        markdown.appendMarkdown(`🔧 **Method Declaration**: \`${word}\`\n\n`)

        // 显示签名（声明）——我们已经在这里了
        signatureInfo = await this.extractMethodDeclaration(
          definitionDoc,
          definition.range.start.line
        )

        // 获取实现（因为 Definition 和 Implementation 已互换，
        // executeImplementationProvider 会转到实际实现）
        try {
          const implDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeDefinitionProvider", // 现在转到实现（因为我们互换了它们）
            originalDocument.uri,
            originalPosition
          )

          if (implDefinitions && implDefinitions.length > 0) {
            const implDef = implDefinitions[0]

            // 检查实现是否与声明不同
            const isDifferent =
              implDef.uri.toString() !== definition.uri.toString() ||
              implDef.range.start.line !== definition.range.start.line

            if (isDifferent) {
              const implDoc = await vscode.workspace.openTextDocument(implDef.uri)
              const implCode = await this.extractSignature(
                implDoc,
                implDef.range.start.line,
                "ENDMETHOD"
              )

              if (implCode && signatureInfo) {
                markdown.appendMarkdown(`**Signature:**\n`)
                markdown.appendCodeblock(signatureInfo, "abap")
                markdown.appendMarkdown(`\n**Implementation:**\n`)
                markdown.appendCodeblock(implCode, "abap")
                signatureInfo = undefined // Prevent double rendering below
              }
            }
          }
        } catch (e) {
          // 如果无法获取实现，只显示签名
        }
      } else {
        markdown.appendMarkdown(`📄 **Definition**: \`${word}\`\n\n`)
      }
    }

    if (signatureInfo) {
      // 检查是否为 XML 数据字典内容
      if (signatureInfo.trim().startsWith("<?xml")) {
        const parsedInfo = this.parseDataDictionaryXml(signatureInfo, word)
        if (parsedInfo) {
          markdown.appendMarkdown(parsedInfo)
        } else {
          markdown.appendMarkdown(`**Raw Definition:**\n`)
          markdown.appendCodeblock(signatureInfo, "abap")
        }
      } else {
        // 对结构定义，提供增强格式化
        if (
          signatureInfo.includes("@EndUserText") ||
          signatureInfo.includes("@AbapCatalog") ||
          signatureInfo.includes("define structure")
        ) {
          markdown.appendMarkdown(`**Complete Definition:**\n`)

          // 提取并高亮注解中的关键信息
          const annotations = this.extractAnnotationInfo(signatureInfo)
          if (annotations.length > 0) {
            markdown.appendMarkdown(`**Annotations:**\n`)
            annotations.forEach(annotation => {
              markdown.appendMarkdown(`• ${annotation}\n`)
            })
            markdown.appendMarkdown(`\n**Source Code:**\n`)
          }
        }
        markdown.appendCodeblock(signatureInfo, "abap")
      }
    } else {
      // 检查单行定义文本是否为 XML
      if (definitionText.trim().startsWith("<?xml")) {
        const parsedInfo = this.parseDataDictionaryXml(definitionText, word)
        if (parsedInfo) {
          markdown.appendMarkdown(parsedInfo)
        } else {
          markdown.appendCodeblock(definitionText, "abap")
        }
      } else {
        markdown.appendCodeblock(definitionText, "abap")
      }
    }

    markdown.appendMarkdown(`\n---\n`)
    markdown.appendMarkdown(`*Defined in ${fileName} (Line ${lineNumber})*`)

    return markdown
  }

  private async extractSignature(
    doc: vscode.TextDocument,
    startLine: number,
    endKeyword: string
  ): Promise<string | undefined> {
    try {
      let signatureText = ""
      let balance = 0
      let inComment = false

      for (let i = startLine; i < doc.lineCount; i++) {
        const line = doc.lineAt(i).text
        const trimmedLine = line.trim()

        if (trimmedLine.startsWith("*")) continue // 跳过整行注释

        const commentIndex = trimmedLine.indexOf('"')
        const lineContent =
          commentIndex !== -1 ? trimmedLine.substring(0, commentIndex) : trimmedLine

        signatureText += line + "\n"

        if (lineContent.toUpperCase().includes(endKeyword)) {
          break
        }
      }
      return signatureText
    } catch (error) {
      this.log?.(`[V2] ⚠️ Error extracting signature: ${error}`)
      return undefined
    }
  }

  private async extractStructuredType(
    doc: vscode.TextDocument,
    startLine: number
  ): Promise<string | undefined> {
    try {
      let typeDefinition = ""
      let foundBeginOf = false
      let indentLevel = 0

      for (let i = startLine; i < doc.lineCount; i++) {
        const line = doc.lineAt(i).text
        const trimmedLine = line.trim()
        const lineUpper = trimmedLine.toUpperCase()

        // 跳过整行注释
        if (trimmedLine.startsWith("*")) continue // 跳过整行注释

        // 移除内联注释
        const commentIndex = trimmedLine.indexOf('"')
        const lineContent =
          commentIndex !== -1 ? trimmedLine.substring(0, commentIndex).trim() : trimmedLine
        const lineContentUpper = lineContent.toUpperCase()

        // 把行加入我们的定义
        typeDefinition += line + "\n"

        // 跟踪 BEGIN OF 语句
        if (lineContentUpper.includes("BEGIN OF")) {
          foundBeginOf = true
          indentLevel++
        }

        // 跟踪嵌套的 BEGIN OF 语句（用于嵌套结构）
        if (foundBeginOf && lineContentUpper.includes("BEGIN OF") && i > startLine) {
          indentLevel++
        }

        // 跟踪 END OF 语句
        if (lineContentUpper.includes("END OF")) {
          indentLevel--

          // 如果已闭合所有嵌套结构，完成
          if (indentLevel <= 0) {
            break
          }
        }

        // 安全检查，防止无限循环
        if (i - startLine > 150) {
          this.log?.(`[V2] ⚠️ Structure definition too long, truncating at line ${i}`)
          break
        }
      }

      return typeDefinition
    } catch (error) {
      this.log?.(`[V2] ⚠️ Error extracting structured type: ${error}`)
      return undefined
    }
  }

  private async extractCompleteStructureDefinition(
    doc: vscode.TextDocument,
    startLine: number,
    structureName: string
  ): Promise<string | undefined> {
    try {
      //  this.log?.(`[V2] 🏗️ Extracting complete structure definition for: ${structureName}`);

      let definition = ""
      let scanStartLine = startLine

      // 向后查找注解 - 简单方法
      for (let i = startLine - 1; i >= Math.max(0, startLine - 5); i--) {
        const line = doc.lineAt(i).text.trim()
        if (line.startsWith("@")) {
          scanStartLine = i
        } else if (line === "" || line.startsWith("*")) {
          // 允许注解之间的空行和注释
          continue
        } else {
          // 遇到非注解内容，停止向后查找
          break
        }
      }

      // 从注解提取到结构结束
      let braceCount = 0
      let foundStructure = false

      for (let i = scanStartLine; i < Math.min(doc.lineCount, scanStartLine + 20); i++) {
        const line = doc.lineAt(i).text
        definition += line + "\n"

        const trimmed = line.trim().toUpperCase()

        if (trimmed.includes("DEFINE STRUCTURE")) {
          foundStructure = true
        }

        if (foundStructure) {
          braceCount += (line.match(/\{/g) || []).length
          braceCount -= (line.match(/\}/g) || []).length

          // 闭合主花括号时结构完成
          if (braceCount <= 0 && line.includes("}")) {
            break
          }
        }
      }

      return definition.trim()
    } catch (error) {
      this.log?.(`[V2] ❌ Error extracting structure: ${error}`)
      return undefined
    }
  }

  private extractAnnotationInfo(sourceCode: string): string[] {
    const annotations: string[] = []
    const lines = sourceCode.split("\n")

    for (const line of lines) {
      const trimmedLine = line.trim()

      // 提取 EndUserText 标签
      const endUserTextMatch = trimmedLine.match(/@EndUserText\.label\s*:\s*'([^']+)'/)
      if (endUserTextMatch) {
        annotations.push(`**Label**: ${endUserTextMatch[1]}`)
      }

      // 提取 AbapCatalog 增强类别
      const enhancementMatch = trimmedLine.match(/@AbapCatalog\.enhancement\.category\s*:\s*#(\w+)/)
      if (enhancementMatch) {
        annotations.push(`**Enhancement Category**: ${enhancementMatch[1]}`)
      }

      // 提取其他常见注解
      const annotationMatch = trimmedLine.match(/@(\w+(?:\.\w+)*)\s*:\s*(.+)/)
      if (annotationMatch && !endUserTextMatch && !enhancementMatch) {
        annotations.push(`**${annotationMatch[1]}**: ${annotationMatch[2]}`)
      }
    }

    return annotations
  }

  private parseDataDictionaryXml(xmlContent: string, objectName: string): string | undefined {
    try {
      //  this.log?.(`[V2] 🔍 Parsing XML content for Data Dictionary object: ${objectName}`);

      // 表类型（如 SOLIX_TAB）
      if (xmlContent.includes("<ttyp:tableType")) {
        return this.parseTableTypeXml(xmlContent, objectName)
      }

      // 结构/数据元素
      if (xmlContent.includes("<dtel:dataElement") || xmlContent.includes("<stru:")) {
        return this.parseStructureXml(xmlContent, objectName)
      }

      // 数据库表
      if (xmlContent.includes("<tabl:table")) {
        return this.parseTableXml(xmlContent, objectName)
      }

      // 域
      if (xmlContent.includes("<doma:domain")) {
        return this.parseDomainXml(xmlContent, objectName)
      }

      this.log?.(`[V2] ⚠️ Unknown XML format for ${objectName}`)
      return undefined
    } catch (error) {
      this.log?.(`[V2] ❌ Error parsing XML for ${objectName}: ${error}`)
      return undefined
    }
  }

  private parseTableTypeXml(xmlContent: string, objectName: string): string {
    let result = ""

    try {
      // 提取所有核心属性
      const nameMatch = xmlContent.match(/adtcore:name="([^"]+)"/)
      const typeMatch = xmlContent.match(/adtcore:type="([^"]+)"/)
      const descMatch = xmlContent.match(/adtcore:description="([^"]+)"/)
      const descTextLimitMatch = xmlContent.match(/adtcore:descriptionTextLimit="([^"]+)"/)
      const responsibleMatch = xmlContent.match(/adtcore:responsible="([^"]+)"/)
      const masterLangMatch = xmlContent.match(/adtcore:masterLanguage="([^"]+)"/)
      const masterSystemMatch = xmlContent.match(/adtcore:masterSystem="([^"]+)"/)
      const abapLangVersionMatch = xmlContent.match(/adtcore:abapLanguageVersion="([^"]+)"/)
      const languageMatch = xmlContent.match(/adtcore:language="([^"]+)"/)
      const changedByMatch = xmlContent.match(/adtcore:changedBy="([^"]+)"/)
      const changedAtMatch = xmlContent.match(/adtcore:changedAt="([^"]+)"/)
      const createdByMatch = xmlContent.match(/adtcore:createdBy="([^"]+)"/)
      const createdAtMatch = xmlContent.match(/adtcore:createdAt="([^"]+)"/)
      const versionMatch = xmlContent.match(/adtcore:version="([^"]+)"/)

      // 头部信息
      result += `🗂️ **Table Type**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`

      if (descMatch) {
        result += `**Description**: ${descMatch[1]}\n`
        if (descTextLimitMatch) {
          result += `*(max ${descTextLimitMatch[1]} chars)*\n`
        }
        result += `\n`
      }

      // 元数据
      result += `**📋 Metadata:**\n`
      if (typeMatch) result += `• **Object Type**: ${typeMatch[1]}\n`
      if (responsibleMatch) result += `• **Responsible**: ${responsibleMatch[1]}\n`
      if (masterSystemMatch) result += `• **Master System**: ${masterSystemMatch[1]}\n`
      if (masterLangMatch) result += `• **Master Language**: ${masterLangMatch[1]}\n`
      if (languageMatch) result += `• **Current Language**: ${languageMatch[1]}\n`
      if (abapLangVersionMatch)
        result += `• **ABAP Language Version**: ${abapLangVersionMatch[1]}\n`
      if (versionMatch) result += `• **Version**: ${versionMatch[1]}\n`
      if (createdByMatch) result += `• **Created By**: ${createdByMatch[1]}\n`
      if (createdAtMatch) {
        const date = new Date(createdAtMatch[1])
        result += `• **Created At**: ${date.toLocaleString()}\n`
      }
      if (changedByMatch) result += `• **Last Changed By**: ${changedByMatch[1]}\n`
      if (changedAtMatch) {
        const date = new Date(changedAtMatch[1])
        result += `• **Last Changed At**: ${date.toLocaleString()}\n`
      }
      result += `\n`

      // 包信息
      const packageMatch = xmlContent.match(
        /<adtcore:packageRef[^>]*adtcore:name="([^"]+)"[^>]*adtcore:description="([^"]+)"/
      )
      if (packageMatch) {
        result += `**📦 Package**: ${packageMatch[1]} - ${packageMatch[2]}\n\n`
      }

      // 行类型信息
      const typeKindMatch = xmlContent.match(/<ttyp:typeKind>([^<]+)<\/ttyp:typeKind>/)
      const typeNameMatch = xmlContent.match(/<ttyp:typeName>([^<]+)<\/ttyp:typeName>/)
      const dataTypeMatch = xmlContent.match(/<ttyp:dataType>([^<]+)<\/ttyp:dataType>/)
      const lengthMatch = xmlContent.match(/<ttyp:length>(\d+)<\/ttyp:length>/)
      const decimalsMatch = xmlContent.match(/<ttyp:decimals>(\d+)<\/ttyp:decimals>/)

      result += `**🔧 Row Type Definition:**\n`
      if (typeKindMatch) result += `• **Type Kind**: ${typeKindMatch[1]}\n`
      if (typeNameMatch) result += `• **Type Name**: \`${typeNameMatch[1]}\`\n`
      if (dataTypeMatch) result += `• **Data Type**: ${dataTypeMatch[1]}\n`
      if (lengthMatch && parseInt(lengthMatch[1]) > 0)
        result += `• **Length**: ${parseInt(lengthMatch[1])}\n`
      if (decimalsMatch && parseInt(decimalsMatch[1]) > 0)
        result += `• **Decimals**: ${parseInt(decimalsMatch[1])}\n`
      result += `\n`

      // 表特性
      const initialRowCountMatch = xmlContent.match(
        /<ttyp:initialRowCount>(\d+)<\/ttyp:initialRowCount>/
      )
      const accessTypeMatch = xmlContent.match(/<ttyp:accessType>([^<]+)<\/ttyp:accessType>/)

      result += `**📊 Table Characteristics:**\n`
      if (accessTypeMatch) {
        const accessType = accessTypeMatch[1]
        const accessTypeDesc =
          {
            standard: "Standard Table (index access)",
            sorted: "Sorted Table (key and index access)",
            hashed: "Hashed Table (key access only)",
            index: "Index Table"
          }[accessType] || accessType
        result += `• **Access Type**: ${accessTypeDesc}\n`
      }
      if (initialRowCountMatch) {
        result += `• **Initial Row Count**: ${parseInt(initialRowCountMatch[1])}\n`
      }
      result += `\n`

      // 主键信息
      const keyDefinitionMatch = xmlContent.match(/<ttyp:definition>([^<]+)<\/ttyp:definition>/)
      const keyKindMatch = xmlContent.match(/<ttyp:kind>([^<]+)<\/ttyp:kind>/)
      const keyVisibleMatch = xmlContent.match(/<ttyp:primaryKey[^>]*ttyp:isVisible="([^"]+)"/)
      const keyEditableMatch = xmlContent.match(/<ttyp:primaryKey[^>]*ttyp:isEditable="([^"]+)"/)

      result += `**🔑 Primary Key:**\n`
      if (keyDefinitionMatch) result += `• **Definition**: ${keyDefinitionMatch[1]}\n`
      if (keyKindMatch) {
        const keyKind = keyKindMatch[1] === "nonUnique" ? "Non-unique" : "Unique"
        result += `• **Key Kind**: ${keyKind}\n`
      }
      if (keyVisibleMatch) result += `• **Visible**: ${keyVisibleMatch[1]}\n`
      if (keyEditableMatch) result += `• **Editable**: ${keyEditableMatch[1]}\n`
      result += `\n`

      // 二级键信息
      const secKeyAllowedMatch = xmlContent.match(/<ttyp:allowed>([^<]+)<\/ttyp:allowed>/)
      const secKeyVisibleMatch = xmlContent.match(
        /<ttyp:secondaryKeys[^>]*ttyp:isVisible="([^"]+)"/
      )
      const secKeyEditableMatch = xmlContent.match(
        /<ttyp:secondaryKeys[^>]*ttyp:isEditable="([^"]+)"/
      )

      if (secKeyAllowedMatch || secKeyVisibleMatch || secKeyEditableMatch) {
        result += `**🔑 Secondary Keys:**\n`
        if (secKeyAllowedMatch) result += `• **Allowed**: ${secKeyAllowedMatch[1]}\n`
        if (secKeyVisibleMatch) result += `• **Visible**: ${secKeyVisibleMatch[1]}\n`
        if (secKeyEditableMatch) result += `• **Editable**: ${secKeyEditableMatch[1]}\n`
        result += `\n`
      }

      // 使用示例
      result += `**💡 Usage Examples:**\n`
      result += `\`\`\`abap\n`
      result += `" Declaration\n`
      result += `DATA: lt_table TYPE ${objectName.toLowerCase()}.\n\n`
      result += `" Add entries\n`
      result += `APPEND VALUE #( /* fields */ ) TO lt_table.\n\n`
      result += `" Loop processing\n`
      result += `LOOP AT lt_table INTO DATA(ls_entry).\n`
      result += `  " Process entry\n`
      result += `ENDLOOP.\n`
      result += `\`\`\``
    } catch (error) {
      this.log?.(`[V2] ❌ Error parsing table type XML: ${error}`)
      result = `**Table Type**: ${objectName}\n\nError parsing XML: ${error}`
    }

    return result
  }

  private parseStructureXml(xmlContent: string, objectName: string): string {
    let result = ""

    try {
      // 提取所有核心属性
      const nameMatch = xmlContent.match(/adtcore:name="([^"]+)"/)
      const descMatch = xmlContent.match(/adtcore:description="([^"]+)"/)
      const responsibleMatch = xmlContent.match(/adtcore:responsible="([^"]+)"/)
      const masterLangMatch = xmlContent.match(/adtcore:masterLanguage="([^"]+)"/)
      const masterSystemMatch = xmlContent.match(/adtcore:masterSystem="([^"]+)"/)
      const changedByMatch = xmlContent.match(/adtcore:changedBy="([^"]+)"/)
      const changedAtMatch = xmlContent.match(/adtcore:changedAt="([^"]+)"/)
      const createdByMatch = xmlContent.match(/adtcore:createdBy="([^"]+)"/)
      const versionMatch = xmlContent.match(/adtcore:version="([^"]+)"/)
      const typeMatch = xmlContent.match(/adtcore:type="([^"]+)"/)

      // 确定对象类型
      const isDataElement = xmlContent.includes("<dtel:dataElement")
      const isStructure = xmlContent.includes("<stru:")

      // 头部信息
      if (isDataElement) {
        result += `📊 **Data Element**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`
      } else if (isStructure) {
        result += `🏗️ **Structure**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`
      } else {
        result += `📄 **Dictionary Object**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`
      }

      if (descMatch) {
        result += `**Description**: ${descMatch[1]}\n\n`
      }

      // 元数据
      result += `**📋 Metadata:**\n`
      if (responsibleMatch) result += `• **Responsible**: ${responsibleMatch[1]}\n`
      if (masterSystemMatch) result += `• **Master System**: ${masterSystemMatch[1]}\n`
      if (masterLangMatch) result += `• **Master Language**: ${masterLangMatch[1]}\n`
      if (typeMatch) result += `• **Object Type**: ${typeMatch[1]}\n`
      if (versionMatch) result += `• **Version**: ${versionMatch[1]}\n`
      if (createdByMatch) result += `• **Created By**: ${createdByMatch[1]}\n`
      if (changedByMatch) result += `• **Last Changed By**: ${changedByMatch[1]}\n`
      if (changedAtMatch) {
        const date = new Date(changedAtMatch[1])
        result += `• **Last Changed**: ${date.toLocaleString()}\n`
      }
      result += `\n`

      // 包信息
      const packageMatch = xmlContent.match(
        /<adtcore:packageRef[^>]*adtcore:name="([^"]+)"[^>]*adtcore:description="([^"]+)"/
      )
      if (packageMatch) {
        result += `**📦 Package**: ${packageMatch[1]} - ${packageMatch[2]}\n\n`
      }

      // 对数据元素 - 提取所有可用信息
      if (isDataElement) {
        // 类型定义
        const typeKindMatch = xmlContent.match(/<dtel:typeKind>([^<]+)<\/dtel:typeKind>/)
        const typeNameMatch = xmlContent.match(/<dtel:typeName>([^<]+)<\/dtel:typeName>/)
        const domainMatch = xmlContent.match(/<dtel:domainName>([^<]+)<\/dtel:domainName>/)
        const dataTypeMatch = xmlContent.match(/<dtel:dataType>([^<]+)<\/dtel:dataType>/)
        const dataTypeLengthMatch = xmlContent.match(
          /<dtel:dataTypeLength>(\d+)<\/dtel:dataTypeLength>/
        )
        const dataTypeDecimalsMatch = xmlContent.match(
          /<dtel:dataTypeDecimals>(\d+)<\/dtel:dataTypeDecimals>/
        )
        const lengthMatch = xmlContent.match(/<dtel:length>(\d+)<\/dtel:length>/)
        const decimalsMatch = xmlContent.match(/<dtel:decimals>(\d+)<\/dtel:decimals>/)

        result += `**🔧 Technical Details:**\n`
        if (typeKindMatch) result += `• **Type Kind**: ${typeKindMatch[1]}\n`
        if (typeNameMatch) result += `• **Type Name**: \`${typeNameMatch[1]}\`\n`
        if (domainMatch) result += `• **Domain**: \`${domainMatch[1]}\`\n`
        if (dataTypeMatch) result += `• **Data Type**: ${dataTypeMatch[1]}\n`
        if (dataTypeLengthMatch && parseInt(dataTypeLengthMatch[1]) > 0)
          result += `• **Data Type Length**: ${parseInt(dataTypeLengthMatch[1])}\n`
        if (lengthMatch && parseInt(lengthMatch[1]) > 0)
          result += `• **Length**: ${parseInt(lengthMatch[1])}\n`
        if (dataTypeDecimalsMatch && parseInt(dataTypeDecimalsMatch[1]) > 0)
          result += `• **Data Type Decimals**: ${parseInt(dataTypeDecimalsMatch[1])}\n`
        if (decimalsMatch && parseInt(decimalsMatch[1]) > 0)
          result += `• **Decimals**: ${parseInt(decimalsMatch[1])}\n`
        result += `\n`

        // 字段标签（所有变体）
        const shortFieldLabelMatch = xmlContent.match(
          /<dtel:shortFieldLabel>([^<]+)<\/dtel:shortFieldLabel>/
        )
        const shortFieldLengthMatch = xmlContent.match(
          /<dtel:shortFieldLength>(\d+)<\/dtel:shortFieldLength>/
        )
        const shortFieldMaxLengthMatch = xmlContent.match(
          /<dtel:shortFieldMaxLength>(\d+)<\/dtel:shortFieldMaxLength>/
        )
        const mediumFieldLabelMatch = xmlContent.match(
          /<dtel:mediumFieldLabel>([^<]+)<\/dtel:mediumFieldLabel>/
        )
        const mediumFieldLengthMatch = xmlContent.match(
          /<dtel:mediumFieldLength>(\d+)<\/dtel:mediumFieldLength>/
        )
        const mediumFieldMaxLengthMatch = xmlContent.match(
          /<dtel:mediumFieldMaxLength>(\d+)<\/dtel:mediumFieldMaxLength>/
        )
        const longFieldLabelMatch = xmlContent.match(
          /<dtel:longFieldLabel>([^<]+)<\/dtel:longFieldLabel>/
        )
        const longFieldLengthMatch = xmlContent.match(
          /<dtel:longFieldLength>(\d+)<\/dtel:longFieldLength>/
        )
        const longFieldMaxLengthMatch = xmlContent.match(
          /<dtel:longFieldMaxLength>(\d+)<\/dtel:longFieldMaxLength>/
        )
        const headingFieldLabelMatch = xmlContent.match(
          /<dtel:headingFieldLabel>([^<]+)<\/dtel:headingFieldLabel>/
        )
        const headingFieldLengthMatch = xmlContent.match(
          /<dtel:headingFieldLength>(\d+)<\/dtel:headingFieldLength>/
        )
        const headingFieldMaxLengthMatch = xmlContent.match(
          /<dtel:headingFieldMaxLength>(\d+)<\/dtel:headingFieldMaxLength>/
        )

        // 旧版字段标签字段
        const shortTextMatch = xmlContent.match(/<dtel:shortText>([^<]+)<\/dtel:shortText>/)
        const mediumTextMatch = xmlContent.match(/<dtel:mediumText>([^<]+)<\/dtel:mediumText>/)
        const longTextMatch = xmlContent.match(/<dtel:longText>([^<]+)<\/dtel:longText>/)
        const headingMatch = xmlContent.match(/<dtel:heading>([^<]+)<\/dtel:heading>/)

        if (
          shortFieldLabelMatch ||
          mediumFieldLabelMatch ||
          longFieldLabelMatch ||
          headingFieldLabelMatch ||
          shortTextMatch ||
          mediumTextMatch ||
          longTextMatch ||
          headingMatch
        ) {
          result += `**🏷️ Field Labels:**\n`
          if (shortFieldLabelMatch)
            result += `• **Short Label**: "${shortFieldLabelMatch[1]}" (${shortFieldLengthMatch ? shortFieldLengthMatch[1] : "?"}/${shortFieldMaxLengthMatch ? shortFieldMaxLengthMatch[1] : "?"})\n`
          if (mediumFieldLabelMatch)
            result += `• **Medium Label**: "${mediumFieldLabelMatch[1]}" (${mediumFieldLengthMatch ? mediumFieldLengthMatch[1] : "?"}/${mediumFieldMaxLengthMatch ? mediumFieldMaxLengthMatch[1] : "?"})\n`
          if (longFieldLabelMatch)
            result += `• **Long Label**: "${longFieldLabelMatch[1]}" (${longFieldLengthMatch ? longFieldLengthMatch[1] : "?"}/${longFieldMaxLengthMatch ? longFieldMaxLengthMatch[1] : "?"})\n`
          if (headingFieldLabelMatch)
            result += `• **Heading**: "${headingFieldLabelMatch[1]}" (${headingFieldLengthMatch ? headingFieldLengthMatch[1] : "?"}/${headingFieldMaxLengthMatch ? headingFieldMaxLengthMatch[1] : "?"})\n`

          // 如果旧版标签存在而新版不存在，显示旧版
          if (!shortFieldLabelMatch && shortTextMatch)
            result += `• **Short Text**: ${shortTextMatch[1]}\n`
          if (!mediumFieldLabelMatch && mediumTextMatch)
            result += `• **Medium Text**: ${mediumTextMatch[1]}\n`
          if (!longFieldLabelMatch && longTextMatch)
            result += `• **Long Text**: ${longTextMatch[1]}\n`
          if (!headingFieldLabelMatch && headingMatch)
            result += `• **Heading**: ${headingMatch[1]}\n`
          result += `\n`
        }

        // 附加字段属性
        const searchHelpMatch = xmlContent.match(/<dtel:searchHelp>([^<]+)<\/dtel:searchHelp>/)
        const searchHelpParameterMatch = xmlContent.match(
          /<dtel:searchHelpParameter>([^<]+)<\/dtel:searchHelpParameter>/
        )
        const setGetParameterMatch = xmlContent.match(
          /<dtel:setGetParameter>([^<]+)<\/dtel:setGetParameter>/
        )
        const defaultComponentNameMatch = xmlContent.match(
          /<dtel:defaultComponentName>([^<]+)<\/dtel:defaultComponentName>/
        )
        const deactivateInputHistoryMatch = xmlContent.match(
          /<dtel:deactivateInputHistory>([^<]+)<\/dtel:deactivateInputHistory>/
        )
        const changeDocumentMatch = xmlContent.match(
          /<dtel:changeDocument>([^<]+)<\/dtel:changeDocument>/
        )
        const leftToRightDirectionMatch = xmlContent.match(
          /<dtel:leftToRightDirection>([^<]+)<\/dtel:leftToRightDirection>/
        )
        const deactivateBIDIFilteringMatch = xmlContent.match(
          /<dtel:deactivateBIDIFiltering>([^<]+)<\/dtel:deactivateBIDIFiltering>/
        )

        if (
          searchHelpMatch ||
          searchHelpParameterMatch ||
          setGetParameterMatch ||
          defaultComponentNameMatch ||
          deactivateInputHistoryMatch ||
          changeDocumentMatch ||
          leftToRightDirectionMatch ||
          deactivateBIDIFilteringMatch
        ) {
          result += `**⚙️ Field Properties:**\n`
          if (searchHelpMatch && searchHelpMatch[1])
            result += `• **Search Help**: ${searchHelpMatch[1]}\n`
          if (searchHelpParameterMatch && searchHelpParameterMatch[1])
            result += `• **Search Help Parameter**: ${searchHelpParameterMatch[1]}\n`
          if (setGetParameterMatch && setGetParameterMatch[1])
            result += `• **Set/Get Parameter**: ${setGetParameterMatch[1]}\n`
          if (defaultComponentNameMatch && defaultComponentNameMatch[1])
            result += `• **Default Component Name**: ${defaultComponentNameMatch[1]}\n`
          if (deactivateInputHistoryMatch)
            result += `• **Deactivate Input History**: ${deactivateInputHistoryMatch[1]}\n`
          if (changeDocumentMatch) result += `• **Change Document**: ${changeDocumentMatch[1]}\n`
          if (leftToRightDirectionMatch)
            result += `• **Left-to-Right Direction**: ${leftToRightDirectionMatch[1]}\n`
          if (deactivateBIDIFilteringMatch)
            result += `• **Deactivate BIDI Filtering**: ${deactivateBIDIFilteringMatch[1]}\n`
          result += `\n`
        }
      }

      // 对结构 - 可用时提取字段信息
      if (isStructure) {
        // 尝试提取组件信息
        const componentMatches = xmlContent.match(/<stru:component[^>]*>/g)
        if (componentMatches && componentMatches.length > 0) {
          result += `**🔧 Structure Components:**\n`
          result += `• **Number of Fields**: ${componentMatches.length}\n`
          result += `• Contains multiple data fields with their own types and properties\n\n`
        }
      }

      // 使用示例
      result += `**💡 Usage Examples:**\n`
      result += `\`\`\`abap\n`
      if (isDataElement) {
        result += `" Variable declaration\n`
        result += `DATA: lv_field TYPE ${objectName.toLowerCase()}.\n\n`
        result += `" Parameter declaration\n`
        result += `PARAMETERS: p_value TYPE ${objectName.toLowerCase()}.\n`
      } else if (isStructure) {
        result += `" Structure declaration\n`
        result += `DATA: ls_struct TYPE ${objectName.toLowerCase()}.\n\n`
        result += `" Access structure components\n`
        result += `ls_struct-field1 = 'value'.\n`
        result += `WRITE: ls_struct-field2.\n`
      } else {
        result += `" Declaration\n`
        result += `DATA: lv_var TYPE ${objectName.toLowerCase()}.\n`
      }
      result += `\`\`\``
    } catch (error) {
      this.log?.(`[V2] ❌ Error parsing structure/data element XML: ${error}`)
      result = `**Dictionary Object**: ${objectName}\n\nError parsing XML: ${error}`
    }

    return result
  }

  private parseTableXml(xmlContent: string, objectName: string): string {
    let result = ""

    try {
      // 提取所有核心属性
      const nameMatch = xmlContent.match(/adtcore:name="([^"]+)"/)
      const descMatch = xmlContent.match(/adtcore:description="([^"]+)"/)
      const responsibleMatch = xmlContent.match(/adtcore:responsible="([^"]+)"/)
      const masterLangMatch = xmlContent.match(/adtcore:masterLanguage="([^"]+)"/)
      const masterSystemMatch = xmlContent.match(/adtcore:masterSystem="([^"]+)"/)
      const changedByMatch = xmlContent.match(/adtcore:changedBy="([^"]+)"/)
      const changedAtMatch = xmlContent.match(/adtcore:changedAt="([^"]+)"/)
      const createdByMatch = xmlContent.match(/adtcore:createdBy="([^"]+)"/)
      const versionMatch = xmlContent.match(/adtcore:version="([^"]+)"/)

      // 头部信息
      result += `🗃️ **Database Table**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`

      if (descMatch) {
        result += `**Description**: ${descMatch[1]}\n\n`
      }

      // 元数据
      result += `**📋 Metadata:**\n`
      if (responsibleMatch) result += `• **Responsible**: ${responsibleMatch[1]}\n`
      if (masterSystemMatch) result += `• **Master System**: ${masterSystemMatch[1]}\n`
      if (masterLangMatch) result += `• **Master Language**: ${masterLangMatch[1]}\n`
      if (versionMatch) result += `• **Version**: ${versionMatch[1]}\n`
      if (createdByMatch) result += `• **Created By**: ${createdByMatch[1]}\n`
      if (changedByMatch) result += `• **Last Changed By**: ${changedByMatch[1]}\n`
      if (changedAtMatch) {
        const date = new Date(changedAtMatch[1])
        result += `• **Last Changed**: ${date.toLocaleString()}\n`
      }
      result += `\n`

      // 包信息
      const packageMatch = xmlContent.match(
        /<adtcore:packageRef[^>]*adtcore:name="([^"]+)"[^>]*adtcore:description="([^"]+)"/
      )
      if (packageMatch) {
        result += `**📦 Package**: ${packageMatch[1]} - ${packageMatch[2]}\n\n`
      }

      // 技术细节
      const deliveryMatch = xmlContent.match(/<tabl:deliveryClass>([^<]+)<\/tabl:deliveryClass>/)
      const categoryMatch = xmlContent.match(/<tabl:dataClass>([^<]+)<\/tabl:dataClass>/)
      const sizeMatch = xmlContent.match(/<tabl:sizeCategory>([^<]+)<\/tabl:sizeCategory>/)
      const bufferMatch = xmlContent.match(/<tabl:buffering>([^<]+)<\/tabl:buffering>/)
      const logMatch = xmlContent.match(/<tabl:logging>([^<]+)<\/tabl:logging>/)

      result += `**🔧 Technical Settings:**\n`
      if (deliveryMatch) {
        const deliveryDesc =
          {
            A: "Application table (master and transaction data)",
            C: "Customer table",
            G: "Customer table, changes to repository",
            E: "Control table",
            S: "System table",
            W: "System table (display/maintenance via SAP)"
          }[deliveryMatch[1]] || deliveryMatch[1]
        result += `• **Delivery Class**: ${deliveryMatch[1]} - ${deliveryDesc}\n`
      }
      if (categoryMatch) result += `• **Data Class**: ${categoryMatch[1]}\n`
      if (sizeMatch) result += `• **Size Category**: ${sizeMatch[1]}\n`
      if (bufferMatch) result += `• **Buffering**: ${bufferMatch[1]}\n`
      if (logMatch) result += `• **Logging**: ${logMatch[1]}\n`
      result += `\n`

      // 字段信息（可用时）
      const fieldMatches = xmlContent.match(/<tabl:field[^>]*>/g)
      if (fieldMatches && fieldMatches.length > 0) {
        result += `**📊 Table Structure:**\n`
        result += `• **Number of Fields**: ${fieldMatches.length}\n`
        result += `• Contains table fields with their data types and properties\n\n`
      }

      // 主键（可用时）
      const keyFieldMatches = xmlContent.match(/<tabl:keyField[^>]*>/g)
      if (keyFieldMatches && keyFieldMatches.length > 0) {
        result += `**🔑 Primary Key:**\n`
        result += `• **Key Fields**: ${keyFieldMatches.length}\n\n`
      }

      // 索引（可用时）
      const indexMatches = xmlContent.match(/<tabl:index[^>]*>/g)
      if (indexMatches && indexMatches.length > 0) {
        result += `**📇 Indexes:**\n`
        result += `• **Number of Indexes**: ${indexMatches.length}\n\n`
      }

      // 使用示例
      result += `**💡 Usage Examples:**\n`
      result += `\`\`\`abap\n`
      result += `" Select data\n`
      result += `SELECT * FROM ${objectName.toLowerCase()}\n`
      result += `  INTO TABLE @DATA(lt_data)\n`
      result += `  WHERE field1 = @lv_value.\n\n`
      result += `" Insert data\n`
      result += `INSERT ${objectName.toLowerCase()} FROM @ls_record.\n\n`
      result += `" Update data\n`
      result += `UPDATE ${objectName.toLowerCase()}\n`
      result += `  SET field2 = @lv_new_value\n`
      result += `  WHERE field1 = @lv_key.\n`
      result += `\`\`\``
    } catch (error) {
      this.log?.(`[V2] ❌ Error parsing table XML: ${error}`)
      result = `**Database Table**: ${objectName}\n\nError parsing XML: ${error}`
    }

    return result
  }

  private parseDomainXml(xmlContent: string, objectName: string): string {
    let result = ""

    try {
      // 提取所有核心属性
      const nameMatch = xmlContent.match(/adtcore:name="([^"]+)"/)
      const descMatch = xmlContent.match(/adtcore:description="([^"]+)"/)
      const responsibleMatch = xmlContent.match(/adtcore:responsible="([^"]+)"/)
      const masterLangMatch = xmlContent.match(/adtcore:masterLanguage="([^"]+)"/)
      const masterSystemMatch = xmlContent.match(/adtcore:masterSystem="([^"]+)"/)
      const changedByMatch = xmlContent.match(/adtcore:changedBy="([^"]+)"/)
      const changedAtMatch = xmlContent.match(/adtcore:changedAt="([^"]+)"/)
      const createdByMatch = xmlContent.match(/adtcore:createdBy="([^"]+)"/)
      const versionMatch = xmlContent.match(/adtcore:version="([^"]+)"/)

      // 头部信息
      result += `🔧 **Domain**: \`${nameMatch ? nameMatch[1] : objectName}\`\n\n`

      if (descMatch) {
        result += `**Description**: ${descMatch[1]}\n\n`
      }

      // 元数据
      result += `**📋 Metadata:**\n`
      if (responsibleMatch) result += `• **Responsible**: ${responsibleMatch[1]}\n`
      if (masterSystemMatch) result += `• **Master System**: ${masterSystemMatch[1]}\n`
      if (masterLangMatch) result += `• **Master Language**: ${masterLangMatch[1]}\n`
      if (versionMatch) result += `• **Version**: ${versionMatch[1]}\n`
      if (createdByMatch) result += `• **Created By**: ${createdByMatch[1]}\n`
      if (changedByMatch) result += `• **Last Changed By**: ${changedByMatch[1]}\n`
      if (changedAtMatch) {
        const date = new Date(changedAtMatch[1])
        result += `• **Last Changed**: ${date.toLocaleString()}\n`
      }
      result += `\n`

      // 包信息
      const packageMatch = xmlContent.match(
        /<adtcore:packageRef[^>]*adtcore:name="([^"]+)"[^>]*adtcore:description="([^"]+)"/
      )
      if (packageMatch) {
        result += `**📦 Package**: ${packageMatch[1]} - ${packageMatch[2]}\n\n`
      }

      // 技术数据类型信息
      const dataTypeMatch = xmlContent.match(/<doma:dataType>([^<]+)<\/doma:dataType>/)
      const lengthMatch = xmlContent.match(/<doma:length>(\d+)<\/doma:length>/)
      const decimalsMatch = xmlContent.match(/<doma:decimals>(\d+)<\/doma:decimals>/)
      const outputLengthMatch = xmlContent.match(/<doma:outputLength>(\d+)<\/doma:outputLength>/)
      const signedMatch = xmlContent.match(/<doma:signed>([^<]+)<\/doma:signed>/)
      const lowercaseMatch = xmlContent.match(/<doma:lowercase>([^<]+)<\/doma:lowercase>/)

      result += `**🔧 Technical Definition:**\n`
      if (dataTypeMatch) {
        const dataTypeDesc =
          {
            CHAR: "Character",
            NUMC: "Numeric Character",
            DEC: "Decimal",
            INT1: "1-byte Integer",
            INT2: "2-byte Integer",
            INT4: "4-byte Integer",
            INT8: "8-byte Integer",
            FLTP: "Floating Point",
            CURR: "Currency",
            QUAN: "Quantity",
            DATS: "Date",
            TIMS: "Time",
            RAW: "Raw Data",
            LANG: "Language Key",
            UNIT: "Unit of Measure",
            ACCP: "Accounting Period",
            PREC: "Precision",
            CLNT: "Client"
          }[dataTypeMatch[1]] || dataTypeMatch[1]
        result += `• **Data Type**: ${dataTypeMatch[1]} (${dataTypeDesc})\n`
      }
      if (lengthMatch && parseInt(lengthMatch[1]) > 0)
        result += `• **Length**: ${parseInt(lengthMatch[1])}\n`
      if (decimalsMatch && parseInt(decimalsMatch[1]) > 0)
        result += `• **Decimals**: ${parseInt(decimalsMatch[1])}\n`
      if (outputLengthMatch && parseInt(outputLengthMatch[1]) > 0)
        result += `• **Output Length**: ${parseInt(outputLengthMatch[1])}\n`
      if (signedMatch) result += `• **Signed**: ${signedMatch[1]}\n`
      if (lowercaseMatch) result += `• **Lowercase Allowed**: ${lowercaseMatch[1]}\n`
      result += `\n`

      // 值范围信息
      const valueRangeMatch = xmlContent.match(/<doma:valueRange[^>]*>/)
      if (valueRangeMatch) {
        result += `**📊 Value Range:**\n`

        // 固定值
        const fixedValueMatches = xmlContent.match(
          /<doma:fixedValue[^>]*doma:value="([^"]*)"[^>]*doma:description="([^"]*)"/g
        )
        if (fixedValueMatches && fixedValueMatches.length > 0) {
          result += `• **Fixed Values**: ${fixedValueMatches.length} defined\n`
          fixedValueMatches.slice(0, 5).forEach(match => {
            const valueMatch = match.match(/doma:value="([^"]*)"/)
            const descMatch = match.match(/doma:description="([^"]*)"/)
            if (valueMatch) {
              result += `  - \`${valueMatch[1]}\``
              if (descMatch && descMatch[1]) {
                result += `: ${descMatch[1]}`
              }
              result += `\n`
            }
          })
          if (fixedValueMatches.length > 5) {
            result += `  - ... and ${fixedValueMatches.length - 5} more\n`
          }
        }

        // 间隔
        const intervalMatches = xmlContent.match(/<doma:interval[^>]*>/g)
        if (intervalMatches && intervalMatches.length > 0) {
          result += `• **Intervals**: ${intervalMatches.length} defined\n`
        }

        result += `\n`
      }

      // 转换出口
      const conversionExitMatch = xmlContent.match(
        /<doma:conversionExit>([^<]+)<\/doma:conversionExit>/
      )
      if (conversionExitMatch) {
        result += `**🔄 Conversion Exit**: ${conversionExitMatch[1]}\n\n`
      }

      // 使用示例
      result += `**💡 Usage Examples:**\n`
      result += `\`\`\`abap\n`
      result += `" Data element using this domain\n`
      result += `" (Domain defines technical characteristics)\n`
      result += `DATA: lv_field TYPE some_data_element_using_${objectName.toLowerCase()}.\n\n`
      result += `" Direct usage (rare)\n`
      result += `DATA: lv_direct TYPE ${objectName.toLowerCase()}.\n`
      result += `\`\`\``
    } catch (error) {
      this.log?.(`[V2] ❌ Error parsing domain XML: ${error}`)
      result = `**Domain**: ${objectName}\n\nError parsing XML: ${error}`
    }

    return result
  }

  // ============================================================================
  // 回退与上下文悬停
  // ============================================================================

  private getContextAwareHover(word: string, line: string): vscode.MarkdownString | undefined {
    const lineUpper = line.toUpperCase()

    if (lineUpper.includes("MESSAGE") && lineUpper.includes("TYPE")) {
      const messageTypes: { [key: string]: string } = {
        I: "Information",
        S: "Success",
        W: "Warning",
        E: "Error",
        A: "Abort",
        X: "Exit (short dump)"
      }
      const type = word.toUpperCase()
      if (messageTypes[type]) {
        const markdown = new vscode.MarkdownString()
        markdown.supportHtml = true
        markdown.appendMarkdown(`💬 **Message Type**: \`${type}\`\n\n`)
        markdown.appendMarkdown(`**Description**: ${messageTypes[type]}\n\n`)
        markdown.appendCodeblock(`MESSAGE 'Your message' TYPE '${type}'.`, "abap")
        return markdown
      }
    }
    return undefined
  }

  private getBuiltInTypeHover(word: string): vscode.MarkdownString | undefined {
    const builtInTypes: { [key: string]: string } = {
      STRING: "Variable-length character string.",
      I: "4-byte integer.",
      C: "Fixed-length character string.",
      D: "Date field (YYYYMMDD).",
      T: "Time field (HHMMSS).",
      P: "Packed number (decimal).",
      F: "Floating point number.",
      XSTRING: "Variable-length byte string.",
      X: "Fixed-length byte string."
    }

    const typeInfo = builtInTypes[word.toUpperCase()]
    if (typeInfo) {
      const markdown = new vscode.MarkdownString()
      markdown.supportHtml = true
      markdown.appendMarkdown(`🔤 **Built-in Type**: \`${word.toUpperCase()}\`\n\n`)
      markdown.appendMarkdown(`**Description**: ${typeInfo}\n\n`)
      markdown.appendCodeblock(`DATA my_var TYPE ${word.toLowerCase()}.`, "abap")
      return markdown
    }
    return undefined
  }

  private async getTextSymbolHover(
    word: string,
    document: vscode.TextDocument
  ): Promise<vscode.MarkdownString | undefined> {
    // 检查是否为文本符号（TEXT-001、TEXT-002 等）
    const textSymbolMatch = word.match(/^TEXT-(\d{3})$/i)
    if (!textSymbolMatch) return undefined

    const textId = textSymbolMatch[1]
    // this.log?.(`[V2] 🔍 Searching for text symbol: ${word}`);

    // 只尝试在当前文档中查找文本 - 不尝试 SAP 客户端
    return await this.searchTextElementInProgram(word, textId, document)
  }

  private async searchTextElementInProgram(
    word: string,
    textId: string,
    document: vscode.TextDocument
  ): Promise<vscode.MarkdownString | undefined> {
    try {
      // 在当前文档中搜索文本元素定义
      const documentText = document.getText()

      // 在注释或文本元素部分中查找文本元素定义
      const textDefPatterns = [
        new RegExp(`TEXT-${textId}\\s*['"]([^'"]+)['"]`, "i"),
        new RegExp(`${textId}\\s*['"]([^'"]+)['"].*TEXT-${textId}`, "i"),
        new RegExp(`TEXT-${textId}.*?['"]([^'"]+)['"]`, "i")
      ]

      for (const pattern of textDefPatterns) {
        const match = documentText.match(pattern)
        if (match) {
          const textContent = match[1]
          const markdown = new vscode.MarkdownString()
          markdown.supportHtml = true

          markdown.appendMarkdown(`📝 **Text Symbol**: \`${word}\`\n\n`)
          markdown.appendMarkdown(`**Text**: "${textContent}"\n\n`)
          markdown.appendMarkdown(`*Found in current program*\n\n`)
          markdown.appendMarkdown(`**Usage Examples:**\n`)
          markdown.appendCodeblock(
            `MESSAGE ${word} TYPE 'I'.\n" Display as message\n\nWRITE: / ${word}.\n" Display as output`,
            "abap"
          )

          return markdown
        }
      }
    } catch (error) {
      this.log?.(`[V2] ❌ Error searching text element in program: ${error}`)
    }

    return undefined
  }

  private async isMethodDeclaration(
    doc: vscode.TextDocument,
    startLine: number,
    definitionText: string,
    word: string
  ): Promise<boolean> {
    try {
      // 检查定义行是否只包含标识符（无 ABAP 关键字）
      const cleanLine = definitionText.trim()
      const lineUpper = cleanLine.toUpperCase()

      // 如果行包含独立单词形式的 ABAP 关键字，则不是简单的方法声明
      const lineWords = lineUpper.split(/\s+/)
      const firstWord = lineWords[0]

      if (
        firstWord === "METHOD" ||
        firstWord === "DATA" ||
        firstWord === "TYPES" ||
        firstWord === "FUNCTION" ||
        firstWord === "CLASS" ||
        firstWord === "INCLUDE" ||
        firstWord === "PARAMETERS" ||
        firstWord === "TABLES"
      ) {
        return false
      }

      // 检查行是否主要只包含我们要查找的单词
      const words = cleanLine.split(/\s+/)
      if (words.length > 2) {
        return false // 单词太多，可能不是简单的方法声明
      }

      // 向前查找方法参数关键字
      let foundParameterKeyword = false
      for (let i = startLine + 1; i < Math.min(startLine + 10, doc.lineCount); i++) {
        const line = doc.lineAt(i).text
        const lineUpper = line.trim().toUpperCase()

        if (
          lineUpper.includes("IMPORTING") ||
          lineUpper.includes("EXPORTING") ||
          lineUpper.includes("CHANGING") ||
          lineUpper.includes("RETURNING")
        ) {
          foundParameterKeyword = true
          break
        }

        // 遇到不像方法参数的内容就停止
        if (
          lineUpper.includes("METHOD") ||
          lineUpper.includes("DATA") ||
          lineUpper.includes("ENDCLASS") ||
          lineUpper.includes("PRIVATE") ||
          lineUpper.includes("PUBLIC") ||
          lineUpper.includes("PROTECTED")
        ) {
          break
        }
      }

      // this.log?.(`[V2] 🔍 Method declaration check for "${word}": paramKeyword=${foundParameterKeyword}`);

      // 找到参数关键字就视为方法声明
      return foundParameterKeyword
    } catch (error) {
      //  this.log?.(`[V2] ⚠️ Error checking method declaration: ${error}`);
      return false
    }
  }

  private async extractMethodDeclaration(
    doc: vscode.TextDocument,
    startLine: number
  ): Promise<string | undefined> {
    try {
      //this.log?.(`[V2] 🔧 Extracting method declaration from line ${startLine + 1}`);

      let signatureText = ""

      for (let i = startLine; i < doc.lineCount; i++) {
        const line = doc.lineAt(i).text
        const trimmedLine = line.trim()

        if (trimmedLine.startsWith("*")) continue // 跳过整行注释

        const commentIndex = trimmedLine.indexOf('"')
        const lineContent =
          commentIndex !== -1 ? trimmedLine.substring(0, commentIndex) : trimmedLine

        // 在添加行之前检查停止条件

        // 找到结束方法声明的句点或逗号时停止
        if (lineContent.trim().includes(".") || lineContent.trim().includes(",")) {
          // 添加这最后一行然后停止
          signatureText += line + "\n"
          //  this.log?.(`[V2] ✅ Found method declaration end at line ${i + 1}`);
          break
        }

        // 遇到另一个方法或类部分时停止（不要包含这些行）
        const trimmedUpper = lineContent.trim().toUpperCase()
        if (i > startLine) {
          // 检查精确的 ABAP 部分关键字（不只是前缀）
          const words = trimmedUpper.split(/\s+/)
          const firstWord = words[0]

          if (
            firstWord === "METHOD" ||
            firstWord === "DATA:" ||
            firstWord === "DATA" ||
            firstWord === "PRIVATE" ||
            firstWord === "PUBLIC" ||
            firstWord === "PROTECTED" ||
            firstWord === "ENDCLASS" ||
            trimmedUpper === "METHODS:"
          ) {
            //  this.log?.(`[V2] 🛑 Hit new section at line ${i + 1}, stopping extraction`);
            break
          }
        }

        // 安全检查
        if (i - startLine > 30) {
          //  this.log?.(`[V2] ⚠️ Method declaration too long, truncating at line ${i + 1}`);
          break
        }

        // 走到这里就添加该行
        signatureText += line + "\n"
      }

      const finalSignature = signatureText.trim()
      //  this.log?.(`[V2] 📄 Extracted method declaration: ${finalSignature.length} chars`);

      return finalSignature.length > 0 ? finalSignature : undefined
    } catch (error) {
      //  this.log?.(`[V2] ❌ Error extracting method declaration: ${error}`);
      return undefined
    }
  }
}
