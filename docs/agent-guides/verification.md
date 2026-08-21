# 验证规则

按实际影响范围运行检查，不要求文档改动执行无关构建。

| 改动范围 | 必须运行 |
| --- | --- |
| 仅 Markdown 文档 | 检查本地链接并审阅 `git diff --check` |
| `src/**`、前端依赖或 Vite 配置 | `pnpm build` |
| `src-tauri/**` | `cargo check --manifest-path src-tauri/Cargo.toml`；`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`；`cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` |
| 同时影响前后端边界 | 同时运行前端与 Rust 检查 |
| Tauri 打包、权限或发布配置 | 完成上述相关检查后运行 `pnpm tauri build` |

## 说明

- `pnpm build` 已包含 `vue-tsc --noEmit`，无需重复运行同一类型检查。
- 当前 `package.json` 没有自动化测试脚本；不要声称测试已通过。
- 交付时逐项报告 Pass、Fail 或未运行，并说明未运行原因。
