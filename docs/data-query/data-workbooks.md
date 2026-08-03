# SAP 数据工作簿（.sapwb）

SAP 数据工作簿是 VS Code 笔记本，将 ABAP SQL 查询、JavaScript 处理和 Markdown 组合在单个可复用的 `.sapwb` 文件中。用于多步骤数据分析、数据质量检查和跨系统比较。

## 创建工作簿

1. 打开命令面板（`Ctrl+Shift+P`）
2. 运行 **ABAP FS: New SAP Data Workbook**

或者，创建任何带 `.sapwb` 扩展名的文件，或让 Copilot：*“创建一个分析物料主数据质量的工作簿。”*

## 单元格类型

| 类型 | 用途 |
|------|---------|
| **Markdown** | 章节标题、备注、文档 |
| **ABAP SQL** | 查询 SAP 表（仅 `SELECT` 和 `WITH`——不支持 DML） |
| **JavaScript** | 处理、过滤或比较前面单元格的结果 |

## 核心概念

**运行单元格**

- 用运行按钮或 `Shift+Enter` 运行单个单元格。会提示你选择 SAP 系统。
- **全部运行**（`Ctrl+Shift+Enter`）只提示一次，所有 SQL 单元格都使用该系统。

**在单元格之间引用结果**

- 在 **JavaScript** 中：通过 `cells[N].result` 访问前一个单元格的行（从 0 开始，所以单元格 2 是 `cells[1]`）。
- 在 **ABAP SQL** 中：使用 `${...}` 插值前面的结果。字符串自动加引号；数组自动连接用于 `IN` 子句。

```sql
-- 使用单元格 2（索引 1）的结果作为过滤条件
SELECT matnr, werks FROM marc
  WHERE matnr IN (${cells[1].result.map(r => r.MATNR)})
```

**行数限制**

每个 SQL 单元格有可配置的行数限制（默认：1000）。用 **ABAP FS: Set Cell Max Rows** 调整。

## 示例：数据质量检查

```
单元格 1（Markdown）：   # 物料数据质量检查
单元格 2（ABAP SQL）：   SELECT matnr, mtart, meins FROM mara WHERE mtart = 'FERT'
单元格 3（JavaScript）： const rows = cells[1].result;
                         return rows.filter(r => !r.MEINS).length + " materials missing UoM";
单元格 4（ABAP SQL）：   SELECT matnr, werks FROM marc
                         WHERE matnr IN (${cells[1].result.map(r => r.MATNR)})
```

## 示例：跨系统比较

通过单独执行单元格并每次选择不同系统，对两个系统运行相同查询。然后用 JavaScript 单元格对比结果。

```
单元格 1（Markdown）：   # 定价条件对比：DEV vs QAS
单元格 2（ABAP SQL）：   SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
                         → 运行，选择 DEV
单元格 3（ABAP SQL）：   SELECT KSCHL, VKORG, MATNR, KBETR FROM A005 WHERE KSCHL = 'ZPR1'
                         → 运行，选择 QAS
单元格 4（JavaScript）： const devMap = new Map(
                         cells[1].result.map(r => [r.KSCHL + r.VKORG + r.MATNR, r])
                       );
                         return cells[2].result
                         .filter(r => {
                           const d = devMap.get(r.KSCHL + r.VKORG + r.MATNR);
                           return d && d.KBETR !== r.KBETR;
                         })
                         .map(r => ({
                           ...r,
                           DEV_KBETR: devMap.get(r.KSCHL + r.VKORG + r.MATNR).KBETR
                         }));
```

工作簿文件不存储系统 ID，因此可以和使用不同系统名的同事共享。

## 限制

- SQL 仅支持 `SELECT` 和 `WITH`——不支持 `INSERT`、`UPDATE` 或 `DELETE`
- 字符串字面量限制为 255 个字符（SAP ADT 限制）
- 避免向 `IN` 子句插值超过约 10 个值——改用 JavaScript 单元格过滤
- 取消单元格会立即显示“已中断”，但查询仍会在 SAP 端继续运行

## 命令

| 命令 | 快捷键 / 说明 |
|---------|-----------------|
| `ABAP FS: New SAP Data Workbook` | 创建新的 `.sapwb` 文件 |
| `ABAP FS: Set Cell Max Rows` | 设置当前 SQL 单元格的行数限制 |
