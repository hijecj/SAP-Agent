---
name: abap-performance-ecc
description: ECC / 传统数据库系统（Oracle、DB2、MSSQL、MaxDB）的 ABAP 性能最佳实践。在非 HANA 系统上编写或审查 ABAP 代码时使用。重要：先用 SAP 系统信息工具检查系统类型——如果是 S/4HANA 或运行在 HANA DB 上，改用 abap-performance-hana 技能包。涵盖数据库访问、缓冲、内部表优化和 ECC 专属模式。
argument-hint: '[要在 ECC 上优化的 ABAP 代码]'
user-invocable: true
disable-model-invocation: false
---

# ABAP 性能 — ECC / 传统数据库

这些规则适用于运行在传统数据库（Oracle、DB2、MSSQL、MaxDB）上的 SAP ECC 系统。

**使用此技能包前：** 调用 SAP 系统信息工具。如果系统是 S/4HANA 或 HANA DB，改用 `abap-performance-hana` 技能包。

**ECC 核心哲学：** 最小化数据库往返。保持 SQL 简单——传统数据库不擅长优化复杂表达式。积极使用缓冲。把复杂逻辑移到 ABAP。

---

## 数据库访问

### SELECT 模式

- 只选择需要的字段。生产代码中绝不用 `SELECT *`。
  ```abap
  " 好
  SELECT matnr maktx FROM mara INTO TABLE itab.
  " 坏
  SELECT * FROM mara INTO TABLE itab.
  ```

- 始终使用 WHERE 子句。绝不无过滤读取整张表。

- 优先 JOIN 而不是嵌套 SELECT。一次往返总比 N 次好。
  ```abap
  " 好 — 单次往返
  SELECT m~matnr t~maktx
    FROM mara AS m
    INNER JOIN makt AS t ON t~matnr = m~matnr
    WHERE m~mtart = material_type
      AND t~spras = sy-langu
    INTO TABLE materials.
  ```

- 但 ECC 上保持 JOIN 简单。避免超过 3-4 个表的 JOIN——传统数据库可能生成糟糕的执行计划。必要时拆成两个 SELECT。

- 无法 JOIN 时使用 `FOR ALL ENTRIES`。**始终检查驱动表不为空。**
  ```abap
  IF itab[] IS NOT INITIAL.
    SELECT matnr werks FROM marc
      FOR ALL ENTRIES IN itab
      WHERE matnr = itab-matnr
      INTO TABLE plant_data.
  ENDIF.
  ```

- `FOR ALL ENTRIES` 会从结果中去除重复。需要重复时添加额外键字段。

- 只需要有限结果集时使用 `UP TO n ROWS`。

- **ECC 专属：** 避免在 SELECT 中使用子查询、CASE 表达式和复杂 SQL 函数——传统数据库常为这些生成糟糕的计划。取回数据在 ABAP 中处理。

- **ECC 专属：** 大结果集上小心使用 `ORDER BY`——可能很昂贵。需要排序数据时，考虑取到 SORTED 表类型或 ABAP 中排序。

### 避免冗余数据库访问

- 绝不对同一数据 SELECT 两次。读一次，存在内部表中，复用。

- 用带键的 `READ TABLE` 读缓冲的内部表，而不是在循环中 `SELECT SINGLE`。
  ```abap
  " 好 — 从缓冲读取
  SELECT matnr maktx FROM makt WHERE spras = sy-langu INTO TABLE texts.
  SORT texts BY matnr.
  " 稍后在循环中：
  READ TABLE texts WITH KEY matnr = current_matnr BINARY SEARCH INTO text_line.

  " 坏 — 每次循环都 SELECT
  LOOP AT items INTO item.
    SELECT SINGLE maktx FROM makt WHERE matnr = item-matnr AND spras = sy-langu INTO desc.
  ENDLOOP.
  ```

- 使用 `FOR ALL ENTRIES` 时，填充 HASHED 或 SORTED 表作为查找缓冲。

### 表缓冲（ECC 上至关重要）

缓冲在 **ECC 上比 HANA 更重要**，因为传统数据库的小查找较慢。

- 了解缓冲类型：
  - **完全缓冲**：首次访问时整表加载。适合小型配置表（T001、T005 等）。
  - **通用缓冲**：按键前缀。适合语言相关表（T002T 等）。
  - **单记录缓冲**：单行。适合单记录访问的大表。

- 缓冲表使用 `SELECT SINGLE`——它从缓冲读取。`SELECT ... UP TO 1 ROWS` **绕过缓冲**。
  ```abap
  " 好 — 使用缓冲
  SELECT SINGLE * FROM t001 WHERE bukrs = bukrs INTO company.

  " 坏 — 绕过缓冲
  SELECT * FROM t001 UP TO 1 ROWS WHERE bukrs = bukrs INTO company.
  ```

- 除非需要绝对最新的数据库状态，否则避免 `BYPASSING BUFFER`。

- JOIN、聚合、`DISTINCT`、`GROUP BY`、`ORDER BY`、子查询**都会绕过缓冲**。缓冲表上使用简单 SELECT。

- **ECC 提示：** 对频繁访问的配置数据，考虑把小整表读入内部表一次（应用级缓存），而不是反复访问数据库缓冲。

### 索引

- **ECC 专属：** 注意你 SELECT 的表上的二级索引。WHERE 子句要按索引字段顺序设计。
- 如果 SELECT 很慢，检查是否存在二级索引以及 WHERE 子句是否使用它。
- 在 ECC 上，优化器比 HANA 更依赖正确的索引使用（HANA 有列式存储帮助）。

---

## 内部表

### 表类型选择

选择正确的表类型——这是最大的单一性能杠杆：
- **HASHED**：O(1) 查找。大表、唯一键、读多、一次性填充。
- **SORTED**：O(log n) 查找。大表、非唯一键、范围访问、增量填充。
- **STANDARD**：除非排序 + 二分搜索，否则 O(n)。小表或纯顺序访问。

查找表**始终用 HASHED 或 SORTED**：
```abap
" 好 — O(1) 查找
DATA materials TYPE HASHED TABLE OF mara WITH UNIQUE KEY matnr.
READ TABLE materials WITH TABLE KEY matnr = input INTO mat.

" 坏 — O(n) 扫描
DATA materials TYPE STANDARD TABLE OF mara.
READ TABLE materials WITH KEY matnr = input INTO mat.
```

### 循环优化

- 用 `ASSIGNING <fs>` 获得最快的循环处理（无数据复制）。
- LOOP 上用 `WHERE`——尤其在 SORTED 表上（二分搜索）。
- 避免嵌套循环 O(n*m)。内部数据用 HASHED 查找：
  ```abap
  " 好 — O(n) 带 O(1) 查找
  DATA texts TYPE HASHED TABLE OF makt WITH UNIQUE KEY matnr spras.
  LOOP AT materials ASSIGNING <mat>.
    READ TABLE texts WITH TABLE KEY matnr = <mat>-matnr spras = sy-langu INTO text.
  ENDLOOP.
  ```

- SORTED 表上用 `DELETE ADJACENT DUPLICATES`。

### 批量操作

- 批量插入用 `INSERT lines_of itab INTO TABLE target`。
- STANDARD 表用 `APPEND LINES OF`。
- 结构映射用 `CORRESPONDING #( )`，而不是逐字段循环。

---

## 字符串操作

- 避免在循环中重复拼接字符串——二次方级重新分配。
  ```abap
  " 好 — 构建表，最后拼接
  DATA lines TYPE string_table.
  LOOP AT data INTO d.
    APPEND |{ d-field1 };{ d-field2 }| TO lines.
  ENDLOOP.
  DATA(csv) = concat_lines_of( table = lines sep = cl_abap_char_utilities=>cr_lf ).
  ```

---

## 授权检查

- 在昂贵的数据检索**之前**检查权限，而不是之后。
  ```abap
  AUTHORITY-CHECK OBJECT 'M_MATE_WRK' ID 'WERKS' FIELD plant.
  IF sy-subrc <> 0. RAISE EXCEPTION NEW zcx_no_auth( ). ENDIF.
  SELECT ... " 现在才取数据
  ```

---

## ALV / UI 性能

- 按引用把数据传给 ALV，避免复制大表。
- 只读显示用 `CL_SALV_TABLE`。
- 大型结果集（>10 万行）考虑分页。

---

## 并行处理

- 独立的长时间并行任务用 `aRFC`。
- 并行化批量处理用 `SPTA` 框架。
- 非常长的任务用后台作业。
- 每个单元必须自包含——无共享状态。

---

## ECC 反模式

| 反模式 | 修复 |
|---|---|
| `SELECT *` | 只选择需要的字段 |
| 循环内 SELECT | JOIN 或 FOR ALL ENTRIES |
| STANDARD 表上的嵌套 LOOP | 内部数据用 HASHED 查找 |
| STANDARD 表上 `LOOP AT ... WHERE` | 用带正确键的 SORTED/HASHED |
| 循环内用 `&&` 拼接字符串 | 构建字符串表，最后拼接 |
| 复杂 SQL（多 JOIN、子查询） | 简化 SQL，把逻辑移到 ABAP |
| 缓冲表上 `UP TO 1 ROWS` | 用 `SELECT SINGLE` 使用缓冲 |
| WHERE 子句不匹配索引 | 设计 WHERE 使用二级索引 |
| 取数后做授权检查 | 在 SELECT 前检查授权 |
| 在 ABAP 循环中聚合 | 数据量小时 ECC 可接受；量大用简单 GROUP BY |
