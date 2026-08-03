---
name: abap-performance-hana
description: S/4HANA 和 HANA 数据库系统的 ABAP 性能最佳实践。在基于 HANA 的系统上编写或审查 ABAP 代码时使用。重要：先用 SAP 系统信息工具检查系统类型——如果是 ECC 或运行在传统数据库（Oracle、DB2、MSSQL）上，改用 abap-performance-ecc 技能包。涵盖代码下推、CDS 视图、AMDP、高级 SQL 和 HANA 优化模式。
argument-hint: '[要在 HANA 上优化的 ABAP 代码]'
user-invocable: true
disable-model-invocation: false
---

# ABAP 性能 — S/4HANA / HANA 数据库

这些规则适用于 SAP S/4HANA 系统或任何运行在 HANA DB 上的 ABAP 系统。

**使用此技能包前：** 调用 SAP 系统信息工具。如果系统是传统 DB 上的 ECC，改用 `abap-performance-ecc` 技能包。

**HANA 核心哲学：** 把数据密集型操作下推到数据库。HANA 是面向集合操作、聚合和复杂 SQL 优化的列式内存数据库。让它做重活。ABAP 只负责业务逻辑、授权和异常处理。

---

## 代码下推 — 第一原则

**把数据密集型操作移到数据库层。**

### 下推到 HANA：
- 聚合（SUM、COUNT、AVG、MIN、MAX）
- 过滤（WHERE 子句——选择性越强越好）
- 排序（ORDER BY）
- JOIN（HANA 高效处理复杂多表 JOIN）
- SQL 中的字符串操作和算术
- 数据的 CASE 表达式 / 条件逻辑
- 分组和 HAVING
- 窗口函数（OVER/PARTITION BY）
- UNION / INTERSECT / EXCEPT

### 留在 ABAP：
- 多分支的复杂业务逻辑
- 权限检查、消息、异常
- 下推开销超过收益的小数据集处理
- 需要 ABAP 运行时特性的操作（RFC 调用、文件 I/O 等）

### 避免：
- 把所有行读到 ABAP 然后在循环中过滤/聚合
- 用内部表作为 SQL 一条语句就能完成的中间存储
- 本可以合并为一个 JOIN 的多次顺序 SELECT

---

## 数据库访问

### SELECT 模式

- 只选择需要的字段。生产环境绝不用 `SELECT *`。
  ```abap
  SELECT matnr, maktx FROM mara INTO TABLE @DATA(itab).
  ```

- 始终使用 WHERE 子句。始终使用 `@` 转义的主机变量。

- 积极使用 JOIN——HANA 非常擅长处理复杂 JOIN，甚至 5+ 个表。
  ```abap
  SELECT m~matnr, t~maktx, p~werks, p~ekgrp
    FROM mara AS m
    INNER JOIN makt AS t ON t~matnr = m~matnr AND t~spras = @sy-langu
    INNER JOIN marc AS p ON p~matnr = m~matnr
    LEFT OUTER JOIN mvke AS s ON s~matnr = m~matnr
    WHERE m~mtart = @material_type
    INTO TABLE @DATA(materials).
  ```

- 使用聚合函数和 GROUP BY——让 HANA 计算：
  ```abap
  SELECT werks, SUM( labst ) AS total_stock, COUNT(*) AS item_count
    FROM mard
    WHERE matnr = @matnr
    GROUP BY werks
    INTO TABLE @DATA(stock_by_plant).
  ```

- 用 CASE 表达式把条件逻辑下推到数据库：
  ```abap
  SELECT matnr,
         CASE mtart
           WHEN 'FERT' THEN 'Finished'
           WHEN 'ROH' THEN 'Raw Material'
           ELSE 'Other'
         END AS type_text
    FROM mara
    INTO TABLE @DATA(materials).
  ```

- SQL 中使用字符串函数：
  ```abap
  SELECT matnr, CONCAT( matnr, CONCAT( ' - ', maktx ) ) AS display_text
    FROM mara
    INNER JOIN makt ON makt~matnr = mara~matnr AND makt~spras = @sy-langu
    INTO TABLE @DATA(display_data).
  ```

- 无法 JOIN 时使用 `FOR ALL ENTRIES`。**始终检查驱动表不为空。**

- 只需要有限结果时使用 `UP TO n ROWS`。

- 能简化逻辑时使用子查询：
  ```abap
  SELECT matnr, maktx FROM mara
    WHERE matnr IN ( SELECT matnr FROM marc WHERE werks = @plant )
    INTO TABLE @DATA(plant_materials).
  ```

### CDS 视图

- **复杂数据模型优先用 CDS 视图。** 它们是 HANA 上主要的代码下推机制。
- CDS 视图可复用、可测试，HANA 自动优化。
- CDS 用于：复杂 JOIN、计算字段、聚合、关联、访问控制。
- ABAP 中通过 `SELECT FROM zcds_view` 消费 CDS 视图。

### AMDP（ABAP 托管数据库过程）

- 必须在 HANA 上完全运行的极复杂计算用 AMDP。
- AMDP 让你使用完整的 SQLScript（HANA 的过程化 SQL 语言）。
- 适用场景：复杂的多步转换、繁重字符串处理、图操作，或 CDS 不够用时。
- AMDP **不可移植**到其他数据库——只有确定系统留在 HANA 时才使用。

### 避免冗余数据库访问

- 绝不对同一数据 SELECT 两次。读一次，复用。
- 用内部表缓冲上的 `READ TABLE` 而不是循环中 `SELECT SINGLE`：
  ```abap
  SELECT matnr, maktx FROM makt WHERE spras = @sy-langu INTO TABLE @DATA(texts).
  " 稍后：
  READ TABLE texts WITH KEY matnr = current_matnr INTO DATA(text_line).
  ```

- HANA 上冗余数据库访问比传统数据库快——但仍然浪费并增加网络开销。

### 表缓冲

缓冲在 HANA 上比 ECC **重要性低**，因为 HANA 是内存数据库。但仍有帮助：
- 减少应用服务器和数据库服务器之间的网络往返
- 避免微小查找的查询解析开销

- 缓冲表使用 `SELECT SINGLE`——从缓冲读取。`UP TO 1 ROWS` 绕过缓冲。
  ```abap
  " 好 — 使用缓冲
  SELECT SINGLE * FROM t001 WHERE bukrs = @bukrs INTO @DATA(company).
  " 坏 — 绕过缓冲
  SELECT * FROM t001 UP TO 1 ROWS WHERE bukrs = @bukrs INTO @DATA(company).
  ```

- JOIN、聚合、GROUP BY、ORDER BY、子查询**绕过缓冲**。

---

## 内部表

### 表类型选择

与任何 ABAP 系统规则相同——这是 ABAP 运行时，不是数据库：
- **HASHED**：O(1) 查找。大表、唯一键、读多、一次性填充。
- **SORTED**：O(log n) 查找。非唯一键、范围访问、增量填充。
- **STANDARD**：除非排序 + 二分搜索，否则 O(n)。小表或顺序访问。

```abap
" 好 — O(1) 查找
DATA materials TYPE HASHED TABLE OF mara WITH UNIQUE KEY matnr.
READ TABLE materials WITH TABLE KEY matnr = input INTO DATA(mat).
```

### 循环优化

- 用 `ASSIGNING FIELD-SYMBOL(<fs>)` 获得最快的循环处理。
- LOOP 上用 `WHERE`——尤其在 SORTED 表上。
- 避免嵌套循环 O(n*m)。内部数据用 HASHED 查找。
- 用 `FILTER` 从 SORTED/HASHED 表提取子集：
  ```abap
  DATA(subset) = FILTER #( sorted_table WHERE status = 'A' ).
  ```

### 批量操作

- 批量插入用 `INSERT lines_of`。
- 函数式转换用 `VALUE #( FOR ... )` 和 `REDUCE`。
- 结构映射用 `CORRESPONDING #( )`。

### HANA 专属：考虑下推到 SQL

编写带聚合、过滤或转换的复杂 ABAP 循环之前——问自己：**这能不能用一条 SQL 语句实现？**

```abap
" ABAP 方式（小数据可接受）
LOOP AT sales ASSIGNING FIELD-SYMBOL(<s>).
  AT NEW kunnr.
    total = 0.
  ENDAT.
  total += <s>-netwr.
  AT END OF kunnr.
    APPEND VALUE #( kunnr = <s>-kunnr total = total ) TO totals.
  ENDAT.
ENDLOOP.

" HANA 方式（大数据更优）
SELECT kunnr, SUM( netwr ) AS total
  FROM vbak
  WHERE erdat >= @from_date
  GROUP BY kunnr
  INTO TABLE @DATA(totals).
```

---

## 字符串操作

- 用字符串模板 `| |` 而不是 CONCATENATE。
- 避免在循环中重复拼接字符串——构建字符串表：
  ```abap
  DATA lines TYPE string_table.
  LOOP AT data INTO DATA(d).
    APPEND |{ d-field1 };{ d-field2 }| TO lines.
  ENDLOOP.
  DATA(csv) = concat_lines_of( table = lines sep = cl_abap_char_utilities=>cr_lf ).
  ```

- **HANA 专属：** 对来自数据库数据的繁重字符串组装，考虑用 SQL 中的 `CONCAT` 或 `STRING_AGG`（通过 CDS/AMDP）完成。

---

## 授权检查

- 在昂贵的数据检索**之前**检查权限：
  ```abap
  AUTHORITY-CHECK OBJECT 'M_MATE_WRK' ID 'WERKS' FIELD plant.
  IF sy-subrc <> 0. RAISE EXCEPTION NEW zcx_no_auth( ). ENDIF.
  SELECT ... " 现在才取数
  ```

- S/4HANA 上考虑用 CDS 访问控制（DCL）把行级授权构建到数据模型中。

---

## ALV / UI 性能

- 按引用传递数据。
- 只读显示用 `CL_SALV_TABLE`。
- 非常大的结果集考虑分页。
- S/4HANA 上：UI 考虑 Fiori/RAP 而不是经典 ALV。

---

## 并行处理

- 独立并行任务用 `aRFC`。
- 并行化批量处理用 `SPTA` 框架。
- 非常长的任务用后台作业。
- **HANA 专属：** 在 ABAP 中并行化之前，检查工作能否下推到 HANA——一条高效的 SQL 可能胜过并行的 ABAP 任务。

---

## HANA 反模式

| 反模式 | 修复 |
|---|---|
| `SELECT *` | 只选择需要的字段 |
| 循环内 SELECT | JOIN（HANA 擅长处理复杂 JOIN） |
| 在 ABAP 循环中聚合 | SQL 中用 SUM/COUNT/AVG + GROUP BY |
| SQL 能过滤却在 ABAP 过滤 | 把 WHERE 下推到 SQL |
| 本可合并的多次 SELECT | 合并为单条 JOIN 语句 |
| STANDARD 表上的嵌套 LOOP | 内部数据用 HASHED 查找 |
| 大数据上的复杂 ABAP 转换 | CDS 视图或 AMDP |
| 循环内用 `&&` 拼接字符串 | 构建字符串表，或下推到 SQL |
| 忽略 CDS 视图 | 可复用数据模型用 CDS |
| 缓冲表上 `UP TO 1 ROWS` | `SELECT SINGLE` 使用缓冲 |
| 取数后做授权检查 | SELECT 前检查，或用 CDS DCL |
| 用 ABAP 写 SQL 能表达的逻辑 | 下推到数据库——始终问“SQL 能做这个吗？” |
