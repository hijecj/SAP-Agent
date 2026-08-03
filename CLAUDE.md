# ABAP FS 开发指南

完整贡献细节请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 工作流
1. 尽可能使用 TDD。
2. 维护项目结构（monorepo）。
3. 任何修改后运行 `npm run format`。
4. 确保 CI 通过（Node 24）。

## 约束
- 无动态导入。
- 无外部网络调用（仅 SAP 系统）。
- 保持函数短小，优先提前返回。
