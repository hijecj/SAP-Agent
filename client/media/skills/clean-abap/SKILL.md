---
name: clean-abap
description: Clean ABAP 编码规范与最佳实践。编写、审查或重构 ABAP 代码时使用，确保遵循 SAP 官方的 Clean ABAP 风格指南。涵盖命名规范、现代语言构造、类/方法设计、错误处理、格式化、注释和单元测试模式。
argument-hint: '[ABAP 编码任务或 ABAP 代码审查请求]'
user-invocable: true
disable-model-invocation: false
---

# Clean ABAP — AI 优化规则

> 提炼自 [SAP Clean ABAP 风格指南](https://github.com/SAP/styleguides)。
> 按 [Creative Commons BY 3.0](https://creativecommons.org/licenses/by/3.0/) 许可。
> © SAP SE。按许可条款保留署名。

编写或审查 ABAP 代码时应用以下所有规则。除非明确标记为 "consider"（酌情考虑），否则每条规则都是强制性的。

---

## 命名

- 使用能传达含义的描述性名称。用 `customizing_entries` 而不是 `ce_tab`。
- 技术层优先使用解决方案域术语（queue、tree），业务层使用问题域术语（account、ledger）。
- 集合使用复数：用 `materials` 而不是 `material_tab`。
- 使用可发音的名称：用 `detection_object_types` 而不是 `dobjt`。
- 使用 `snake_case`。达到长度限制时，缩写最不重要的词。
  ```abap
  DATA max_response_time_in_millisec TYPE i.
  ```
- 避免缩写。同一概念在所有地方使用相同的缩写。
- 类/接口用名词，方法用动词。布尔方法加 `is_` 或 `has_` 前缀。
  ```abap
  CLASS /clean/account.
  METHODS read_entries.
  IF is_empty( table ).
  ```
- 避免噪音词：用 `account` 而不是 `account_data`；用 `user_preferences` 而不是 `user_info`。
- 每个概念选一个词：始终用 `read_*`，绝不混用 `read_this` 和 `retrieve_that`。
- 只有在类确实实现该模式时才使用模式名称（factory、singleton）。
- **不要用匈牙利命名法或前缀。** 去掉 `iv_`、`rv_`、`lt_` 等。
  ```abap
  " 好
  result = a + b.
  " 坏
  rv_result = iv_a + iv_b.
  ```
- 不要用方法名遮蔽内置函数（`condense`、`lines`、`strlen` 等）。

## 语言

- 使用现代语法前，确认目标版本支持它。
- 不要过早优化。先写干净代码，之后再分析性能。
- 优先面向对象而不是过程化。把函数模块包装成类周围的薄壳。
  ```abap
  FUNCTION check_business_partner [...].
    DATA(validator) = NEW /clean/biz_partner_validator( ).
    result = validator->validate( business_partners ).
  ENDFUNCTION.
  ```
- 优先函数式构造：
  ```abap
  DATA(variable) = 'A'.              " 不用 MOVE
  DATA(uppercase) = to_upper( str ). " 不用 TRANSLATE
  index += 1.                        " 不用 ADD 1 TO
  DATA(obj) = NEW /clean/cls( ).     " 不用 CREATE OBJECT
  ```
- 使用现代表表达式：
  ```abap
  DATA(line) = value_pairs[ name = 'A' ].
  ```
- 避免过时元素。SQL 中使用 `@` 转义的主机变量：
  ```abap
  SELECT * FROM spfli WHERE carrid = @carrid INTO TABLE @itab.
  ```
- 只在带来明确收益时使用设计模式。

## 常量

- 用常量代替魔法数字：
  ```abap
  IF abap_type = cl_abap_typedescr=>typekind_date.   " 不用 'D'
  ```
- 常量名要反映含义而不是值：
  ```abap
  CONSTANTS status_inactive TYPE mmsta VALUE '90'.     " 不用 c_01
  ```
- 优先用 `ENUM`（7.51+）而不是常量接口：
  ```abap
  TYPES: BEGIN OF ENUM type, warning, error, END OF ENUM type.
  ```
- 如果不使用 ENUM，用 `BEGIN OF ... END OF` 分组常量：
  ```abap
  CONSTANTS:
    BEGIN OF message_severity,
      warning TYPE symsgty VALUE 'W',
      error   TYPE symsgty VALUE 'E',
    END OF message_severity.
  ```

## 变量

- 优先在首次使用时内联声明：
  ```abap
  DATA(name) = 'something'.
  ```
- 不要在声明变量的代码块之外使用它。
- 每个变量一条 `DATA`——不链式声明：
  ```abap
  DATA name TYPE seoclsname.
  DATA reader TYPE REF TO reader.
  ```
- 现代语法足够时避免字段符号（2021+）。直接使用 `dref->*`。
- 循环目标：
  - `ASSIGNING FIELD-SYMBOL(<line>)` — 就地读/改（最快）。
  - `REFERENCE INTO DATA(line)` — 需要在循环外使用引用时。
  - `INTO DATA(line)` — 需要副本时。

## 表

- `HASHED` — 大表、一次性填充、频繁按唯一键读取。
- `SORTED` — 大表、增量填充、按键（完整/部分）读取。
- `STANDARD` — 小表、数组或混合访问。
- 避免 `DEFAULT KEY`。使用显式键或 `EMPTY KEY`：
  ```abap
  DATA itab TYPE STANDARD TABLE OF row_type WITH EMPTY KEY.
  ```
- 优先 `INSERT INTO TABLE` 而不是 `APPEND TO`。
- 存在性检查用 `line_exists( )`：
  ```abap
  IF line_exists( my_table[ key = 'A' ] ).
  ```
- 单行检索优先 `READ TABLE` 而不是 `LOOP AT ... EXIT`。
- 优先 `LOOP AT ... WHERE` 而不是循环内嵌 IF。
- 避免双重读取——读一次并捕获异常：
  ```abap
  TRY.
      DATA(row) = my_table[ key = input ].
    CATCH cx_sy_itab_line_not_found.
      RAISE EXCEPTION NEW /clean/not_found( ).
  ENDTRY.
  ```

## 字符串

- 常量用反引号字面量：`` DATA(s) = `ABC`. `` 不用单引号。
- 用字符串模板 `| |` 拼接文本：
  ```abap
  DATA(msg) = |HTTP { status_code }: { text }|.
  ```

## 布尔值

- 可能出现第三种状态时优先用枚举。只有真正的二值状态才用布尔值。
- 类型用 `abap_bool`。比较用 `abap_true`/`abap_false`——绝不用 `'X'`、`' '` 或 `IS INITIAL`。
  ```abap
  DATA has_entries TYPE abap_bool.
  IF has_entries = abap_false.
  ```
- 用 `xsdbool( )` 设置布尔值：
  ```abap
  DATA(has_entries) = xsdbool( line IS NOT INITIAL ).
  ```

## 条件

- 优先正面条件。避免双重否定。
- 优先 `IS NOT` 而不是 `NOT IS`，`<>` 而不是 `NOT =`。
- 布尔方法用谓词式调用：
  ```abap
  IF condition_is_fulfilled( ).    " 不用 = abap_true
  ```
- 把复杂条件拆解为命名的布尔辅助方法。
- 把复杂条件提取到专用方法中。

## IF

- 不要空 IF 分支——改用取反。
- 优先 `CASE` 而不是 `ELSE IF` 链。
- 保持嵌套深度低——用子方法、布尔辅助方法或 `AND` 展平。

## 正则表达式

- 能用简单字符串方法时优先使用，避免正则。
- 优先使用 SAP 现有的 basis 检查，而不是手写正则。
- 复杂正则用命名常量组装。

## 类

### 面向对象

- 优先对象而不是静态类。静态类无法 mock。
- 例外：带纯函数的无状态工具类可以静态。
- 优先组合而不是继承。
- 不要在同一个类中混用有状态和无状态。

### 作用域

- 默认全局类。本地类仅用于私有结构、复杂算法或测试注入。
- 除非为继承设计，否则类标记 `FINAL`。
- 成员默认 `PRIVATE`。`PROTECTED` 仅用于有意的子类覆盖。
- 不可变对象优先用 `READ-ONLY` 属性而不是 getter：
  ```abap
  DATA name TYPE string READ-ONLY.
  ```

### 构造函数

- 优先 `NEW` 而不是 `CREATE OBJECT`。`CREATE OBJECT` 仅用于动态类型。
- 如果 `CREATE PRIVATE`，CONSTRUCTOR 保留在 PUBLIC SECTION。
- 优先多个静态创建方法，而不是可选的构造参数：
  ```abap
  CLASS-METHODS new_from_template IMPORTING template TYPE REF TO zcl_tmpl
    RETURNING VALUE(result) TYPE REF TO zcl_doc.
  CLASS-METHODS new_from_name IMPORTING name TYPE string
    RETURNING VALUE(result) TYPE REF TO zcl_doc.
  ```
- 只有在多个实例确实没有意义时才使用单例。

## 方法

### 调用

- 通过类名调用静态方法，而不是实例：
  ```abap
  cl_my_class=>static_method( ).     " 不用 lo_instance->static_method( )
  ```
- 通过类名访问类型，而不是实例。
- 优先函数式调用风格。`CALL METHOD` 仅用于动态分派。
- 省略 `RECEIVING`——直接捕获返回值。
- 省略可选的 `EXPORTING` 关键字。
- 单参数调用省略参数名（除非有歧义）。
- 除非解决作用域冲突，否则省略 `me->`。

### 面向对象

- 优先实例方法。静态仅用于工厂。
- 公共实例方法应该是接口的一部分。

### 参数

- 目标 < 3 个 IMPORTING 参数。把相关的合并为结构。
- 拆分方法而不是添加 OPTIONAL 参数。
- 谨慎使用 `PREFERRED PARAMETER`。
- 恰好返回/导出/修改一个参数。多部分输出返回结构。
- 优先 `RETURNING` 而不是 `EXPORTING`——支持函数式风格。
- `RETURNING` 大表没问题——不要过早改用 `EXPORTING`。
- 不要混用 `RETURNING` 与 `EXPORTING`/`CHANGING`。
- 谨慎使用 `CHANGING`——仅用于就地更新。
- 拆分方法而不是使用布尔输入参数：
  ```abap
  update_without_saving( ).     " 不用 update( do_save = abap_true )
  update_and_save( ).
  ```
- RETURNING 参数命名为 `RESULT`：
  ```abap
  METHODS get_name RETURNING VALUE(result) TYPE string.
  ```

### 参数初始化

- 方法开头始终清空/覆盖 EXPORTING 引用参数。
- 注意同一变量的输入/输出——需要时延后 CLEAR。
- 不要清空 VALUE 参数（本来就是空的）。

### 方法体

- 只做一件事，做好，只做这一件。
- 聚焦于正常路径或错误处理之一，不要两者兼顾。把校验单独提取。
- 每个方法下降一层抽象。
- 保持方法短小：3-5 条语句，最多约 20 条。

### 控制流

- 快速失败——在昂贵工作之前先在校验输入。
- 优先 `IF ... RETURN` 而不是 `CHECK`。`CHECK` 只在方法开头使用。
- 绝不在循环内使用 `CHECK`——用 `IF` + `CONTINUE`。

## 错误处理

### 消息

- 用 `MESSAGE e001(ad) INTO DATA(message).` 实现 where-used 可追溯性。

### 返回码

- 优先异常而不是返回码。
- 检查遗留返回码并转换为异常。

### 异常

- 异常只用于错误，不用于常规情况。
- 使用基于类的异常（`TRY`/`CATCH`），而不是遗留的 `EXCEPTIONS`。

### 抛出

- 为每个异常类别创建抽象的应用专属超类。
- 每个方法抛一种异常类型；用子类区分。
- 可管理、可预期的异常用 `CX_STATIC_CHECK`。
- 通常不可恢复的情况用 `CX_NO_CHECK`。
- 只有调用方控制是否发生时用 `CX_DYNAMIC_CHECK`。
- 只有完全不可恢复的编程错误才 Dump。
- 优先 `RAISE EXCEPTION NEW` 而不是 `RAISE EXCEPTION TYPE`：
  ```abap
  RAISE EXCEPTION NEW cx_gen_error( previous = exception ).
  ```

### 捕获

- 包装外来异常——不要让它们侵入你的 API：
  ```abap
  CATCH cx_amdp_failure INTO DATA(ex).
    RAISE EXCEPTION NEW cx_generation_failure( previous = ex ).
  ```

## 注释

- 用代码表达自己，而不是注释。用描述性名称提取方法。
- 注释不是坏命名的借口。
- 注释写**为什么**，而不是**是什么**。
- 用 `"` 注释，不用 `*`。
- 把注释放在其相关语句**之前**。
- 删除死代码——不要注释掉。
- 不用 ticket/传输标记做手动版本管理。
- 用 `FIXME`、`TODO`、`XXX` 并带上你的用户 ID。
- 没有方法签名注释或行尾注释。
- ABAP Doc 只用于其他团队消费的公共 API。
- 优先 pragma（`##NEEDED`）而不是伪注释（`"#EC NEEDED`）。

## 格式化

- 与团队风格保持一致。
- 激活前使用 ABAP Formatter。
- 每行一条语句。
- 最大行长度：120 个字符。
- 精简——不要多余空格。
- 用单个空行分隔，绝不超过一个。
- 只对齐同一对象的赋值：
  ```abap
  structure-type = 'A'.
  structure-id   = '4711'.
  ```
- 括号在行尾闭合，不在新行。
- 单参数调用放在一行。
- 参数跟在调用后面；太长才换行。
- 换行的参数在调用下方缩进。
- 多参数调用每行一个参数。
- 参数垂直对齐。
- 缩进并对齐到制表符。
- 不要跨不同声明对齐 TYPE 子句。
- 不链式赋值。

## 测试

### 原则

- 编写可测试的代码。必要时重构。
- 支持 mock——在对外位置添加接口。
- 测试代码必须比生产代码更易读。
- 自动化——不要 $TMP 副本或手动测试报告。
- 只测公共方法。需要测私有方法说明设计有缺陷。
- 不要痴迷覆盖率数字。

### 测试类

- 按用途命名：用 `ltc_reads_entry`，不用 `ltc_test`。
- 单元测试放在本地测试 include 中。
- 组件/集成测试放在独立的 `FOR TESTING ABSTRACT` 全局类中。
- 共享辅助代码放在 `lth_*` 类中。

### 被测代码

- 变量名：`cut`（默认）或有意义的名称。
- 按接口声明类型，而不是类。
- 把对 CUT 的调用提取到独立方法中。

### 注入

- 用构造函数注入测试替身。
- 不用 setter 注入、不用 FRIENDS 注入。
- 考虑用 `cl_abap_testdouble` 而不是手写替身：
  ```abap
  DATA(mock) = CAST if_reader( cl_abap_testdouble=>create( 'if_reader' ) ).
  cl_abap_testdouble=>configure_call( mock )->returning( value ).
  ```
- 测试接缝只作为临时变通方案。
- `LOCAL FRIENDS` 仅用于访问 `CREATE PRIVATE` 构造函数。
- 测试不需要的东西不要 mock。
- 不要用 case-ID 分发构建测试框架。

### 测试方法

- 名称反映给定 + 预期：`reads_existing_entry`、`throws_on_invalid_key`。
- 结构：given-when-then。太长则提取子方法。
- "When" = 恰好一次对 CUT 的调用。
- 除非要清理外部资源，否则不用 TEARDOWN。

### 测试数据

- 无意义的数据必须看起来无意义：`'42'`、`'?=/"&'`。
- 让差异容易发现。
- 用常量说明测试数据的用途。

### 断言

- 每个测试方法使用少量、聚焦的断言。
- 使用正确的断言类型：`assert_equals`、`assert_false`——不要 `assert_true( xsdbool(...) )`。
- 断言内容，而不是数量。
- 断言质量，而不是内容（针对元属性）。
- CUT 调用后对预期异常使用 `fail( )`：
  ```abap
  TRY.
      cut->do_something( '' ).
      cl_abap_unit_assert=>fail( ).
    CATCH /clean/some_exception.
  ENDTRY.
  ```
- 通过测试方法的 `RAISING` 转发意外异常。
- 编写自定义断言方法减少重复。
