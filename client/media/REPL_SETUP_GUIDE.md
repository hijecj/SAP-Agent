# ABAP REPL — SAP 端设置指南

> ⚠️ **实验性功能** — ABAP REPL 是实验性的，未来版本可能更改或移除。请谨慎使用。

> 🔒 **生产系统已阻止** — REPL 故意拒绝在生产 SAP client 上执行。这是硬编码的安全限制。它只面向开发和测试系统。

## 你要安装什么

一个 ABAP 类（`ZCL_ABAP_REPL`）和一个 SICF 服务节点（`Z_ABAP_REPL`）。仅此而已。没有数据库表、没有函数模块、没有配置表。

**设置时间：10 分钟。**

---

## 第 1 步：创建类

### 方式 A：通过 SE24（SAP GUI）

1. 打开事务 **SE24**
2. 类名：**ZCL_ABAP_REPL**
3. 点击**创建**
4. 描述：`ABAP REPL - Remote Code Execution Service`
5. 包：**$TMP**（本地，无传输）或你的 Z 包
6. 转到**接口**选项卡 → 添加：**IF_HTTP_EXTENSION**
7. 转到**源码**选项卡（基于源码的视图）
8. 删除所有生成的代码
9. 粘贴 [`ZCL_ABAP_REPL.abap`](ZCL_ABAP_REPL.abap) 的**全部**内容
10. **激活**（Ctrl+F3）

### 方式 B：通过 VS Code 中的 ABAP FS

1. 在 Copilot 聊天中：“Create a class ZCL_ABAP_REPL in $TMP with interface IF_HTTP_EXTENSION”
2. 打开创建的类
3. 用 `ZCL_ABAP_REPL.abap` 的内容替换所有代码
4. 保存并激活（Alt+Shift+F3）

---

## 第 2 步：创建 SICF 服务

1. 打开事务 **SICF**
2. 在树中导航到：**default_host → sap → bc**
3. 右键 **bc** → **创建服务**
4. 填写：
   - **服务元素名称：** `z_abap_repl`
   - **描述：** `ABAP REPL Service`
5. 转到**处理程序列表**选项卡
6. 在**处理程序 1** 中输入：`ZCL_ABAP_REPL`
7. 点击**保存**（分配给 $TMP 或你的传输）
8. 回到 SICF 树，右键 `z_abap_repl` → **激活服务**

---

## 第 3 步：验证

在 VS Code 中打开 REPL 面板（命令面板 → “Execute ABAP Code”）。选择你的 SAP 系统并运行一条简单语句，如 `WRITE: / 'Hello'.`。

如果收到 REPL 服务不可用的错误：
1. 进入 SICF → 搜索 `z_abap_repl`
2. 右键 → **激活服务**
3. 重试

---

## 授权

用户需要：

| 授权对象 | 字段 | 值 | 原因 |
|------------|-------|-------|-----|
| **S_DEVELOP** | ACTVT | 03 | 开发人员访问（生成子程序池） |
| **S_ICF** | ICF_VALUE | z_abap_repl | 访问 HTTP 服务 |

执行的 ABAP 代码在用户自己的授权下运行。REPL 不能做用户在 SE38 中做不到的任何事。

---

## 安全特性

1. **生产阻止：** 拒绝在生产 client（T000-CCCATEGORY = 'P'）上执行
2. **授权检查：** 执行前要求 S_DEVELOP
3. **审计日志：** 每次执行都记录到应用日志（SLG1，对象 ZREPL）
4. **无持久工件：** 不创建任何数据库对象。临时报表执行后立即删除。
5. **用户上下文：** 以调用用户的 SAP 角色运行——与 SE38 相同的授权范围

---

## 应用日志对象（可选）

想让审计日志正常工作，请创建应用日志对象：

1. 事务 **SLG0**
2. 创建对象：**ZREPL**
3. 描述：`ABAP REPL Execution Log`
4. 创建子对象：**EXEC**
5. 描述：`Code Execution`

不创建的话执行不会被记录。REPL 仍能工作——只是没有审计追踪。

---

## 移除服务

1. **SICF：** 停用并删除 `z_abap_repl` 服务节点
2. **SE24：** 删除类 `ZCL_ABAP_REPL`

系统上零残留。
