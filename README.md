# 条码工坊

> **条码工坊**是一款本地优先的商品条形码生成桌面应用。项目以 **Tauri 2 + Vue 3 + Vite + TypeScript** 实现，能够生成单个或批量商品条码，并将结果保存为可无限缩放的 SVG 文件或 ZIP 压缩包。

| 项目项 | 当前实现 |
| --- | --- |
| 桌面运行时 | Tauri 2（当前锁定到 2.11 系列） |
| 前端 | Vue 3、Vite、TypeScript |
| 条码渲染 | JSBarcode，生成原生 SVG |
| 文件输出 | 单个 SVG；多条 SVG + `清单.json` 的 ZIP |
| 支持制式 | Code 128、EAN-13、EAN-8、UPC-A |
| 批量上限 | 单次 500 条，防止界面长时间失去响应 |

## 已实现功能

应用提供单条生成和批量生成两种工作流。单条工作流可设置商品名称、条码内容、制式、线条宽度、条码高度、前景/背景颜色及是否显示人工可读文字。生成成功后会立即在工作台中呈现 SVG 预览，并保存在本次结果库中。

批量工作流支持粘贴由**逗号、制表符或分号**分隔的数据。首行可使用表头，空行和以 `#` 开头的注释行会被忽略。系统会为 EAN-13、EAN-8、UPC-A 自动补充或校验校验位；对 SKU 等字母数字混合内容，请选择或使用智能识别下的 Code 128。

| 输入示例 | 处理结果 |
| --- | --- |
| `经典咖啡豆 250g,6921234567890` | 生成 EAN-13 SVG |
| `天然苏打水\t6921234567913` | 生成 EAN-13 SVG |
| `会员礼盒;SKU-GIFT-2026-01` | 生成 Code 128 SVG |
| `6921234567890` | 自动命名为“商品-1”，并生成 EAN-13 SVG |

## 导出行为

在桌面程序内，点击 **“导出当前 SVG”** 或 **“导出全部”** 会显示系统保存对话框，用户可自主选择输出位置。批量导出会得到一个 ZIP，内部每个条码均为独立 SVG，同时提供 `清单.json`（包括序号、商品名、条码值、制式和文件名）。在普通浏览器中预览时，应用会自动回退为浏览器下载，不影响功能验证。

> SVG 是矢量图形格式，适合后续印刷和布局处理；请始终使用可靠的条码扫描和印刷测试流程确认最终成品质量。

## 本地开发

请先安装 Node.js、pnpm、Rust stable 工具链，以及与目标平台匹配的 Tauri 依赖。Tauri 官方的环境安装说明见参考资料。[1]

```bash
# 进入项目目录
cd goods-barcode-studio

# 安装 JavaScript 依赖
pnpm install

# 运行桌面开发模式
pnpm tauri dev
```

前端单独预览与生产构建可使用：

```bash
pnpm dev
pnpm build
```

创建桌面应用二进制与安装包时，运行：

```bash
pnpm tauri build
```

在 Linux 环境中，如果只需要验证桌面二进制编译而无需制作安装包，可使用：

```bash
pnpm tauri build --debug --no-bundle
```

## 项目结构

```text
src/
  App.vue                   # 条码工作台、批量解析、SVG/ZIP 导出逻辑
  styles.css                # 桌面界面视觉系统与响应式布局
src-tauri/
  src/lib.rs                # Tauri 插件初始化
  capabilities/default.json # 文件保存与系统保存对话框权限
  tauri.conf.json           # 应用标识与窗口配置
```

## 验证记录

已完成以下验证：前端 TypeScript 检查和 Vite 生产构建均通过；Tauri debug 二进制构建通过；本地界面预览确认单条 EAN-13 生成、混合 EAN-13/Code 128 批量生成、单个 SVG 下载和 ZIP 批量下载均可用。详细过程保存在 [`verification-notes.txt`](./verification-notes.txt)。

## 参考资料

[1] [Tauri v2：Prerequisites](https://v2.tauri.app/start/prerequisites/)

[2] [Tauri v2：JavaScript 前端框架集成](https://v2.tauri.app/start/frontend/)

[3] [Vue 3 官方文档](https://vuejs.org/guide/introduction.html)

[4] [JSBarcode：条形码生成库](https://github.com/lindell/JsBarcode)
