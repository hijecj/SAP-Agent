---
name: sap-system-personality-report
description: 生成全面的 SAP 系统画像报告。分析自定义代码版图、功能足迹、开发活动、健康度指标和包构成。当用户要求刻画系统、理解系统、获取系统概览、系统报告、系统画像，或“这个系统是做什么的？”时使用。通过 SQL 查询收集数据，并在结构化 WebView 中呈现结果。
argument-hint: '[要分析的 SAP 系统的 connectionId]'
user-invocable: true
disable-model-invocation: false
---

# SAP 系统画像报告

生成一份丰富、结构化的报告，以人类可读的术语刻画 SAP 系统。你将通过运行 SQL 查询收集数据，然后在 WebView 表格中呈现结果，并提供叙事性 AI 摘要。

**关键：** 运行任何查询前，先调用 `get_abap_sql_syntax` 了解 ABAP SQL 语法。运行 SQL 查询前用 `get_object_lines` 检查表结构。

**关键：** 所有查询必须使用 ABAP SQL 语法（例如 `ORDER BY field DESCENDING` 而不是 `DESC`）。用 `execute_data_query` 工具配合 `displayMode: "internal"` 收集数据，然后把最终结果组装到 `displayMode: "ui"` 调用中。

---

## 第 1 步：系统身份

先获取基本系统信息。使用 `get_sap_system_info` 工具——它返回系统类型（S/4HANA vs ECC）、版本、时区和 client 详情。此步骤无需 SQL。

---

## 第 2 步：自定义代码版图 — 对象计数

运行这些查询统计自定义对象。使用 `displayMode: "internal"` 和 `rowRange: {start: 0, end: 5}`，因为只需要计数。

**并行运行所有查询**（它们相互独立）：

### 类
```sql
SELECT COUNT(*) AS CNT FROM SEOCLASS WHERE CLSNAME LIKE 'Z%' OR CLSNAME LIKE 'Y%'
```

### 接口
**注意：** S/4HANA 中 **没有** `SEOINTERF` 表。改用 TADIR：
```sql
SELECT COUNT(*) AS CNT FROM TADIR WHERE PGMID = 'R3TR' AND OBJECT = 'INTF' AND OBJ_NAME LIKE 'Z%'
```
然后单独统计 Y：
```sql
SELECT COUNT(*) AS CNT FROM TADIR WHERE PGMID = 'R3TR' AND OBJECT = 'INTF' AND OBJ_NAME LIKE 'Y%'
```
把两个计数相加。

### 程序/报表（按类型）
**关键：** TRDIR 表包含所有程序类型（报表、include、类池等）。裸计数很有误导性，因为 include（SUBC='I'）主导计数。始终按 SUBC 字段分解：

```sql
SELECT SUBC, COUNT(*) AS CNT FROM TRDIR WHERE NAME LIKE 'Z%' OR NAME LIKE 'Y%' GROUP BY SUBC ORDER BY CNT DESCENDING
```

SUBC 值：'1'=可执行报表，'I'=Include，'M'=模块池，'S'=子程序池，'K'=类池，'J'=接口池，'X'=XSLT 程序。

在最终报告中，把它们作为独立条目呈现：
- **可执行报表**（SUBC='1'）— 实际的独立报表
- **模块池**（SUBC='M'）— 对话框程序
- **Include**（SUBC='I'）— 子对象（为类、FM 等生成）——显示作参考，但注明是生成的
- **子程序池**（SUBC='S'）— 独立子程序容器

报告中省略类池（K）和接口池（J），因为它们在类和接口中已统计。

### 函数模块
```sql
SELECT COUNT(*) AS CNT FROM TFDIR WHERE FUNCNAME LIKE 'Z%' OR FUNCNAME LIKE 'Y%'
```

### 函数组
```sql
SELECT COUNT(*) AS CNT FROM TLIBG WHERE AREA LIKE 'Z%' OR AREA LIKE 'Y%'
```

### 数据库表（仅透明表）
```sql
SELECT COUNT(*) AS CNT FROM DD02L WHERE TABNAME LIKE 'Z%' AND TABCLASS = 'TRANSP' AND AS4LOCAL = 'A'
```
然后单独统计 Y：
```sql
SELECT COUNT(*) AS CNT FROM DD02L WHERE TABNAME LIKE 'Y%' AND TABCLASS = 'TRANSP' AND AS4LOCAL = 'A'
```
把两个计数相加。

### 结构
```sql
SELECT COUNT(*) AS CNT FROM DD02L WHERE TABNAME LIKE 'Z%' AND TABCLASS = 'INTTAB' AND AS4LOCAL = 'A'
```
然后单独统计 Y 并相加。

### 数据元素
```sql
SELECT COUNT(*) AS CNT FROM DD04L WHERE ROLLNAME LIKE 'Z%' AND AS4LOCAL = 'A'
```
然后单独统计 Y 并相加。

### 域
```sql
SELECT COUNT(*) AS CNT FROM DD01L WHERE DOMNAME LIKE 'Z%' AND AS4LOCAL = 'A'
```
然后单独统计 Y 并相加。

### 表类型
```sql
SELECT COUNT(*) AS CNT FROM DD40L WHERE TYPENAME LIKE 'Z%' AND AS4LOCAL = 'A'
```
然后单独统计 Y 并相加。

### CDS 视图
```sql
SELECT COUNT(*) AS CNT FROM DDDDLSRC WHERE DDLNAME LIKE 'Z%'
```
然后单独统计 Y 并相加。

### 消息类
```sql
SELECT COUNT(*) AS CNT FROM T100A WHERE ARBGB LIKE 'Z%' OR ARBGB LIKE 'Y%'
```

### 自定义事务
```sql
SELECT COUNT(*) AS CNT FROM TSTC WHERE TCODE LIKE 'Z%' OR TCODE LIKE 'Y%'
```

### 增强实现（BAdI）
显示系统对 SAP 标准的扩展程度：
```sql
SELECT COUNT(*) AS CNT FROM TADIR WHERE PGMID = 'R3TR' AND OBJECT = 'ENHO' AND (OBJ_NAME LIKE 'Z%' OR OBJ_NAME LIKE 'Y%')
```

### 编号范围对象
```sql
SELECT COUNT(*) AS CNT FROM TADIR WHERE PGMID = 'R3TR' AND OBJECT = 'NROB' AND (OBJ_NAME LIKE 'Z%' OR OBJ_NAME LIKE 'Y%')
```

**注意：** 某些查询在特定系统上可能失败（缺表、授权）。查询失败时把计数记为“N/A”并继续其余部分。

---

## 第 3 步：包构成

这是最有价值的部分。获取每个自定义包的对象计数。

**关键：** 列 `OBJECT` 是 ABAP SQL 中的保留关键字。不要给它起别名（例如 `OBJECT AS OBJ_TYPE` 会导致解析错误 `Unknown column name "O"`）。直接使用列名 `OBJECT`，不带别名。

```sql
SELECT DEVCLASS, OBJECT, COUNT(*) AS OBJ_COUNT
FROM TADIR
WHERE DEVCLASS LIKE 'Z%'
  AND PGMID = 'R3TR'
GROUP BY DEVCLASS, OBJECT
ORDER BY DEVCLASS ASCENDING
```

使用 `displayMode: "internal"` 和足够大的 `rowRange`（start: 0, end: 1000）以及 `maxRows: 5000`。

注意：我们不再在 WHERE 子句中按特定 OBJECT 类型过滤——而是检索所有 R3TR 对象并在后处理中过滤/透视。这避免了长 IN() 列表的问题，并捕获所有对象类型。

然后对 Y 包运行相同查询：
```sql
SELECT DEVCLASS, OBJECT, COUNT(*) AS OBJ_COUNT
FROM TADIR
WHERE DEVCLASS LIKE 'Y%'
  AND PGMID = 'R3TR'
GROUP BY DEVCLASS, OBJECT
ORDER BY DEVCLASS ASCENDING
```

**把结果透视成**带以下列的表：
| 包 | 类 | FM | 报表 | DD 对象 | CDS | 接口 | 其他 | 总计 |

其中“DD 对象”= 该包的 TABL + DTEL + DOMA + TTYP + VIEW + ENQU + SHLP 之和。

按总计降序排序。显示前 30 个包。

---

## 第 4 步：开发时间线与对象质量

### 最旧和最新的自定义对象
显示自定义开发何时开始以及最近的对象何时创建：
```sql
SELECT MIN( CREATED_ON ) AS OLDEST, MAX( CREATED_ON ) AS NEWEST
FROM TADIR
WHERE (OBJ_NAME LIKE 'Z%' OR OBJ_NAME LIKE 'Y%')
  AND PGMID = 'R3TR'
  AND CREATED_ON <> '00000000'
```

### 未激活对象
已更改但从未激活的对象——代码质量不佳的信号：
```sql
SELECT COUNT(*) AS CNT FROM DD02L WHERE (TABNAME LIKE 'Z%' OR TABNAME LIKE 'Y%') AND AS4LOCAL = 'M'
```
```sql
SELECT COUNT(*) AS CNT FROM DD04L WHERE (ROLLNAME LIKE 'Z%' OR ROLLNAME LIKE 'Y%') AND AS4LOCAL = 'M'
```

`AS4LOCAL = 'M'` 表示已修改/未激活。把 DD02L 和 DD04L 的计数相加，得到粗略的未激活对象数。如果该计数相对活动对象较高，是值得注意的质量问题。

---

## 第 5 步：开发活动（最近 90 天）

### 活跃开发人员和传输计数
```sql
SELECT AS4USER, COUNT(*) AS TR_COUNT
FROM E070
WHERE AS4DATE >= '<计算：今天减 90 天，格式 YYYYMMDD>'
  AND STRKORR <> ''
GROUP BY AS4USER
ORDER BY TR_COUNT DESCENDING
```

**日期计算：** 你必须自己计算日期。今天减 90 天，格式化为 YYYYMMDD（例如 2025 年 12 月 5 日为 20251205）。ABAP SQL 日期以 YYYYMMDD 字符串存储。

使用 `maxRows: 100`、`rowRange: {start: 0, end: 50}`。

### 传输总数
```sql
SELECT COUNT(*) AS TOTAL
FROM E070
WHERE AS4DATE >= '<90 天前 YYYYMMDD>'
  AND STRKORR <> ''
```

---

## 第 6 步：系统健康（最近 30 天）

### Dump 趋势
```sql
SELECT DATUM, COUNT(*) AS DUMP_COUNT
FROM SNAP
WHERE DATUM >= '<计算：今天减 30 天，格式 YYYYMMDD>'
GROUP BY DATUM
ORDER BY DATUM ASCENDING
```

### 主要 Dump 类型
**关键：** S/4HANA 中的 SNAP 表**没有** `FESSION`（或 `SEESSION`）字段用于错误类型。S/4HANA 的 SNAP 表只包含：`DATUM`、`UZEIT`、`AHOST`、`UNAME`、`MANDT`、`MODNO`、`SEQNO`、`XHOLD` 和 `FLIST01-08`（文本块）。

改用 `SNAP_ADT` 表——它有带错误类型名称的结构化 `RUNTIME_ERROR` 字段：
```sql
SELECT RUNTIME_ERROR, COUNT(*) AS CNT
FROM SNAP_ADT
WHERE DATUM >= '<30 天前 YYYYMMDD>'
GROUP BY RUNTIME_ERROR
ORDER BY CNT DESCENDING
```

使用 `maxRows: 20`、`rowRange: {start: 0, end: 10}`。

### 测试类计数（粗略指标）
```sql
SELECT COUNT(*) AS CNT FROM SEOCLASS WHERE CLSNAME LIKE 'Z%TEST%' OR CLSNAME LIKE 'Y%TEST%' OR CLSNAME LIKE 'ZCL%TEST%' OR CLSNAME LIKE 'ZCL_TEST%'
```

**注意：** SNAP 表可能因授权而无法访问。S/4HANA 上 SNAP 表结构简化——用 `SNAP_ADT` 做错误类型分解。如果 SNAP 和 SNAP_ADT 查询都失败，跳过健康部分并注明“Dump 数据不可用——可能是授权限制”。

---

## 第 7 步：组装并呈现

### 确定功能足迹

根据第 3 步收集的包构成数据，按 SAP 功能领域对包分类。

**用自己的知识分类：** 看包名、其描述（如果有）以及包含的对象类型。常见模式：
- SD：销售、订单、交货、开票、定价、发运
- MM：物料、采购、采购申请、库存、供应商
- FI：财务、会计、付款、银行、税务、发票
- CO：成本控制、成本、利润、间接费用
- PP：生产、制造、工厂、BOM、工艺路线
- QM：质量、检验、批次
- PM：维护、设备、通知
- WM/EWM：仓库、存储、货位
- HR/HCM：人事、薪资、时间、缺勤
- BC/BASIS：工具、实用程序、框架、日志、中间件

把包分组到这些领域并计算百分比。

### 构建最终显示

用 `execute_data_query` 配合 `displayMode: "ui"` 和 `data` 参数（直接数据输入），把最终报告创建为结构化表格。

创建一个综合显示，以数据表形式包含这些部分：

**标题：** “System Personality Report: {connectionId}”

构建带以下列的摘要数据表：
| 类别 | 指标 | 值 |
|----------|--------|-------|

行应包含：
- 系统类型、版本、时区
- 开发时间线：最旧自定义对象日期 → 最新自定义对象日期
- 每个对象类型的正确分解计数：
  - 可执行报表（SUBC='1'）、模块池（SUBC='M'）、Include（SUBC='I' — 注明“生成/子对象”）、子程序池（SUBC='S'）
  - 类、接口、函数模块、函数组
  - 数据库表、结构、数据元素、域、表类型、CDS 视图、消息类
  - 自定义事务、增强实现、编号范围对象
- 自定义对象总数（从总数中排除 include 和类/接口池，避免重复计数）
- 未激活对象数（如果 > 0，注明为质量问题）
- 测试类数和覆盖率 %
- 按对象数排名前 5 的包
- 活跃开发人员数和按传输数排名前 5
- 传输总数（90 天）
- 日均 Dump 数（30 天）
- 排名前 3 的 Dump 类型

### AI 叙事摘要

收集所有数据后，写一段 5-20 句的叙事段落总结系统画像。包括：

1. 这看起来是什么类型的公司/行业（从功能足迹推断）
2. 自定义开发规模及其持续时间（开发时间线）
3. 团队规模和活动水平
4. 代码质量指标（Dump 率趋势、测试覆盖率、未激活对象数）
5. 增强足迹——SAP 标准被扩展的程度
6. 任何值得注意的模式（CDS 采用度高 = 现代化、测试少 = 风险、一个开发人员完成 50% 工作 = 关键人物依赖、大量未激活对象 = 需要清理、大量自定义事务 = 重度面向用户的定制）
7. 一条可操作的建议

把这段叙事作为回答文本的一部分呈现给用户，与数据表并列。

---

## 错误处理

- 查询失败时跳过该部分并在报告中注明。绝不让一个失败的查询阻塞整个报告。
- 如果系统没有自定义对象，说明：“此系统没有自定义 Z/Y 开发。”
- 如果 SNAP 不可访问，跳过健康部分。如果 E070 不可访问，跳过活动部分。
- 始终呈现成功收集到的任何数据。

---

## 性能说明

- 所有查询都是对元数据表的只读 SELECT——非常轻量
- 尽可能并行运行独立查询（第 2 步的查询可以同时运行）
- 总数据收集应耗时 10-30 秒，取决于系统
- 包构成（第 3 步）是最重的查询，但因为是聚合的仍然很快
