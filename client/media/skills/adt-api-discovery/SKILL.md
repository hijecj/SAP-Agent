---
name: adt-api-discovery
description: >-
  调查 SAP ADT REST API 端点。当用户询问 ADT API 端点、请求/响应 XML 格式、内容类型，
  或特定 ADT 功能的底层工作原理时使用。传授如何从发现文档 → RES_APP 类 → 处理程序类 →
  简单转换 → XML 模式进行追踪。需要 adt_discovery_export 工具的输出文件和标准 ABAP 工具
  （get_abap_object_lines、search_abap_objects、search_abap_object_lines）。
argument-hint: '[要调查的 ADT 端点或功能]'
user-invocable: true
disable-model-invocation: false
---

# ADT API 发现 — 技能包

你在调查 SAP ADT REST API 端点。你的目标是确定任何端点的完整 HTTP 契约：URL、HTTP 方法、请求/响应 XML 格式、内容类型和头。

## 前置条件

使用此技能包前，先对目标 `connectionId` 运行 `adt_discovery_export` 工具。它会创建一个包含原始发现数据 markdown 文件的文件夹。先读这些文件。

## ADT 架构

每个 ADT REST 端点的存在都源于这条链：

```
SICF 节点：/sap/bc/adt
  └── 处理程序：CL_ADT_WB_RES_APP
        └── BAdI：BADI_ADT_REST_RFC_APPLICATION
              └── RES_APP 类（继承 CL_ADT_DISC_RES_APP_BASE 或 CL_ADT_RES_APP_BASE）
                    └── register_resources() 方法
                          ├── registry->register_discoverable_resource(url, handler_class, ...)
                          ├── registry->register_resource(template, handler_class)
                          └── collection->register_disc_res_w_template(relation, template, handler_class)
                                └── 处理程序类（继承 CL_ADT_REST_RESOURCE）
                                      ├── GET/POST/PUT/DELETE 方法重写
                                      ├── 内容处理程序工厂 → get_handler_for_xml_using_st()
                                      └── response->set_body_data() / request->get_body_data()
```

## 分步调查流程

### 第 1 步：在发现文档中找到端点

在 `workspaces.md` 中搜索 URL 或关键字。这会给你集合 `href` 和任何模板链接（带参数的 URL 模板、关系、内容类型）。

如果端点在发现文档中不存在，它可能是**隐藏资源**——通过 `register_resource()` 而不是 `register_discoverable_resource()` 注册。你会在第 2 步找到它。

### 第 2 步：找到 RES_APP 类

RES_APP 类负责注册端点。要找出是哪一个：

**方式 A — 按 URL 模式匹配**：发现 URL `/sap/bc/adt/oo/classes` 由一个 `register_resources()` 方法包含该 URL 的 RES_APP 注册。搜索它：
```
Use search_abap_object_lines on RES_APP classes from res-app-classes.md, searching for the URL segment (e.g., '/oo/classes' or '/datapreview/')
```

**方式 B — 检查 RES_APP 类名**：`res-app-classes.md` 文件列出所有带描述的 RES_APP 类。类名通常暗示功能领域（例如 `CL_ADT_DATAPREVIEW_RES_APP` → 数据预览，`CL_OO_ADT_RES_APP` → OO 类）。

**方式 C — 使用 `get_application_title()`**：每个 RES_APP 有一个返回标题的 `get_application_title()` 方法，与发现工作区标题匹配。读取方法源码进行匹配。

### 第 3 步：读取 `register_resources()` 找到处理程序类

用 `get_abap_object_lines` 读取 RES_APP 类源码。寻找三种注册模式：

```abap
" 模式 1 — 可发现资源（在 /sap/bc/adt/discovery 中）：
registry->register_discoverable_resource(
  url             = '/oo/classes'
  handler_class   = if_oo_adt_res_class_co=>co_class_name
  description     = 'Classes'
  category_scheme = ...
  category_term   = ...
  accepted_types  = ... ).

" 模式 2 — 隐藏资源（不在发现文档中）：
registry->register_resource(
  template      = '/oo/classes/{classname}'
  handler_class = if_oo_adt_res_class_co=>co_class_name ).

" 模式 3 — 集合上的模板链接：
classrun_col->register_disc_res_w_template(
  relation      = 'http://www.sap.com/adt/relations/oo/classrun'
  template      = '/oo/classrun/{classname}{?profilerId}'
  type          = if_rest_media_type=>gc_text_plain
  handler_class = if_oo_adt_res_classrun_co=>co_class_name ).
```

### 第 4 步：解析处理程序类名

`handler_class` 参数几乎总是**常量引用**，如 `if_oo_adt_res_class_co=>co_class_name`。你需要解析它：

1. 识别 `=>` 之前的接口/类（例如 `IF_OO_ADT_RES_CLASS_CO`）
2. 用 `get_abap_object_lines` 读取该接口的源码
3. 找到 `CONSTANTS co_class_name TYPE ... VALUE 'CL_OO_ADT_RES_CLASS'`

**命名约定**：处理程序类通常有一个保存所有常量的伴生 `*_CO` 接口：
- `IF_OO_ADT_RES_CLASS_CO` → `CL_OO_ADT_RES_CLASS` 的常量
- `IF_ADT_DATAPREVIEW_RES_CO` → `CL_ADT_DATAPREVIEW_RES` 的常量

它们包含：`co_class_name`、`co_accept_header_*`、`co_content_type_*`、`co_st_*`、`co_root_*`、`co_uri_*`

### 第 5 步：确定 HTTP 方法

读取处理程序类源码。基类 `CL_ADT_REST_RESOURCE` 定义了默认全部抛出 `cx_adt_res_meth_not_supported` 的 GET/POST/PUT/DELETE 方法。处理程序**只重写它支持的方法**：

```abap
METHODS get  REDEFINITION.    " → 支持 GET
METHODS post REDEFINITION.    " → 支持 POST
" PUT 和 DELETE 未重写 → 不支持
```

在类定义部分搜索 `REDEFINITION`。

### 第 6 步：找到简单转换（XML 模式）

处理程序类用 `CL_ADT_REST_CNT_HDL_FACTORY` 从简单转换创建内容处理程序。在处理程序源码中搜索：

```abap
cl_adt_rest_cnt_hdl_factory=>get_instance( )->get_handler_for_xml_using_st(
  st_name      = co_st_name           " → 解析为例如 'ST_DATA_PREVIEW'
  root_name    = co_root_name         " → 解析为例如 'DATA_PREVIEW_TABLE_DATA'
  content_type = if_xxx=>co_content_type_v1  " → 解析为 MIME 类型
)
```

三个参数通常都需要常量解析（与第 4 步相同的过程——读取 `*_CO` 接口）。

### 第 7 步：区分请求与响应

跟踪哪个内容处理程序变量在哪里使用：

```abap
" 响应（输出）：
response->set_body_data(
  content_handler = lo_response_handler    " ← 此处理程序的 ST 是响应格式
  data            = ls_result ).

" 请求（输入）：
request->get_body_data(
  EXPORTING content_handler = lo_request_handler  " ← 此处理程序的 ST 是请求格式
  IMPORTING data = ls_request ).
```

- **GET 请求**：通常没有请求体。只有响应 ST 重要。
- **POST/PUT 请求**：可能有请求和响应 ST（有时不同）。

### 第 8 步：读取简单转换源码

用 `get_abap_object_lines` 和 `objectType = 'XSLT'` 读取 ST 源码：

```

### 第 9 步：解读 ST XML

简单转换使用 `tt:` 指令。解读方法如下：

| ST 元素 | 含义 |
|-----------|---------|
| `<prefix:element>` | 出现在请求/响应中的实际 XML 元素 |
| `<tt:value ref="$ref.FIELD"/>` | 数据值占位符——变为字段值 |
| `<tt:attribute name="attr" value-ref="$ref.FIELD"/>` | 带数据值的 XML 属性 |
| `<tt:loop ref="TABLE">` | 重复元素（数组/表） |
| `<tt:cond s-check="not-initial(FIELD)">` | 可选/条件元素 |
| `<tt:apply name="SubTemplate">` | 调用同一 ST 内的命名模板 |
| `<tt:include name="OTHER_ST" template="xxx"/>` | 包含另一个 ST 的模板——也要读那个 ST |
| `<tt:template name="xxx">` | 命名模板块 |
| `<tt:template>`（未命名） | 默认/入口模板 |
| `<tt:root name="ROOT" type="..."/>` | 到 ABAP 结构的根数据绑定 |
| `xmlns:prefix="uri"` | 命名空间声明——输出中包含 |

**模板调用链**：未命名（默认）`<tt:template>` 是入口点。它通过 `<tt:apply name="xxx">` 调用命名模板。跟踪链条构建完整 XML 结构。

**包含的 ST**：`<tt:include name="ST_OTHER" template="xxx"/>` 意味着你还需要用 `get_abap_object_lines` 读取 `ST_OTHER`。

## 内容类型约定

SAP ADT 内容类型遵循此模式：
```
application/vnd.sap.adt.<域>.<子类型>.v<N>+xml
```

示例：
- `application/vnd.sap.adt.datapreview.table.v1+xml`
- `application/vnd.sap.adt.oo.classes.v4+xml`

**版本号很重要** — 错误版本 → 406 Not Acceptable。

## 关键基类

| 类 | 角色 |
|-------|------|
| `CL_ADT_RES_APP_BASE` | 所有 RES_APP 类的根基类 |
| `CL_ADT_DISC_RES_APP_BASE` | 扩展上述类，添加发现支持。大多数 RES_APP 继承自它 |
| `CL_ADT_REST_RESOURCE` | 所有处理程序类的基类 |
| `CL_ADT_REST_CNT_HDL_FACTORY` | 从简单转换创建内容处理程序的工厂 |

## 示例：数据预览的完整调查

1. 在 `workspaces.md` 中搜索 “data preview” → 找到带 `/sap/bc/adt/datapreview/ddic`、`/sap/bc/adt/datapreview/cds` 等集合的 “Data Preview” 工作区
2. 从 `res-app-classes.md` 中，`CL_ADT_DATAPREVIEW_RES_APP` 匹配
3. 读取它的 `register_resources()` → 找到 `handler_class = if_adt_datapreview_res_co=>co_class_name`
4. 读取 `IF_ADT_DATAPREVIEW_RES_CO` → `co_class_name = 'CL_ADT_DATAPREVIEW_RES'`
5. 读取 `CL_ADT_DATAPREVIEW_RES` → `METHODS get REDEFINITION. METHODS post REDEFINITION.` → 支持 GET、POST
6. 找到 `get_handler_for_xml_using_st(st_name = co_st_name ...)` → 从 `*_CO` 接口解析 `co_st_name` → `'ST_DATA_PREVIEW'`
7. 用 `objectType='XSLT'` 读取 `ST_DATA_PREVIEW` → 带 `dataPreview:tableData`、`dataPreview:totalRows` 等的 XML 结构

## 提示

- **先广泛搜索**：不确定哪个 RES_APP 注册你的端点时，用 `search_abap_object_lines` 对多个 RES_APP 类做通配符搜索
- **尽早读 `*_CO` 接口**：它通常包含处理程序的所有常量——类名、内容类型、ST 名、根名、URI 段
- **检查复合内容处理程序**：某些处理程序用 `CL_ADT_REST_COMP_CNT_HANDLER` 支持多种内容类型/版本。查找 `add_handler()` 调用
- **隐藏端点很常见**：许多端点用 `register_resource()` 注册，不出现在发现文档中。直接检查 RES_APP 源码
