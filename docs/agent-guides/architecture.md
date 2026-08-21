# 架构与平台边界

## 适用范围

新增自定义 Tauri Command、原生系统能力、平台差异逻辑或新的顶层源码目录时读取本文件。

## 当前事实

- 当前交付目标是桌面应用。
- 前端当前直接使用 Tauri 官方的 Dialog 与 FS 插件；Rust 启动层另注册了 Opener 插件。
- 项目当前没有自定义 Tauri Command、`src/services/`、前端路由、Pinia 或数据库层。

## 自定义 Tauri Command

新增自定义 Command 时保持以下调用链：

1. 在 `src-tauri/src/command/` 实现 Command，并在 `src-tauri/src/lib.rs` 注册。
2. 在 `src/services/` 封装前端调用；首个 Command 可创建 `src/services/tauriCommand.ts`。
3. Vue 组件只调用服务层，不直接从 `@tauri-apps/api/core` 导入 `invoke`。

上述规则只约束自定义 Command，不禁止使用 Tauri 官方插件提供的前端 API。

## 跨边界数据

- 前后端 JSON 字段统一使用 camelCase。
- Rust 跨边界结构使用 `#[serde(rename_all = "camelCase")]`。
- TypeScript 与 Rust 两端都定义明确的数据类型。

## 平台差异

- 首次出现前端平台分支时，创建或复用 `src/utils/PlatformConstants.ts` 集中判断平台。
- 不在业务组件中散落 `window.__TAURI__` 或 `process.platform` 判断。
- Rust 使用 `#[cfg(desktop)]`、`#[cfg(mobile)]` 或 `#[cfg(target_os = "...")]` 隔离平台实现。
- 不为尚未实现的移动端能力预建目录或抽象。

## 目录演进

- 只有功能确实需要时才新增目录。
- 若任务明确引入路由、Pinia 或数据库，再同时建立相应目录、依赖和验证规则。
- 新增顶层目录时更新根 `AGENTS.md` 的任务路由；不要维护一份与仓库现状脱节的完整目录树。
