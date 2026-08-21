# 前端与 TypeScript

## 适用范围

修改 `src/**/*.ts` 或 `src/**/*.vue` 时读取本文件。

## 类型规则

- TypeScript 函数必须声明返回类型。
- 禁止使用 `any`；外部未知数据使用 `unknown` 并先收窄类型。
- 复杂对象先定义 `interface` 或 `type`，不要依赖匿名对象在多处重复推断。
- 跨 Tauri 边界的数据结构同时遵守[架构与平台边界](architecture.md)中的命名规则。

## 文件归属

- 可复用 Vue 组件放在 `src/components/`。
- 通用工具放在 `src/utils/`。
- 只有任务明确引入路由时才创建 `src/router/` 与 `src/views/`。
- 只有任务明确引入 Pinia 时才创建 `src/stores/`，并按业务域拆分 store。

## Tauri 调用

- 可直接使用 Tauri 官方插件公开的前端 API。
- 自定义 Tauri Command 必须经 `src/services/` 封装；具体调用链见[架构与平台边界](architecture.md)。
