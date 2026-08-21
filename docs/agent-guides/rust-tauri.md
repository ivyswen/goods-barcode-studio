# Rust 与 Tauri

## 适用范围

修改 `src-tauri/**` 或新增自定义 Tauri Command 时读取本文件。

## Command 规则

- 自定义 Command 返回 `Result<T, String>`，或返回能稳定序列化给前端的等价错误类型。
- Command 执行路径中禁止 `unwrap()`、`expect()` 和显式 `panic!()`；将错误映射后返回前端。
- 跨前后端结构使用 `#[serde(rename_all = "camelCase")]`，并与 TypeScript 类型保持字段一致。

## 平台隔离

- 桌面与移动实现分别使用 `#[cfg(desktop)]`、`#[cfg(mobile)]` 或目标操作系统条件编译。
- 平台专用代码集中在独立模块，不在通用业务逻辑中重复条件分支。

## 依赖与注册

- 新增 Rust 依赖时同步更新 `src-tauri/Cargo.toml` 与 `src-tauri/Cargo.lock`。
- 新增 Tauri 插件或 Command 时在 `src-tauri/src/lib.rs` 完成注册。
