# 创建测试类

为现有类添加 ABAP 单元测试 include——扩展会创建骨架并在编辑器中打开它。

## 要求

- 目标对象必须是类（`*.clas.abap`）
- 该类必须已存在于 SAP 系统上

## 如何创建测试 include

**方式 1 — 右键菜单**

在资源管理器中右键类文件 → **创建测试类 include**

**方式 2 — 命令面板**

1. 按 `Ctrl+Shift+P`
2. 输入 `ABAP FS: Create test class include`
3. 按 `Enter`

**方式 3 — 让 Copilot 执行**

打开 Copilot 聊天并提问：

- *“为 ZCL_MY_CLASS 创建测试类”*
- *“给 ZCL_PRICING 添加单元测试”*
- *“为这个类设置测试”*

## 创建了什么

- 一个链接到主类的测试 include
- 带 `FOR TESTING` 和 `RISK LEVEL HARMLESS` 的骨架测试类
- 新 include 自动在编辑器中打开

## 后续步骤

include 创建后，添加你的测试方法，并用[运行单元测试](unit-tests.md)命令运行它们。
