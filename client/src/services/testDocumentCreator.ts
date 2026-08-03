/**
 * 测试文档创建服务
 * 从按场景组织的 Playwright 截图创建 Word 文档
 */

import * as vscode from "vscode"
import { funWindow as window } from "./funMessenger"
import * as path from "path"
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType } from "docx"

export interface TestScenario {
  scenarioId: number
  scenarioName: string
  scenarioDescription: string
  screenshots: Array<{
    filePath: string
    description: string
  }>
}

export interface TestDocumentOptions {
  scenarios: TestScenario[]
  reportTitle?: string
  testDate?: string
}

export class TestDocumentCreator {
  /**
   * 从测试场景和截图创建 Word 文档
   */
  async createDocument(options: TestDocumentOptions): Promise<Buffer> {
    const {
      scenarios,
      reportTitle = "Test Documentation Report",
      testDate = new Date().toISOString().split("T")[0]
    } = options

    // 创建文档章节
    const sections: Paragraph[] = []

    // 添加标题和页眉
    sections.push(
      new Paragraph({
        text: reportTitle,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Test Date: ${testDate}`,
            bold: true
          })
        ],
        spacing: { after: 400 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Generated: ${new Date().toLocaleString()}`,
            italics: true,
            size: 20
          })
        ],
        spacing: { after: 600 }
      })
    )

    // 处理每个场景
    for (const scenario of scenarios) {
      // 场景标题
      sections.push(
        new Paragraph({
          text: `Scenario ${scenario.scenarioId}: ${scenario.scenarioName}`,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 600, after: 200 }
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: scenario.scenarioDescription,
              italics: true
            })
          ],
          spacing: { after: 400 }
        })
      )

      // 处理此场景的截图
      for (let i = 0; i < scenario.screenshots.length; i++) {
        const screenshot = scenario.screenshots[i]

        try {
          // 读取图片文件
          const normalizedPath = path.normalize(screenshot.filePath)
          const imageUri = vscode.Uri.file(normalizedPath)
          const imageData = await vscode.workspace.fs.readFile(imageUri)

          // 添加截图描述
          sections.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${i + 1}. ${screenshot.description}`,
                  bold: true
                })
              ],
              spacing: { before: 300, after: 100 }
            })
          )

          // 添加带正确 PNG 格式规范的图片
          sections.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: imageData,
                  transformation: {
                    width: 600,
                    height: 400
                  },
                  type: "png"
                })
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 }
            })
          )
        } catch (imageError) {
          // 图片无法加载时添加错误消息
          sections.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${i + 1}. ${screenshot.description}`,
                  bold: true
                })
              ],
              spacing: { before: 300, after: 100 }
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `Error loading image: ${screenshot.filePath} - ${imageError}`,
                  color: "FF0000",
                  italics: true
                })
              ],
              spacing: { after: 400 }
            })
          )
        }
      }
    }

    // 创建文档
    const doc = new Document({
      sections: [
        {
          children: sections
        }
      ]
    })

    // 生成缓冲区
    return await Packer.toBuffer(doc)
  }

  /**
   * 显示保存对话框并保存文档
   */
  async saveDocument(documentBuffer: Buffer, defaultFileName?: string): Promise<string | null> {
    const fileName = defaultFileName || `test-documentation-${Date.now()}.docx`

    const saveUri = await window.showSaveDialog({
      defaultUri: vscode.Uri.file(fileName),
      filters: {
        "Word Documents": ["docx"],
        "All Files": ["*"]
      },
      title: "Save Test Documentation"
    })

    if (saveUri) {
      await vscode.workspace.fs.writeFile(saveUri, documentBuffer)
      return saveUri.fsPath
    }

    return null
  }
}
