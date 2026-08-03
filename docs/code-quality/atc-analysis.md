# ABAP Test Cockpit（ATC）分析

ATC 是 SAP 内置的代码质量框架——与你在 SE80 或 Eclipse ADT 中运行的检查相同，但直接集成到 VS Code 中。它会扫描你的 ABAP 对象，检查编码违规、安全问题、性能问题，以及（可选）S/4HANA 兼容性。

## 运行 ATC

打开 ABAP 文件后，可以使用以下任一方法：

- **键盘：** `Ctrl+Shift+F2`
- **命令面板：** `ABAP FS: Run ABAP Test Cockpit`
- **Copilot 聊天：** “Run ATC on this file”

检查结果会立即以彩色下划线显示在编辑器中，并出现在 **ATC 检查结果** 面板中（活动栏 → ABAP FS → ATC Finds）。

## 处理结果

点击 ATC 面板中的任何检查结果，跳转到受影响的代码行。在那里你可以：

| 操作 | 方式 |
|---|---|
| 阅读检查文档 | 点击检查结果上的**显示文档** |
| 应用快速修复 | 点击灯泡 / 在下划线上按 `Ctrl+.` |
| 获取 AI 建议的修复 | 让 Copilot：*“Fix this ATC finding”* |
| 申请豁免 | 右键检查结果 → **申请豁免**（单个或批量） |
| 隐藏已豁免的结果 | 在面板工具栏中切换**过滤已豁免** |
| 保存后重新运行 | 在面板工具栏中切换**自动刷新** |

## 增强装饰标记

查看 SAP 标准代码时，🎯 标记显示客户增强（BADI、隐式增强等）在哪些位置生效。悬停查看详情，或点击链接直接打开增强源码。

## 配置检查变式

检查变式控制 ATC 应用哪些规则——就像在事务 `ATC` 或 SE80 中选择变式一样。要为每个连接设置默认变式：

1. 打开 **ABAP FS: Connection Manager**
2. 编辑连接
3. 设置 **ATC Variant** 字段（例如 `DEFAULT`、`S4HANA_READINESS` 或你的自定义变式）

或直接添加到 `settings.json`：

```json
"atcVariant": "S4HANA_READINESS"
```

## S/4HANA 迁移工作流

要检查自定义代码的 S/4HANA 兼容性，将变式设置为 `S4HANA_READINESS`。ATC 之后每次运行都会标记已移除的 API、变更的接口和弃用的功能。

推荐工作流：

1. 使用 [S/4HANA 就绪仪表盘](../developer-tools/s4hana-readiness.md) 识别所有受影响的对象
2. 打开每个对象并运行 ATC（`Ctrl+Shift+F2`）查看详细结果
3. 让 Copilot 根据 ATC 文档修复被标记的问题
