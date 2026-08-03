# 测试文档生成器

从测试截图生成专业的 Word 文档——按场景组织，带描述和自定义标题。适用于 Playwright 测试报告、手动 QA 证据和签字确认文档。

## 使用方法

打开 Copilot 聊天面板（`Ctrl+Alt+I`），描述你的场景并附上截图的完整路径：

```
Create test documentation with these screenshots:

Scenario 1: Login Happy Path

- C:\tests\login1.png - Login page displayed
- C:\tests\login2.png - Successful login confirmed

Scenario 2: Error Handling

- C:\tests\error1.png - Invalid credentials message shown
```

Copilot 调用生成器并把 `.docx` 文件保存到你的工作区。

## 文档包含什么

| 元素 | 详情 |
|---|---|
| 标题 | 自定义报告标题（默认 “Test Documentation Report”） |
| 日期 | DD-MM-YYYY 格式的测试日期（默认今天） |
| 场景 | 每个场景有独立章节，包含名称和描述 |
| 截图 | 嵌入的图片，每个截图带说明 |

## 提示

- 截图请使用**绝对路径**（例如 `C:\tests\...`），不要用相对路径
- 每个场景的截图数量和场景数量都不限
- 默认值不合适时，可以在提示中指定自定义标题或日期：*“使用标题 'Regression Test April' 和日期 30-04-2026”*
