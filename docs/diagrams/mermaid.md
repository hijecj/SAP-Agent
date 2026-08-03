# Mermaid 图表创建

[Mermaid](https://mermaid.js.org/) 是一种基于文本的图表语言，让你用简单文本描述图表——无需绘图工具。ABAP FS 可以通过 Copilot 聊天直接在 VS Code 中生成和显示 Mermaid 图表。

## 如何创建图表

1. 打开 Copilot 聊天（`Ctrl+Alt+I`）。
2. 描述你想要的图表。例如：
   - *“创建一个流程图，展示方法 `PROCESS_DATA` 的流程”*
   - *“为 `ZCL_MY_CLASS` 生成类图”*
   - *“显示 `ZMY_PROGRAM` 中 BAPI 调用的时序图”*
3. 图表在交互式 WebView 中以 200% 缩放渲染。

## 使用图表查看器

| 操作 | 方式 |
|--------|-----|
| 放大 / 缩小 | 使用 WebView 中的缩放控件（20% 步进） |
| 保存图表 | 点击 WebView 中的保存按钮 |

## 支持的图表类型

流程图 · 时序图 · 类图 · 状态图 · ER 图 · 用户旅程 · 甘特图 · 饼图 · Git 图 · 思维导图 · 时间线 · 桑基图 · XY 图 · 方块图 · 数据包图

## 主题

`default` · `dark` · `forest` · `neutral`

在提示中指定主题：*“创建一个流程图……使用 dark 主题”*
