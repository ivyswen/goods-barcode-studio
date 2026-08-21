# Goods Barcode Studio

Goods Barcode Studio（条码工坊）是一个基于 Tauri 2、Vue 3、Vite 与 TypeScript 的本地优先商品条码生成、导出和标签打印桌面应用。

## 基础约定

- 包管理器使用 `pnpm`。
- 前端类型检查与生产构建统一运行 `pnpm build`。
- 仅按当前任务读取下列专项指引。

## 专项指引

| 任务范围 | 必读文件 |
| --- | --- |
| 修改 `src/**` 中的 Vue 或 TypeScript | [前端与 TypeScript](docs/agent-guides/frontend-typescript.md) |
| 修改 `src-tauri/**` 中的 Rust | [Rust 与 Tauri](docs/agent-guides/rust-tauri.md) |
| 新增自定义 Tauri Command、原生能力或平台分支 | [架构与平台边界](docs/agent-guides/architecture.md) |
| 修改代码、配置或构建流程 | [验证规则](docs/agent-guides/verification.md) |
| 创建提交或发布版本 | [Git 工作流](docs/agent-guides/git-workflow.md) |
