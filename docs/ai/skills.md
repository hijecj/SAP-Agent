# AI 技能包

技能包是内置的“速查表”，当你的问题或任务与其领域匹配时，Copilot 会自动读取它们。它们包含 ABAP 专属知识——编码规范、性能规则、SAP 导航技巧——这样你就不必自己解释这些上下文。

Copilot 只在相关时加载技能包的完整内容，所以技能包再多也不会拖慢无关对话。

## 使用技能包

**自动：** 当 Copilot 检测到匹配时，技能包会自动加载。无需任何操作。

**手动：** 在 Copilot 聊天输入框中输入 `/`，查看所有技能包的斜杠命令。选择其中一个显式调用，例如：

- `/clean-abap review this method`
- `/abap-research find the transaction for this screen`

## 可用技能包

| 技能包 | 斜杠命令 | 何时加载 |
|---|---|---|
| [Clean ABAP](#clean-abap) | `/clean-abap` | 编写或审查 ABAP 代码时 |
| [代码编写流程](#代码编写流程) | `/abap-code-writing` | 构建任何 ABAP 解决方案时 |
| [性能（ECC）](#性能ecc) | `/abap-performance-ecc` | 非 HANA 系统（Oracle、DB2、MSSQL） |
| [性能（HANA）](#性能hana) | `/abap-performance-hana` | S/4HANA / HANA DB 系统 |
| [SAP 研究](#sap-研究) | `/abap-research` | 搜索对象、事务、消息时 |
| [系统画像报告](#系统画像报告) | `/sap-system-personality-report` | 分析系统的自定义代码版图时 |
| [SAP 定制](#sap-定制) | `/sap-customizing` | SPRO/IMG 设置和配置表 |
| [SAP 数据工作簿](#sap-数据工作簿) | `/sap-data-workbook` | 多步骤 SAP 数据分析 |

---

### Clean ABAP

SAP 官方的 [Clean ABAP 风格指南](https://github.com/SAP/styleguides) 浓缩为 AI 优化规则。涵盖命名规范、现代语法、类/方法设计、错误处理、格式化和单元测试模式。

### 代码编写流程

构建 ABAP 解决方案的结构化流程：验证需求 → 探索系统 → 规划架构 → 调研现有对象 → 设计 → 编写代码。防止 AI 猜测参数，或重新实现 SAP 标准中已存在的功能。

### 性能（ECC）

传统数据库（Oracle、DB2、MSSQL、MaxDB）的性能模式。涵盖简单 SQL、缓冲、索引使用和内部表优化。Copilot 会自动检查系统类型，只在非 HANA 系统上加载此技能包。

### 性能（HANA）

S/4HANA 的性能模式。涵盖代码下推、CDS 视图、AMDP 和复杂 SQL 聚合。Copilot 会自动检查系统类型，只在基于 HANA 的系统上加载此技能包。

### SAP 研究

教会 Copilot 在陌生的 SAP 系统中找到任何东西——就像资深开发人员那样。涵盖针对不同目标应查询哪些元数据表（事务用 TSTCT、消息用 T100、所有对象用 TADIR、表字段用 DD03L）、通配符策略、包聚类，以及把错误消息追溯到代码。

### 系统画像报告

生成任意已连接 SAP 系统的结构化概览：自定义对象数量、开发最多的业务领域、近期 Dump 活动等。有助于快速了解陌生系统。

### SAP 定制

教会 Copilot 导航 SPRO/IMG 配置。使用系统化的查找流程，从 SPRO 活动追溯到其存储表（通过 `CUS_IMGACH`、`CUS_ACTH`、`CUS_ACTOBJ`），反向查找表对应的 SPRO 路径，并解析域固定值（`DD07T`）。

### SAP 数据工作簿

教会 Copilot 创建 `.sapwb` 文件——结合 ABAP SQL 和 JavaScript 单元格的 VS Code 笔记本，用于多步骤 SAP 数据分析。关于工作簿功能本身的详细信息，参见 [SAP 数据工作簿](../data-query/data-workbooks.md)。
