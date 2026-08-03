# ABAP SQL 语法指南

**🚨 关键：SAP HANA/Open SQL 使用与标准 SQL 不同的语法。请使用这些模式：**

## 字段名：

- **查询前始终用 ABAP 工具发现正确的字段名**

- **绝不要假设标准字段名** - 每张表有自己的约定

- 先用 `GetABAPObjectLinesTool` 检查表结构

## ORDER BY：

- ✅ `ORDER BY field DESCENDING` / `ASCENDING`

- ❌ `ORDER BY field DESC` / `ASC`

## LIMIT：

- ✅ **用工具 maxRows 参数做可靠限制**：工具调用中的 `maxRows: 100`

- ⚠️ **`SELECT fields UP TO n ROWS FROM table`**（不生效 - 会被忽略）

- ❌ **`SELECT fields FROM table LIMIT n`**（标准 SQL - 不支持）

- ❌ **`SELECT TOP n fields FROM table`**（SQL Server 风格 - 不支持）

## 运算符：

- ✅ `AND`、`OR`、`IN()`、`BETWEEN`、`IS NULL`、`IS NOT NULL`、`LIKE '%pattern%'`

- ❌ `&&`、`||`、`CONTAINS`、`NOT NULL`

## 聚合与分组：

- ✅ `DISTINCT`、`COUNT(*)`、`GROUP BY`、`HAVING`、`UNION`、`UNION ALL`、`CASE`

- ✅ **GROUP BY 中的计算列必须用别名**

- ✅ **函数括号两边必须有空格**：`SUM( column )`、`AVG( column )`、`MIN( column )`、`MAX( column )`

- ✅ **字符串函数**：`LENGTH( column )`、`UPPER( column )`、`LOWER( column )`、`SUBSTRING( column, start, length )`

- ✅ **数学函数**：`ROUND( column, decimals )`、`ABS( column )`、`+`、`-`、`*`、`/`

- ✅ **NULL 函数**：`COALESCE( column, default_value )`

- ✅ **子查询**：`IN ( SELECT... )`、`NOT IN ( SELECT... )`、`ANY ( SELECT... )`、`ALL ( SELECT... )`

- ✅ **ABAP 风格 JOIN**：使用波浪号记法 `table~field` 和 `AS` 别名

  - `FROM table1 AS a INNER JOIN table2 AS b ON a~key = b~key`

  - `FROM table1 AS a LEFT OUTER JOIN table2 AS b ON a~key = b~key`

  - `FROM table1 AS a RIGHT OUTER JOIN table2 AS b ON a~key = b~key`

- ✅ **EXISTS/NOT EXISTS**：`WHERE EXISTS ( SELECT 1 FROM table AS b WHERE b~key = a~key )`

- ✅ **多个 JOIN、带 WHERE/GROUP BY/聚合的 JOIN**

- ✅ **FULL OUTER JOIN 模拟**：用 `LEFT OUTER JOIN ... UNION RIGHT OUTER JOIN ... WHERE left_table~key IS NULL`

- ✅ **有限的日期函数**：`ADD_DAYS( date, number )`、`ADD_MONTHS( date, number )`

- ⚠️ **ABAP 专属子句被忽略**：`INTO CORRESPONDING FIELDS OF TABLE @DATA(var)`（会解析但被忽略）

- ❌ **无空格的函数语法**：`SUM(column)`、`AVG(column)`（解析错误）

- ❌ **标准 SQL JOIN**：`table.field` 记法（用波浪号 `table~field`）

- ❌ **窗口函数**：`OVER()`、`PARTITION BY`、`LAG()`、`LEAD()`

- ❌ **FULL OUTER JOIN**（用上面的模拟模式）

- ❌ **高级日期函数**：`YEAR()`、`MONTH()`、`EXTRACT()`、`DAYS_BETWEEN()`、`CURRENT_DATE`
