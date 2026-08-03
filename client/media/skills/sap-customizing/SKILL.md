---
name: sap-customizing
description: 导航和理解 SAP 定制（SPRO/IMG）。当用户询问定制设置、SPRO 活动、配置表、维护视图、视图集群，或需要读取/理解任何定制数据时使用。此技能传授如何从 SPRO 活动系统化地追溯到存储配置数据的实际表，以及如何为任何活动找到 SPRO 菜单路径。只要涉及定制、SPRO、IMG、配置或设置维护，就加载此技能包。
argument-hint: '[要调查的定制主题或 SPRO 活动]'
user-invocable: true
disable-model-invocation: false
---

# SAP 定制 — 从 SPRO 追溯到数据

## 重要警告

**你关于 SAP 定制的训练数据几乎肯定是错误的。** 不要猜测哪个表存储哪个定制数据。按照下面的查找流程从系统本身发现真相。

**查询前始终用 `get_object_lines` 读取表结构。** 绝不要凭记忆硬编码字段名。

**文本字段区分大小写。** 使用积极的通配符：`%aterial%ype%` 能匹配 "Material Types"、"material type" 等。

**最小化 SQL 往返。** 用 JOIN 把多次查找合并为单次查询。

**只向用户呈现有用的信息。** 活动 ID（`SIMG_CFMENUOLMSOMS2`）、树 GUID（`368DDFAB...`）、节点 ID 这类内部 ID 是技术管道——绝不要包含在回答中。只向用户显示：SPRO 菜单路径、表名、视图/集群名、事务码和描述。

---

## 元数据表

### IMG 活动层（SPRO 树 → 活动）

| 表 | 用途 | 关键字段 |
|-------|---------|------------|
| **CUS_IMGACH** | IMG 活动头 | `activity`、`c_activity`（链接到 CUS_ACTH）、`tcode` |
| **CUS_IMGACT** | IMG 活动文本（语言相关） | `spras`、`activity`、`text` |

### 定制活动层（活动 → 对象）

| 表 | 用途 | 关键字段 |
|-------|---------|------------|
| **CUS_ACTH** | 活动头 | `act_id`、`act_type`、`tcode` |
| **CUS_ACTT** | 活动文本（语言相关） | `spras`、`act_id`、`text` |
| **CUS_ACTOBJ** | **核心** — 把活动链接到维护对象 | `act_id`、`objecttype`、`objectname`、`tcode` |

**CUS_ACTH.act_type：** `C` = 定制（最常见），`E` = BAdI 定义，`I` = BAdI 实现。注意：按 `act_type = 'E'` 过滤不可靠——许多 BAdI 活动使用 `act_type = 'C'`。要找 BAdI，在 CUS_IMGACT 文本中搜索 `%BAdI%` 或 `%Business Add-In%`。这主要对行业解决方案（IS-Retail、IS-Utilities、HR）有效。核心模块（MM、FI、SD、PP）通常根本不把 BAdI 注册到 IMG——这些直接用 SE18 并按 `MB_*`、`ME_*`、`MM_*` 等模式查找。

**CUS_ACTOBJ.objecttype**（域 OB_TYP）：

| 值 | 含义 | `objectname` 包含 |
|-------|---------|---------------------------|
| `V` | **视图** | 维护视图名（例如 `V_T001W`）。通过 SM30 或专用事务码 |
| `C` | **视图集群** | 集群名（例如 `MTART`）。通过 SM34 或专用事务码 |
| `S` | **带文本表的表** | 直接是表名。通过 SM30 |
| `T` | **独立事务** | 逻辑对象（通常是 `SNUM`）。`tcode` 字段有事务码 |
| `L` | **逻辑传输对象** | 传输对象类型。`tcode` 字段有事务码 |
| `D` | **虚拟对象** | 通常是 `IMGDUMMY`。`tcode` 字段有事务码 |

### 视图集群解析

| 表 | 用途 | 关键字段 |
|-------|---------|------------|
| **VCLDIR** | 集群目录 | `vclname`、`exitprog` |
| **VCLSTRUC** | 集群结构——集群内的视图 | `vclname`、`object`、`objpos`、`dependency`、`startobj` |

**VCLSTRUC.dependency**（域 OBJDEP）：`R` = 根/头，`S` = 依赖一个父对象，`M` = 依赖多个父对象。**startobj** `X` = 初始显示的对象。

### 视图 → 基表解析

| 表 | 用途 | 关键字段 |
|-------|---------|------------|
| **DD26S** | 视图基表 | `viewname`、`tabname`、`as4local`（用 `A`）、`tabpos`（1 = 主表） |

ABAP FS 无法读取视图结构，但可以读取表。始终通过 DD26S 把视图解析为其基表，然后对表使用 `get_object_lines`。

### 事务解析

| 表 | 用途 | 关键字段 |
|-------|---------|------------|
| **TSTC** | 事务码 → 程序 | `tcode`、`pgmna` |
| **TSTCT** | 事务码描述 | `sprsl`、`tcode`、`ttext` |
| **TSTCP** | 事务码参数 | `tcode`、`param` |

**TSTCP.param** 对 SM30 包装器：`/*SM30 VIEWNAME=<view>;UPDATE=X;` — 提取 `VIEWNAME` 找到被维护的视图。

### SPRO 树层次

SPRO 树存储在多个相互链接的子树中：

| 表 | 用途 | 关键字段 |
|-------|---------|------------|
| **TNODEIMG** | 树节点（文件夹 + 活动叶子） | `tree_id`、`node_id`、`parent_id`、`node_type`、`reftree_id` |
| **TNODEIMGT** | 节点文本——保存**文件夹/章节名称**，不是活动名 | `tree_id`、`node_id`、`spras`、`text` |
| **TNODEIMGR** | 节点引用——把叶子节点链接到 IMG 活动 | `node_id`、`ext_key`、`ref_type`、`ref_object` |

**关键：** TNODEIMGR **没有 `tree_id` 列**——只有 `node_id`、`ext_key`、`ref_type`、`ref_object`。绝不要尝试与 TNODEIMG/TNODEIMGT 按 tree_id JOIN。

**关键：** TNODEIMGT 包含**文件夹标签**（“Material Types”、“Basic Settings”），不是活动名（“Define Attributes of Material Types”）。活动名在 CUS_IMGACT 中。要为已知活动找叶子节点，用 TNODEIMGR（见流程 3）。

**node_type 值：** `IMG0` = 文件夹节点，`IMG` = 活动叶子（文本在 CUS_IMGACT，不在 TNODEIMGT），`REF` = 对子树的引用（跟随 `reftree_id`）。

**TNODEIMGR.ref_type：** `COBJ` = 定制活动 ID（匹配 CUS_ACTOBJ.act_id），`ACTI` = IMG 活动 ID（匹配 CUS_IMGACH.activity，带 `SIMG` 前缀）。

主 SPRO 树 ID 是 `368DDFAB3AB96CCFE10000009B38F976`（“SAP Customizing Implementation Guide”）——这是 SAP 交付的，跨系统一致。不确定时查它：
```sql
SELECT t~id FROM ttree AS t INNER JOIN ttreet AS n ON t~id = n~id
  WHERE n~spras = 'E' AND t~type = 'IMG' AND n~text LIKE '%AP Customizing Implementation Guide'
```
它的顶级子节点（Logistics - General、Materials Management、FI 等）是通过 `reftree_id` 指向组件子树的 `REF` 节点。

### 域值查找

**DD07T** 解码任何编码字段：用 `domname`、`ddlanguage = 'E'`、`as4local = 'A'` 查询，得到 `domvalue_l` → `ddtext`。

---

## 查找流程

### 1. 按描述找活动 + 获取存储对象（合并）

```sql
SELECT a~activity, t~text, a~c_activity, o~objecttype, o~objectname, o~tcode
  FROM cus_imgach AS a
  INNER JOIN cus_imgact AS t ON a~activity = t~activity
  INNER JOIN cus_actobj AS o ON a~c_activity = o~act_id
  WHERE t~spras = 'E'
    AND t~text LIKE '%your search%'
```

然后按 `objecttype` 分支：

**V（视图）** → 解析为基表：
```sql
SELECT d~viewname, d~tabname, d~tabpos FROM dd26s AS d
  WHERE d~viewname = '<objectname>' AND d~as4local = 'A'
  ORDER BY d~tabpos ASCENDING
```
`tabpos = 1` 的行是主基表。对它运行 `get_object_lines` 并直接查询。

**C（视图集群）** → 获取组成视图，然后逐个解析：
```sql
SELECT v~vclname, v~exitprog, s~object, s~objpos, s~dependency, s~startobj
  FROM vcldir AS v
  INNER JOIN vclstruc AS s ON v~vclname = s~vclname
  WHERE v~vclname = '<objectname>'
  ORDER BY s~objpos ASCENDING
```
每个 `s~object` 是一个视图——按上面方式通过 DD26S 解析。

**S（带文本表的表）** → `objectname` 就是表。直接用 `get_object_lines` 读取。文本表通常是 `<table>T`。

**T / D / L** → `tcode` 是关键。当 `objectname = 'SNUM'` 时，这是编号范围活动——数据在表 `NRIV`（编号范围间隔）中，不是普通配置表。tcode（例如 `OMH6`、`MMNR`）打开编号范围维护界面。对其他独立事务码，检查 TSTCP 看它是否包装了 SM30：
```sql
SELECT t~tcode, t~param FROM tstcp AS t WHERE t~tcode = '<tcode>'
```
如果 param 包含 `VIEWNAME=`，提取它并通过 DD26S 解析。如果 TSTCP 没有条目（独立事务），在 TSTC 中查 tcode 获取程序——但注意对独立事务（objecttype T/D），底层表通常无法仅从元数据确定。你可能需要搜索程序的源代码或询问用户。

### 2. 反向查找：表/视图 → SPRO 活动

当你已知表/视图名时，通常比正向文本搜索（流程 1）更快，尤其当正向搜索从许多模块返回噪音结果时。

```sql
SELECT o~act_id, o~objecttype, o~objectname, o~tcode, t~text
  FROM cus_actobj AS o
  INNER JOIN cus_actt AS t ON o~act_id = t~act_id
  WHERE t~spras = 'E'
    AND o~objectname LIKE '%<table_or_view>%'
```

**如果返回 0 行**，该表可能是视图集群内的次要成员（CUS_ACTOBJ 只存储集群名，不存单个成员表）。通过 VCLSTRUC + DD26S 找集群：
```sql
SELECT s~vclname, s~object FROM vclstruc AS s
  INNER JOIN dd26s AS d ON d~viewname = s~object
  WHERE d~tabname = '<your_table>' AND d~as4local = 'A'
```
然后在 CUS_ACTOBJ 中搜索 `vclname` 值，`objecttype = 'C'`。

### 3. 为活动找 SPRO 菜单路径

SPRO 树被 REF 节点拆分成多个子树。构建完整路径需要在多个子树中向上走。每层树大约 3-4 次查询，树深度 3-5 层——总共大约 10-15 次查询。

**步骤 A** — 为已知活动 ID（来自流程 1）找树节点。使用 TNODEIMGR——不要按活动名搜 TNODEIMGT（它只有文件夹标签）。

**步骤 A.1** — 从 TNODEIMGR 获取活动的所有 node_id：
```sql
SELECT r~node_id FROM tnodeimgr AS r
  WHERE r~ref_type = 'COBJ' AND r~ref_object = '<activity_id>'
```
这通常返回**多行**——同一活动出现在多个 SPRO 位置。

**步骤 A.2** — 对每个 node_id，在 TNODEIMG 中查它获取 tree_id 和 parent_id。**TNODEIMGR 中的某些 node_id 是孤儿**（存在于 TNODEIMGR 但不在 TNODEIMG）——跳过任何返回 0 行的：
```sql
SELECT n~node_id, n~parent_id, n~tree_id, n~node_type
  FROM tnodeimg AS n WHERE n~node_id = '<node_id_from_A1>'
```
选择成功解析且属于模块相关子树的节点。不确定时逐个尝试，直到一个产生通向 SPRO 根的完整路径。

改为按**文件夹名**搜索（不是活动名）时，搜索 TNODEIMGT：
```sql
SELECT n~node_id, n~parent_id, n~tree_id, t~text
  FROM tnodeimg AS n
  INNER JOIN tnodeimgt AS t ON n~node_id = t~node_id AND n~tree_id = t~tree_id
  WHERE t~spras = 'E' AND t~text LIKE '%folder name%'
```

**步骤 B** — 在同一 `tree_id` 内沿 `parent_id` 向上走，从 TNODEIMGT 收集文件夹文本：
```sql
SELECT n~node_id, n~parent_id, t~text
  FROM tnodeimg AS n
  INNER JOIN tnodeimgt AS t ON n~node_id = t~node_id AND n~tree_id = t~tree_id
  WHERE t~spras = 'E' AND n~tree_id = '<tree_id>' AND n~node_id = '<parent_id>'
```
重复直到 `parent_id` 为空（已到达子树根）。

**步骤 C** — 跳转到父树。找出哪个 REF 节点引用此子树。先尝试不带文本 JOIN（某些 REF 节点没有 TNODEIMGT 文本）：
```sql
SELECT n~node_id, n~parent_id, n~tree_id
  FROM tnodeimg AS n
  WHERE n~reftree_id = '<current_tree_id>' AND n~node_type = 'REF'
```
如果返回**多行**，它们是链接到同一子树的不同 SPRO 位置——选择 tree_id 能追溯到主 SPRO 根的那个。如果返回 **0 行**，该子树是没有父链接的孤儿副本——回到步骤 A 为同一活动尝试不同的 node_id。

拿到 REF 节点后，继续在那棵树中沿 `parent_id` 向上走（再次步骤 B）。从 TNODEIMGT 获取 REF 节点的父文件夹文本，加入你的路径。

**步骤 D** — 重复步骤 B-C，直到到达主 SPRO 树根（`368DDFAB3AB96CCFE10000009B38F976`）。

按相反顺序组装收集的文本：`SAP Customizing Implementation Guide > Logistics - General > Material Master > Basic Settings > Material Types > Define Attributes of Material Types`。

### 4. 查找域编码值

```sql
SELECT d~domvalue_l, d~ddtext FROM dd07t AS d
  WHERE d~domname = '<DOMAIN_NAME>' AND d~ddlanguage = 'E' AND d~as4local = 'A'
```

---

## 完整示例：物料类型

用户问：“物料类型定制存储在哪里？”

**找活动 + 存储：**
```sql
SELECT a~activity, a~c_activity, t~text, o~objecttype, o~objectname, o~tcode
  FROM cus_imgach AS a
  INNER JOIN cus_imgact AS t ON a~activity = t~activity
  INNER JOIN cus_actobj AS o ON a~c_activity = o~act_id
  WHERE t~spras = 'E' AND t~text LIKE '%aterial%ype%'
```
结果：objecttype=`C`、objectname=`MTART` — 一个视图集群。

**获取集群视图：**
```sql
SELECT v~vclname, v~exitprog, s~object, s~objpos, s~dependency, s~startobj
  FROM vcldir AS v INNER JOIN vclstruc AS s ON v~vclname = s~vclname
  WHERE v~vclname = 'MTART' ORDER BY s~objpos ASCENDING
```
结果：`T134`（R=根，物料类型）和 `VT134M`（S=子，数量/价值更新）。退出程序：`MMMTARTEXIT`。

**解析为基表：**
```sql
SELECT d~viewname, d~tabname, d~tabpos FROM dd26s AS d
  WHERE d~viewname IN ('VT134M', 'T134') AND d~as4local = 'A'
```
结果：T134 → `T134`（tabpos=1），VT134M → `T134M`（tabpos=1）。用 `get_object_lines` 读取并直接查询。

注意：对 `CUS_ACTOBJ` 按 `objectname LIKE '%T134M%'` 反向查找返回 **0 行**——因为 CUS_ACTOBJ 存储集群名 `MTART`，不是单个成员表。要找 T134M 的 SPRO 条目，按流程 2 所示搜索 VCLSTRUC+DD26S。

---

## 提示

- **objecttype V 最常见**（约 4.3 万条）。大多数定制是基于 SM30 的视图维护。
- 当 CUS_ACTOBJ 中 `tcode` = `SM30` 时是通用值。其他事务码可能是 SM30 包装器（查 TSTCP）或独立事务。
- 某些 SPRO 活动有多个 CUS_ACTOBJ 条目——活动在多个位置维护数据。
- 对 `objecttype = S`，文本表按惯例是 `<table>T`（例如 `T134` → `T134T`），但要验证。
- 视图集群退出程序（VCLDIR.exitprog）包含值得阅读的校验逻辑。
- SPRO 树遍历（流程 3）每层树需要约 3-4 次查询（TNODEIMGR 查找、TNODEIMG、TNODEIMGT、然后 REF 跳转）。典型深度 3-5 层树 = 总共 10-15 次查询。
- 正向文本搜索（流程 1）可能很嘈杂——"payment terms" 等常见词会匹配 HR、薪资和行业解决方案。结果太多时，用已知表/视图名切换到反向查找（流程 2）。
- 活动经常出现在**多个 SPRO 位置**（例如 "Define Plant" 出现在 7 个地方）。规范路径通常在组织级设置的 Enterprise Structure 下，或功能设置的模块专属树下。
- 正向文本搜索（流程 1）对常见词可能很嘈杂——如果返回太多无关模块的结果，改用带表/视图名的反向查找（流程 2）。
