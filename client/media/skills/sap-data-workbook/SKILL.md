---
name: sap-data-workbook
description: 创建 SAP 数据工作簿（.sapwb）用于 SAP 数据分析。当用户要求分析 SAP 数据、创建数据质量检查、构建报表、比较表、数据画像，或任何多步骤 SAP 数据探索时使用。工作簿有 ABAP SQL 单元格（查询 SAP）和 JavaScript 单元格（处理结果）。它们保存为文件并可重新运行。
argument-hint: '[要分析的数据或要构建的报表]'
user-invocable: true
disable-model-invocation: false
---

# SAP 数据工作簿 — 让 SAP 数据分析可复现

你创建 `.sapwb` 文件——带 ABAP SQL 和 JavaScript 单元格的 VS Code 笔记本，查询 SAP 并处理结果。用户打开文件点击“全部运行”。

## 何时创建工作簿

当用户想要以下内容时创建工作簿：
- 分析 SAP 数据（多表、聚合、比较）
- 构建数据质量检查或报表
- 表数据画像（行数、分布、离群值）
- 跨条件比较数据（例如“有近期订单的供应商 vs 没有的”）
- 任何需要多个查询、且后续查询依赖前面结果的任务

## 如何创建文件

强制要求：你必须按 1→2→3 顺序执行。不要创建带单元格的文件。不要跳过读回步骤。

1. 创建 `.sapwb` 文件，只带元数据和空 cells 数组：`{"version": 1, "title": "Your Title", "cells": []}`
2. 读回文件确认已创建。
3. 现在用笔记本编辑工具插入所有单元格（包括第一个 markdown 单元格）。插入单元格时，SQL 单元格用语言 `"abap-sql"`（**不是** `"sql"`），JS 单元格用 `"javascript"`，markdown 单元格用 `"markdown"`。

## 文件格式

`.sapwb` 文件是 JSON：

```json
{
  "version": 1,
  "title": "Descriptive Title",
  "cells": [
    { "type": "markdown", "content": "# Title\nExplanation" },
    { "type": "abap-sql", "content": "SELECT matnr, mtart FROM mara WHERE mtart = 'FERT'" },
    { "type": "javascript", "content": "const rows = cells[1].result;\nreturn rows.map(r => ({ MATNR: r.MATNR, MTART: r.MTART }));" },
    { "type": "abap-sql", "content": "SELECT matnr, werks FROM marc WHERE matnr = ${cells[2].result[0].MATNR}" }
  ]
}
```

## 关键规则

1. **获取 ABAP SQL 语法。** 编写 SQL 单元格前调用 `get_abap_sql_syntax`。ABAP SQL 与标准 SQL 不同（表~字段用波浪号、无分号等）。

2. **单元格类型只能是：** `"abap-sql"`、`"javascript"` 或 `"markdown"`。不能有其他值。

3. **SQL 单元格**通过 ADT 执行 ABAP SQL。只允许 SELECT 和 WITH。无 DML。无分号。

4. **JavaScript 单元格**在隔离的工作线程中运行。通过 `cells[N].result` 访问前一个单元格的结果：
   - `cells[N]` 从 **0 开始且包含所有单元格**（markdown、SQL 和 JS）。以 markdown 单元格开头的工作簿意味着第一个 SQL 单元格是 `cells[1]`，不是 `cells[0]`。
   - SQL 单元格结果是对象数组：`[{FIELD1: "val", FIELD2: "val"}, ...]`
   - JS 单元格结果是单元格返回的任何内容
   - 始终以 `return <value>` 结尾。没有 `return` 的 JS 单元格输出 `undefined`。不需要值就用 `return null`。
   - **输出渲染：** 返回**对象数组**渲染为表格（表格数据首选）。返回**带嵌套数组的普通对象**不渲染为表格。返回**字符串**渲染为文本。`console.log()` 显示为结果上方的诊断输出——不要依赖它作为主要输出。

5. **SQL 插值：** SQL 单元格可以用 `${cells[N].result.path}` 引用先前结果。这在执行前解析。**字符串自动加单引号——不要在插值表达式周围加自己的引号。** 数组用逗号连接（每个元素自动加引号）。数字裸插入。

6. **SAP 255 字符 SQL 字面量限制。** 只要单个字面量超过 255 个字符，SAP ADT 就拒绝该 SQL。这意味着把大数组插值到 `IN (...)` 子句**会失败**。**绝不要把可能超过约 10 个值的数组插值到 SQL 中。** 改为用 JavaScript 单元格小批量循环并以编程方式过滤结果。例如，不要写 `SELECT ... WHERE matnr IN (${cells[1].result.ids})`，而是写一个 JS 单元格获取完整结果集并用 `cells[1].result` 过滤它。

7. **maxRows** 是每个 SQL 单元格的可选属性（默认 1000）。按用户需要的行数设置。它直接映射到 ADT 的 maxRows 参数：`{ "type": "abap-sql", "content": "...", "maxRows": 50000 }`

8. **每个工作簿以解释其用途的 markdown 单元格开头。**

9. **文件路径：** 写到用户的工作区根目录或 `workbooks/` 子文件夹。

## 单元格引用示例

```javascript
// 访问 SQL 结果（行对象数组）
const allRows = cells[1].result;              // 完整数组
const firstRow = cells[1].result[0];          // 第一行
const value = cells[1].result[0].MATNR;       // 特定字段

// 访问 JS 单元格结果
const count = cells[2].result;                // 如果单元格 2 返回数字
const obj = cells[2].result.vendorIds;        // 如果单元格 2 返回对象

// 在 SQL 插值中使用（字符串自动加引号——不要加引号）
// "SELECT ... WHERE matnr = ${cells[2].result}"
// "SELECT ... WHERE lifnr IN (${cells[3].result.ids})"  -- 数组自动用逗号连接
```

## 示例：数据质量工作簿

```json
{
  "version": 1,
  "title": "Material Master Data Quality Check",
  "cells": [
    {
      "type": "markdown",
      "content": "# Material Master Data Quality\nChecks for materials missing descriptions, invalid UoM, and orphaned records."
    },
    {
      "type": "abap-sql",
      "content": "SELECT matnr, mtart, matkl, meins FROM mara WHERE ersda > '20250101'"
    },
    {
      "type": "javascript",
      "content": "const materials = cells[1].result;\nconst noUoM = materials.filter(m => !m.MEINS || m.MEINS.trim() === '');\nconst noGroup = materials.filter(m => !m.MATKL || m.MATKL.trim() === '');\nreturn {\n  total: materials.length,\n  missingUoM: noUoM.length,\n  missingGroup: noGroup.length,\n  issues: [...noUoM.slice(0, 10), ...noGroup.slice(0, 10)]\n};"
    },
    {
      "type": "markdown",
      "content": "## Results Summary\nThe JavaScript cell above returns counts and sample issues. Review the output for materials that need attention."
    }
  ]
}
```
