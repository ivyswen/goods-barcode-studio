<script setup lang="ts">
import { computed, ref, reactive, watch, onMounted, nextTick } from "vue";
import JsBarcode from "jsbarcode";
import JSZip from "jszip";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./styles.css";
import PrintModal from "./components/PrintModal.vue";
import {
  type BarcodeExportItem,
  type ExportFormat,
  type ImageScale,
  type NamingPattern,
  type ExportTarget,
  formatFileNameBody,
  convertBarcode,
  generateCsvManifest,
  generateJsonManifest,
  triggerBrowserDownload,
  copyImageToClipboard,
  copyTextToClipboard,
} from "./utils/exporter";

type BarcodeFormat = "auto" | "CODE128" | "EAN13" | "EAN8" | "UPC";
type ResolvedBarcodeFormat = Exclude<BarcodeFormat, "auto">;

interface BarcodeItem extends BarcodeExportItem {
  format: ResolvedBarcodeFormat;
}

interface ParsedRow {
  name: string;
  value: string;
  line: number;
}

const formatOptions: Array<{ value: BarcodeFormat; label: string; note: string }> = [
  { value: "auto", label: "智能识别", note: "数字长度自动匹配 EAN / UPC，其余使用 Code 128" },
  { value: "CODE128", label: "Code 128", note: "适用于 SKU、订单号与字母数字混合编码" },
  { value: "EAN13", label: "EAN-13", note: "13 位商品条码，含或自动计算校验位" },
  { value: "EAN8", label: "EAN-8", note: "8 位紧凑商品条码，含或自动计算校验位" },
  { value: "UPC", label: "UPC-A", note: "12 位北美零售商品条码，含或自动计算校验位" },
];

const isTauri = "__TAURI_INTERNALS__" in window;

// 表单设置
const productName = ref("经典咖啡豆 250g");
const barcodeValue = ref("6921234567890");
const selectedFormat = ref<BarcodeFormat>("auto");
const barWidth = ref(2);
const barHeight = ref(88);
const lineColor = ref("#111827");
const backgroundColor = ref("#ffffff");
const showText = ref(true);
const batchText = ref("");

// 列表与选择状态
const items = ref<BarcodeItem[]>([]);
const activeId = ref<string | null>(null);
const selectedIds = ref<Set<string>>(new Set());
const status = ref("准备就绪。输入商品信息后即可生成条形码。");
const statusKind = ref<"neutral" | "success" | "error">("neutral");
const busy = ref(false);

// 批量导出配置弹窗状态
const isExportModalOpen = ref(false);
const exportScope = ref<"all" | "selected">("all");
const exportConfig = reactive({
  format: "png" as ExportFormat,
  scale: 2 as ImageScale,
  target: (isTauri ? "zip" : "zip") as ExportTarget,
  namingPattern: "index-name-code" as NamingPattern,
  includeCsv: true,
  includeJson: false,
});

// 批量打印弹窗状态
const isPrintModalOpen = ref(false);

// 导出进度状态
const isExporting = ref(false);
const exportProgress = reactive({
  current: 0,
  total: 0,
  percent: 0,
  message: "",
});

// 单条导出菜单下拉
const showSingleDropdown = ref(false);
const showSettingsDropdown = ref(false);
const backupFileInput = ref<HTMLInputElement | null>(null);

const UI_STORAGE_KEY = "goods_barcode_ui_settings_v1";

// 加载已保存的 UI 设置
function loadSavedUiSettings() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.selectedFormat) selectedFormat.value = parsed.selectedFormat;
    if (typeof parsed.barWidth === "number") barWidth.value = parsed.barWidth;
    if (typeof parsed.barHeight === "number") barHeight.value = parsed.barHeight;
    if (parsed.lineColor) lineColor.value = parsed.lineColor;
    if (parsed.backgroundColor) backgroundColor.value = parsed.backgroundColor;
    if (typeof parsed.showText === "boolean") showText.value = parsed.showText;
    if (parsed.productName) productName.value = parsed.productName;
    if (parsed.barcodeValue) barcodeValue.value = parsed.barcodeValue;
    if (parsed.exportConfig && typeof parsed.exportConfig === "object") {
      Object.assign(exportConfig, parsed.exportConfig);
    }
  } catch (err) {
    console.error("加载UI设置失败:", err);
  }
}

// 保存 UI 设置到本地存储
function saveUiSettings() {
  try {
    const payload = {
      selectedFormat: selectedFormat.value,
      barWidth: barWidth.value,
      barHeight: barHeight.value,
      lineColor: lineColor.value,
      backgroundColor: backgroundColor.value,
      showText: showText.value,
      productName: productName.value,
      barcodeValue: barcodeValue.value,
      exportConfig: { ...exportConfig },
    };
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("保存UI设置失败:", err);
  }
}

// 深度监听所有 UI 设置，自动保存
watch(
  [selectedFormat, barWidth, barHeight, lineColor, backgroundColor, showText, productName, barcodeValue, exportConfig],
  () => {
    saveUiSettings();
  },
  { deep: true }
);

// 初始化加载
loadSavedUiSettings();

// 优雅展示：等待 DOM 挂载和页面首帧完成渲染后再展示窗口，彻底消除启动白屏与闪烁
onMounted(async () => {
  if (isTauri) {
    try {
      const appWindow = getCurrentWebviewWindow();
      await nextTick();
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          await appWindow.show();
          await appWindow.setFocus();
        });
      });
    } catch (e) {
      console.warn("Tauri 窗口显示异常:", e);
    }
  }
});

// 导出全量配置包（换电脑备份迁移）
async function exportFullBackupConfig() {
  showSettingsDropdown.value = false;
  try {
    const backupData = {
      app: "goods-barcode-studio",
      version: "0.1.0",
      exportedAt: new Date().toISOString(),
      uiSettings: JSON.parse(localStorage.getItem(UI_STORAGE_KEY) || "{}"),
      printSettings: JSON.parse(localStorage.getItem("goods_barcode_print_settings_v1") || "{}"),
    };
    const jsonStr = JSON.stringify(backupData, null, 2);
    const fileName = `条码工坊_配置备份_${new Date().toISOString().slice(0, 10)}.json`;
    const payload = new TextEncoder().encode(jsonStr);

    if (isTauri) {
      const path = await save({
        defaultPath: fileName,
        filters: [{ name: "JSON 配置文件", extensions: ["json"] }],
      });
      if (!path) return;
      await writeFile(path, payload);
      setStatus(`已成功导出配置文件：${fileName}。在新电脑上导入该文件即可无缝恢复所有参数。`, "success");
    } else {
      triggerBrowserDownload(new Blob([payload], { type: "application/json" }), fileName);
      setStatus("已下载配置文件备份包！换电脑时导入该文件即可无缝恢复所有参数。", "success");
    }
  } catch (error) {
    setStatus(error instanceof Error ? `备份导出失败：${error.message}` : "导出配置失败", "error");
  }
}

// 触发选择备份文件
function triggerImportConfig() {
  showSettingsDropdown.value = false;
  backupFileInput.value?.click();
}

// 导入全量配置包（换电脑恢复）
function handleImportConfigFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target?.result as string;
      const data = JSON.parse(text);
      if (data.uiSettings) {
        localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(data.uiSettings));
        loadSavedUiSettings();
      }
      if (data.printSettings) {
        localStorage.setItem("goods_barcode_print_settings_v1", JSON.stringify(data.printSettings));
      }
      setStatus("已成功导入配置！所有条码生成参数、导出习惯与打印模板均已同步恢复。", "success");
    } catch {
      setStatus("导入失败：所选文件不是有效的条码工坊备份配置。", "error");
    }
  };
  reader.readAsText(file);
  input.value = "";
}

// 计算属性
const activeItem = computed(() => items.value.find((item) => item.id === activeId.value) ?? items.value[0] ?? null);
const currentFormatNote = computed(() => formatOptions.find((item) => item.value === selectedFormat.value)?.note ?? "");

const isAllSelected = computed(() => {
  return items.value.length > 0 && selectedIds.value.size === items.value.length;
});

const isSomeSelected = computed(() => {
  return selectedIds.value.size > 0 && selectedIds.value.size < items.value.length;
});

const selectedCount = computed(() => selectedIds.value.size);

const exportTargetItems = computed(() => {
  if (exportScope.value === "selected" && selectedIds.value.size > 0) {
    return items.value.filter((it) => selectedIds.value.has(it.id));
  }
  return items.value;
});

const previewSampleFileName = computed(() => {
  const sample = exportTargetItems.value[0] || { name: "经典咖啡豆 250g", value: "6921234567890" };
  const base = formatFileNameBody(sample, 0, exportConfig.namingPattern);
  if (exportConfig.format === "both") {
    return `svg/${base}.svg 与 png/${base}.png`;
  }
  const ext = exportConfig.format === "jpeg" ? "jpg" : exportConfig.format;
  return `${base}.${ext}`;
});

function checksum(value: string): number {
  let sum = 0;
  for (let index = value.length - 1, position = 1; index >= 0; index -= 1, position += 1) {
    sum += Number(value[index]) * (position % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

function normalizeRetailValue(value: string, format: ResolvedBarcodeFormat): string {
  const compact = value.replace(/\s|-/g, "");
  const expectedLength = format === "EAN13" ? 13 : format === "EAN8" ? 8 : 12;
  const bodyLength = expectedLength - 1;

  if (!/^\d+$/.test(compact)) throw new Error(`${format} 仅支持数字。`);
  if (compact.length === bodyLength) return `${compact}${checksum(compact)}`;
  if (compact.length !== expectedLength) {
    throw new Error(`${format} 需要 ${bodyLength} 位数据（自动补校验位）或完整 ${expectedLength} 位编码。`);
  }
  if (checksum(compact.slice(0, -1)) !== Number(compact[compact.length - 1])) {
    throw new Error(`${format} 的校验位不正确。请核对输入，或仅输入前 ${bodyLength} 位数据。`);
  }
  return compact;
}

function resolveFormat(value: string, requested: BarcodeFormat): ResolvedBarcodeFormat {
  if (requested !== "auto") return requested;
  const compact = value.replace(/\s|-/g, "");
  if (/^\d{12,13}$/.test(compact)) return "EAN13";
  if (/^\d{7,8}$/.test(compact)) return "EAN8";
  return "CODE128";
}

function buildSvg(value: string, requestedFormat: BarcodeFormat): { svg: string; value: string; format: ResolvedBarcodeFormat } {
  if (!value.trim()) throw new Error("请输入条形码内容。");
  const format = resolveFormat(value, requestedFormat);
  const normalized = format === "CODE128" ? value.trim() : normalizeRetailValue(value, format);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  JsBarcode(svg, normalized, {
    format,
    width: Number(barWidth.value),
    height: Number(barHeight.value),
    displayValue: showText.value,
    lineColor: lineColor.value,
    background: backgroundColor.value,
    margin: 12,
    font: "monospace",
    fontSize: 16,
    textMargin: 3,
    flat: true,
  });

  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `商品条形码 ${normalized}`);
  return { svg: new XMLSerializer().serializeToString(svg), value: normalized, format };
}

function createItem(name: string, value: string): BarcodeItem {
  const barcode = buildSvg(value, selectedFormat.value);
  return {
    id: crypto.randomUUID(),
    name: name.trim() || barcode.value,
    value: barcode.value,
    format: barcode.format,
    svg: barcode.svg,
    createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
}

function setStatus(message: string, kind: "neutral" | "success" | "error" = "neutral") {
  status.value = message;
  statusKind.value = kind;
}

function generateSingle() {
  try {
    const item = createItem(productName.value, barcodeValue.value);
    items.value.unshift(item);
    activeId.value = item.id;
    selectedIds.value.add(item.id);
    setStatus(`已生成 ${item.format} 条形码：${item.value}。`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "条形码生成失败。", "error");
  }
}

function parseBatchText(source: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  source.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const cells = line.split(/[\t,;]/).map((cell) => cell.trim());
    const [first, second] = cells;
    const isHeader = index === 0 && /^(商品名称|名称|name)$/i.test(first) && /^(条码|编码|code|barcode)$/i.test(second ?? "");
    if (isHeader) return;
    rows.push({ name: second ? first : `商品-${rows.length + 1}`, value: second || first, line: index + 1 });
  });
  return rows;
}

function generateBatch() {
  const rows = parseBatchText(batchText.value);
  if (rows.length === 0) {
    setStatus("请先粘贴批量数据。每行可使用“商品名称,条码”的格式。", "error");
    return;
  }
  if (rows.length > 500) {
    setStatus("为确保桌面应用响应稳定，单次最多生成 500 个条形码。", "error");
    return;
  }

  const created: BarcodeItem[] = [];
  const errors: string[] = [];
  rows.forEach((row) => {
    try {
      created.push(createItem(row.name, row.value));
    } catch (error) {
      errors.push(`第 ${row.line} 行：${error instanceof Error ? error.message : "生成失败"}`);
    }
  });

  if (created.length) {
    items.value.unshift(...created);
    activeId.value = created[0].id;
    created.forEach((c) => selectedIds.value.add(c.id));
  }
  setStatus(
    errors.length ? `已生成 ${created.length} 个，跳过 ${errors.length} 个。${errors[0]}` : `已成功批量生成 ${created.length} 个条形码，已自动勾选。`,
    errors.length ? "error" : "success"
  );
}

function fillExample() {
  batchText.value = [
    "商品名称,条码",
    "经典咖啡豆 250g,6921234567890",
    "冷萃咖啡液,6921234567906",
    "会员礼盒,SKU-GIFT-2026-01",
    "天然苏打水,6921234567913",
  ].join("\n");
  setStatus("已填充示例数据。可直接点击“批量生成”。", "neutral");
}

// 选择管理
function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id);
  } else {
    selectedIds.value.add(id);
  }
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value.clear();
  } else {
    selectedIds.value = new Set(items.value.map((i) => i.id));
  }
}

function deleteSelected() {
  if (!selectedIds.value.size) return;
  const count = selectedIds.value.size;
  items.value = items.value.filter((i) => !selectedIds.value.has(i.id));
  selectedIds.value.clear();
  if (activeId.value && !items.value.some((i) => i.id === activeId.value)) {
    activeId.value = items.value[0]?.id ?? null;
  }
  setStatus(`已删除选中的 ${count} 个条码。`, "neutral");
}

function removeItem(id: string) {
  const index = items.value.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = items.value.splice(index, 1);
  selectedIds.value.delete(id);
  if (activeId.value === id) activeId.value = items.value[0]?.id ?? null;
  setStatus(`已移除“${removed.name}”。`, "neutral");
}

function clearItems() {
  items.value = [];
  selectedIds.value.clear();
  activeId.value = null;
  setStatus("已清空本次生成结果。", "neutral");
}

// 单项导出函数
async function exportSingleItem(item: BarcodeItem, format: "svg" | "png" | "jpeg" | "webp", scale: ImageScale = 2) {
  showSingleDropdown.value = false;
  try {
    busy.value = true;
    const bodyName = formatFileNameBody(item, 0, "name-code");
    const converted = await convertBarcode(item, format, scale, backgroundColor.value);
    const fileName = `${bodyName}.${converted.extension}`;

    if (isTauri) {
      const filterName = `${format.toUpperCase()} 图像文件`;
      const path = await save({
        defaultPath: fileName,
        filters: [{ name: filterName, extensions: [converted.extension] }],
      });
      if (!path) return;
      await writeFile(path, converted.bytes);
      setStatus(`已成功保存：${fileName}。`, "success");
    } else {
      triggerBrowserDownload(converted.blob, fileName);
      setStatus(`已成功下载：${fileName}。`, "success");
    }
  } catch (error) {
    setStatus(error instanceof Error ? `导出失败：${error.message}` : "导出失败。", "error");
  } finally {
    busy.value = false;
  }
}

// 复制单项
async function handleCopyImage(item: BarcodeItem) {
  try {
    busy.value = true;
    await copyImageToClipboard(item.svg, 2, backgroundColor.value);
    setStatus("已将高清 PNG 条码复制到剪贴板！可直接在聊天软件或文档中粘贴。", "success");
  } catch (error) {
    setStatus(error instanceof Error ? `复制失败：${error.message}` : "复制失败", "error");
  } finally {
    busy.value = false;
  }
}

async function handleCopySvg(item: BarcodeItem) {
  try {
    await copyTextToClipboard(item.svg);
    setStatus("已复制 SVG 源码到剪贴板。", "success");
  } catch (error) {
    setStatus("复制失败。", "error");
  }
}

async function handleCopyCode(item: BarcodeItem) {
  try {
    await copyTextToClipboard(item.value);
    setStatus(`已复制条码值：${item.value}`, "success");
  } catch (error) {
    setStatus("复制失败。", "error");
  }
}

// 打开批量导出配置弹窗
function openExportModal(scope: "all" | "selected" = "all") {
  if (!items.value.length) {
    setStatus("暂无生成的条码可供导出。", "error");
    return;
  }
  if (scope === "selected" && selectedIds.value.size === 0) {
    exportScope.value = "all";
  } else {
    exportScope.value = scope;
  }
  isExportModalOpen.value = true;
}

// 打开批量打印弹窗
function openPrintModal(scope: "all" | "selected" = "all") {
  if (!items.value.length) {
    setStatus("暂无生成的条码可供打印。", "error");
    return;
  }
  if (scope === "all") {
    selectedIds.value.clear();
  }
  isPrintModalOpen.value = true;
}

// 执行批量导出逻辑
async function executeBatchExport() {
  const targetList = exportTargetItems.value;
  if (!targetList.length) {
    setStatus("没有需要导出的条码。", "error");
    return;
  }

  isExporting.value = true;
  exportProgress.current = 0;
  exportProgress.total = targetList.length;
  exportProgress.percent = 0;
  exportProgress.message = "正在初始化导出任务...";

  try {
    const isBoth = exportConfig.format === "both";
    const formatsToExport: Array<"svg" | "png" | "jpeg" | "webp"> = isBoth ? ["svg", "png"] : [exportConfig.format as any];
    const generatedFiles: Array<{ fileName: string; folder?: string; bytes: Uint8Array }> = [];
    const manifestEntries: Array<{ index: number; name: string; value: string; format: string; fileName: string }> = [];

    // 逐个转换条码
    for (let i = 0; i < targetList.length; i++) {
      const item = targetList[i];
      exportProgress.current = i + 1;
      exportProgress.percent = Math.round(((i + 1) / targetList.length) * 85);
      exportProgress.message = `正在处理 (${i + 1}/${targetList.length})：${item.name}...`;

      const baseName = formatFileNameBody(item, i, exportConfig.namingPattern);

      for (const fmt of formatsToExport) {
        const converted = await convertBarcode(item, fmt, exportConfig.scale, backgroundColor.value);
        const fileName = `${baseName}.${converted.extension}`;
        const folder = isBoth ? (fmt === "svg" ? "svg" : "png") : undefined;

        generatedFiles.push({
          fileName,
          folder,
          bytes: converted.bytes,
        });

        if (fmt === formatsToExport[0]) {
          manifestEntries.push({
            index: i + 1,
            name: item.name,
            value: item.value,
            format: item.format,
            fileName: isBoth ? `svg/${fileName}` : fileName,
          });
        }
      }
    }

    // 附加清单文件
    if (exportConfig.includeCsv) {
      exportProgress.message = "正在生成 Excel 清单文件 (CSV)...";
      const csvBytes = generateCsvManifest(manifestEntries);
      generatedFiles.push({
        fileName: "商品条形码清单.csv",
        bytes: csvBytes,
      });
    }

    if (exportConfig.includeJson) {
      exportProgress.message = "正在生成 JSON 数据文件...";
      const jsonBytes = generateJsonManifest(manifestEntries);
      generatedFiles.push({
        fileName: "清单数据.json",
        bytes: jsonBytes,
      });
    }

    // 根据目标方式保存 (ZIP 或 文件夹)
    if (exportConfig.target === "folder" && isTauri) {
      exportProgress.message = "正在选择目标保存文件夹...";
      const selectedDir = await open({
        directory: true,
        multiple: false,
        title: "选择批量条码保存文件夹",
      });

      if (!selectedDir || typeof selectedDir !== "string") {
        isExporting.value = false;
        return;
      }

      exportProgress.message = "正在向本地文件夹写入文件...";
      const cleanDir = selectedDir.replace(/[\\/]+$/, "");

      for (let i = 0; i < generatedFiles.length; i++) {
        const file = generatedFiles[i];
        exportProgress.message = `正在保存本地文件 (${i + 1}/${generatedFiles.length})：${file.fileName}...`;
        const filePath = file.folder ? `${cleanDir}/${file.folder}/${file.fileName}` : `${cleanDir}/${file.fileName}`;
        await writeFile(filePath, file.bytes);
      }

      setStatus(`批量导出成功！已将 ${targetList.length} 个条码保存至文件夹：${selectedDir}`, "success");
    } else {
      // ZIP 压缩包模式
      exportProgress.message = "正在打包生成 ZIP 压缩文件...";
      const archive = new JSZip();

      generatedFiles.forEach((file) => {
        if (file.folder) {
          archive.folder(file.folder)?.file(file.fileName, file.bytes);
        } else {
          archive.file(file.fileName, file.bytes);
        }
      });

      const zipBytes = await archive.generateAsync(
        { type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } },
        (meta) => {
          exportProgress.percent = 85 + Math.round(meta.percent * 0.15);
          exportProgress.message = `正在压缩打包 (${meta.percent.toFixed(0)}%)...`;
        }
      );

      const zipFileName = `商品条码_${exportConfig.format.toUpperCase()}_${new Date().toISOString().slice(0, 10)}.zip`;

      if (isTauri) {
        const savePath = await save({
          defaultPath: zipFileName,
          filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
        });
        if (!savePath) {
          isExporting.value = false;
          return;
        }
        await writeFile(savePath, zipBytes);
        setStatus(`已成功导出 ${targetList.length} 个条形码的 ZIP 压缩包！`, "success");
      } else {
        triggerBrowserDownload(new Blob([zipBytes], { type: "application/zip" }), zipFileName);
        setStatus(`已下载 ${targetList.length} 个条形码的 ZIP 压缩包！`, "success");
      }
    }

    isExportModalOpen.value = false;
  } catch (error) {
    setStatus(error instanceof Error ? `批量导出失败：${error.message}` : "批量导出发生错误。", "error");
  } finally {
    isExporting.value = false;
  }
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand" aria-label="条码工坊">
        <div class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <div>
          <p class="eyebrow">PRODUCT IDENTIFICATION LAB</p>
          <h1>条码工坊</h1>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="desktop-badge">{{ isTauri ? "桌面专业版" : "浏览器环境" }}</span>
        
        <div class="dropdown-wrap">
          <button
            class="button button-secondary"
            @click="showSettingsDropdown = !showSettingsDropdown"
            title="配置备份与换电脑迁移"
          >
            <span>⚙️</span> 备份/迁移 ▾
          </button>
          <div v-if="showSettingsDropdown" class="dropdown-menu" style="right: 0; left: auto; min-width: 220px;">
            <button @click="exportFullBackupConfig">💾 导出配置备份包 (.json)</button>
            <button @click="triggerImportConfig">📂 导入配置备份包 (换电脑)</button>
          </div>
        </div>
        <input
          ref="backupFileInput"
          type="file"
          accept=".json"
          style="display: none"
          @change="handleImportConfigFile"
        />

        <button
          class="button button-secondary"
          :disabled="!items.length || busy"
          @click="openPrintModal(selectedIds.size > 0 ? 'selected' : 'all')"
        >
          <span>🖨️</span> 批量打印 {{ selectedIds.size > 0 ? `(${selectedIds.size})` : items.length ? `(${items.length})` : '' }}
        </button>
        <button
          class="button button-primary"
          :disabled="!items.length || busy"
          @click="openExportModal(selectedIds.size > 0 ? 'selected' : 'all')"
        >
          <span>📦</span> 批量导出 / 下载 {{ selectedIds.size > 0 ? `(${selectedIds.size} 项)` : items.length ? `(${items.length})` : '' }}
        </button>
      </div>
    </header>

    <section class="intro">
      <div>
        <p class="eyebrow">BARCODE VECTOR & HD BITMAP STUDIO</p>
        <h2>为每一件商品，建立清晰的身份。</h2>
        <p>
          支持单条精细设计与 500+ 条批量生成。支持 <strong>SVG 无损矢量</strong>、<strong>PNG 高清/超清位图</strong>、<strong>JPG</strong>、<strong>WebP</strong>、<strong>CSV Excel 清单</strong> 多格式批量导出，以及 <strong>热敏标签/A4拼版批量打印</strong>。
        </p>
      </div>
      <dl class="quick-stats">
        <div>
          <dt>支持制式</dt>
          <dd>Code 128 · EAN · UPC</dd>
        </div>
        <div>
          <dt>导出与打印</dt>
          <dd>SVG / PNG / CSV / 批量打印</dd>
        </div>
      </dl>
    </section>

    <section class="workspace" aria-label="条形码生成工作区">
      <aside class="control-panel">
        <div class="panel-heading">
          <span>01</span>
          <div>
            <h3>生成设置</h3>
            <p>定义条码内容、规格与样式。</p>
          </div>
        </div>
        <div class="form-grid">
          <label class="field field-full">
            <span>商品名称</span>
            <input v-model="productName" type="text" maxlength="100" placeholder="例如：经典咖啡豆 250g" />
          </label>
          <label class="field field-full">
            <span>条码内容</span>
            <input
              v-model="barcodeValue"
              type="text"
              maxlength="120"
              placeholder="例如：6921234567890 或 SKU-001"
              @keyup.enter="generateSingle"
            />
          </label>
          <label class="field field-full">
            <span>条码制式</span>
            <select v-model="selectedFormat">
              <option v-for="option in formatOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <small>{{ currentFormatNote }}</small>
          </label>
          <label class="field">
            <span>线条宽度 <b>{{ barWidth }}px</b></span>
            <input v-model.number="barWidth" type="range" min="1" max="4" step="0.5" />
          </label>
          <label class="field">
            <span>条码高度 <b>{{ barHeight }}px</b></span>
            <input v-model.number="barHeight" type="range" min="50" max="160" step="2" />
          </label>
          <label class="field color-field">
            <span>线条颜色</span>
            <input v-model="lineColor" type="color" />
            <code>{{ lineColor }}</code>
          </label>
          <label class="field color-field">
            <span>背景颜色</span>
            <input v-model="backgroundColor" type="color" />
            <code>{{ backgroundColor }}</code>
          </label>
          <label class="switch-row field-full">
            <input v-model="showText" type="checkbox" />
            <span class="switch" aria-hidden="true"></span>
            <span>
              <b>显示可读数字</b>
              <small>在条码下方保留人工可读的数字编码。</small>
            </span>
          </label>
        </div>
        <button class="button button-primary button-wide" @click="generateSingle">
          生成条形码 <span>→</span>
        </button>
      </aside>

      <section class="preview-panel">
        <div class="panel-heading">
          <span>02</span>
          <div>
            <h3>即时预览</h3>
            <p>{{ activeItem ? `${activeItem.format} · ${activeItem.createdAt}` : "生成后将在这里显示" }}</p>
          </div>
        </div>
        <div class="barcode-stage" :class="{ 'is-empty': !activeItem }">
          <template v-if="activeItem">
            <div class="stage-label">{{ activeItem.name }}</div>
            <div class="barcode-art" v-html="activeItem.svg"></div>
            <div class="stage-meta">
              <span>{{ activeItem.value }}</span>
              <span>{{ activeItem.format }}</span>
            </div>
          </template>
          <template v-else>
            <div class="empty-mark"><i></i><i></i><i></i><i></i><i></i></div>
            <h4>等待生成</h4>
            <p>填写左侧商品信息，生成的条码将在此处即时预览。</p>
          </template>
        </div>

        <div class="preview-actions">
          <div class="action-btn-group" v-if="activeItem">
            <button
              class="button button-primary"
              :disabled="busy"
              @click="selectedIds.clear(); selectedIds.add(activeItem.id); openPrintModal('selected')"
            >
              🖨️ 打印标签
            </button>
            <button class="button button-secondary" :disabled="busy" @click="exportSingleItem(activeItem, 'svg')">
              导出 SVG
            </button>
            <button class="button button-secondary" :disabled="busy" @click="exportSingleItem(activeItem, 'png', 2)">
              导出 PNG (高清)
            </button>
            <div class="dropdown-wrap">
              <button class="button button-secondary dropdown-toggle" @click="showSingleDropdown = !showSingleDropdown">
                更多 ▾
              </button>
              <div v-if="showSingleDropdown" class="dropdown-menu">
                <button @click="exportSingleItem(activeItem, 'png', 4)">PNG 4x (300DPI 印刷)</button>
                <button @click="exportSingleItem(activeItem, 'jpeg')">JPG 标准位图</button>
                <button @click="exportSingleItem(activeItem, 'webp')">WebP 网页格式</button>
                <hr />
                <button @click="handleCopyImage(activeItem)">📋 复制图片到剪贴板</button>
                <button @click="handleCopySvg(activeItem)">📄 复制 SVG 源码</button>
                <button @click="handleCopyCode(activeItem)">🔢 复制条码数值</button>
              </div>
            </div>
          </div>
          <button class="text-button" :disabled="!activeItem" @click="activeId = null">取消选择</button>
        </div>
      </section>
    </section>

    <!-- 批量生成区域 -->
    <section class="batch-section">
      <div class="batch-copy">
        <div class="panel-heading">
          <span>03</span>
          <div>
            <h3>批量生成</h3>
            <p>粘贴商品列表，一键批量创建条形码。</p>
          </div>
        </div>
        <p>
          每行一条记录，可使用 <strong>商品名称,条码</strong>、制表符或分号分隔；首行可包含“商品名称,条码”表头。
        </p>
        <div class="batch-tips">
          <span>最多 500 条</span>
          <span>自动校验 EAN / UPC</span>
          <span>支持多格式导出与批量打印</span>
        </div>
      </div>
      <div class="batch-input-wrap">
        <textarea
          v-model="batchText"
          rows="7"
          placeholder="商品名称,条码&#10;经典咖啡豆 250g,6921234567890&#10;冷萃咖啡液,6921234567906&#10;会员礼盒,SKU-GIFT-2026-01"
        ></textarea>
        <div class="batch-actions">
          <button class="text-button" @click="fillExample">填充示例</button>
          <button class="button button-primary" @click="generateBatch">批量生成 <span>→</span></button>
        </div>
      </div>
    </section>

    <!-- 结果列表管理区域 -->
    <section class="results-section">
      <div class="results-header">
        <div class="results-title-row">
          <p class="eyebrow">GENERATED LIBRARY</p>
          <div class="title-with-badge">
            <h3>本次生成库 <span>{{ items.length }}</span></h3>
            <span v-if="selectedCount > 0" class="selected-pill">已勾选 {{ selectedCount }} 项</span>
          </div>
        </div>

        <div class="results-toolbar" v-if="items.length">
          <label class="select-all-label">
            <input
              type="checkbox"
              :checked="isAllSelected"
              :indeterminate="isSomeSelected"
              @change="toggleSelectAll"
            />
            <span>全选</span>
          </label>

          <button
            class="button button-secondary button-sm"
            :disabled="busy"
            @click="openPrintModal(selectedCount > 0 ? 'selected' : 'all')"
          >
            🖨️ 批量打印 {{ selectedCount > 0 ? `(${selectedCount})` : `全部 (${items.length})` }}
          </button>

          <button
            class="button button-primary button-sm"
            :disabled="busy"
            @click="openExportModal(selectedCount > 0 ? 'selected' : 'all')"
          >
            📦 批量导出 {{ selectedCount > 0 ? `(${selectedCount})` : `全部 (${items.length})` }}
          </button>

          <button
            v-if="selectedCount > 0"
            class="button button-secondary button-sm danger-text"
            @click="deleteSelected"
          >
            批量删除 ({{ selectedCount }})
          </button>

          <button class="text-button danger" @click="clearItems">清空所有</button>
        </div>
      </div>

      <div v-if="items.length" class="result-grid">
        <article
          v-for="item in items"
          :key="item.id"
          class="result-card"
          :class="{ active: item.id === activeItem?.id, selected: selectedIds.has(item.id) }"
          @click="activeId = item.id"
        >
          <!-- 勾选框 -->
          <div class="card-select" @click.stop>
            <input
              type="checkbox"
              :checked="selectedIds.has(item.id)"
              @change="toggleSelect(item.id)"
              :title="selectedIds.has(item.id) ? '取消勾选' : '勾选加入批量操作'"
            />
          </div>

          <div class="result-art" v-html="item.svg"></div>
          <div class="result-details">
            <h4>{{ item.name }}</h4>
            <p>{{ item.value }} · {{ item.format }}</p>
          </div>
          <div class="card-actions">
            <button class="icon-button" title="打印该标签" @click.stop="selectedIds.clear(); selectedIds.add(item.id); openPrintModal('selected')">🖨️</button>
            <button class="icon-button" title="导出 SVG" @click.stop="exportSingleItem(item, 'svg')">SVG</button>
            <button class="icon-button" title="导出 PNG 高清图" @click.stop="exportSingleItem(item, 'png', 2)">PNG</button>
            <button class="icon-button danger-icon" title="移除该项" @click.stop="removeItem(item.id)">×</button>
          </div>
        </article>
      </div>
      <div v-else class="library-empty">
        尚未生成条形码。单个生成或批量生成后的结果将保存在这里，支持随时多格式批量导出与排版打印。
      </div>
    </section>

    <!-- 底部状态栏 -->
    <footer class="statusbar" :class="`status-${statusKind}`">
      <span class="status-dot"></span>
      <p>{{ status }}</p>
      <span>本地计算 · 多格式矢量/高清输出 · 毫米级批量打印</span>
    </footer>

    <!-- 批量导出模态弹窗 -->
    <div v-if="isExportModalOpen" class="modal-overlay" @click.self="!isExporting && (isExportModalOpen = false)">
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <p class="eyebrow">BATCH EXPORT OPTIONS</p>
            <h3>批量导出条形码</h3>
          </div>
          <button class="modal-close" :disabled="isExporting" @click="isExportModalOpen = false">×</button>
        </div>

        <div class="modal-body">
          <!-- 导出范围 -->
          <div class="modal-section">
            <label class="section-title">导出范围</label>
            <div class="pill-group">
              <label class="pill-option" :class="{ active: exportScope === 'all' }">
                <input type="radio" value="all" v-model="exportScope" />
                <span>全部条码 ({{ items.length }} 个)</span>
              </label>
              <label
                class="pill-option"
                :class="{ active: exportScope === 'selected', disabled: selectedCount === 0 }"
              >
                <input type="radio" value="selected" v-model="exportScope" :disabled="selectedCount === 0" />
                <span>已勾选条码 ({{ selectedCount }} 个)</span>
              </label>
            </div>
          </div>

          <!-- 导出格式 -->
          <div class="modal-section">
            <label class="section-title">导出格式</label>
            <div class="format-grid">
              <label class="format-card" :class="{ active: exportConfig.format === 'svg' }">
                <input type="radio" value="svg" v-model="exportConfig.format" />
                <div class="format-tag">SVG</div>
                <div class="format-info">
                  <strong>矢量图 (.svg)</strong>
                  <span>无限放大不失真 · 包装印刷设计首选</span>
                </div>
              </label>

              <label class="format-card" :class="{ active: exportConfig.format === 'png' }">
                <input type="radio" value="png" v-model="exportConfig.format" />
                <div class="format-tag">PNG</div>
                <div class="format-info">
                  <strong>高清位图 (.png)</strong>
                  <span>高分辨率 · 直插 Excel/Word/标签打印机</span>
                </div>
              </label>

              <label class="format-card" :class="{ active: exportConfig.format === 'jpeg' }">
                <input type="radio" value="jpeg" v-model="exportConfig.format" />
                <div class="format-tag">JPG</div>
                <div class="format-info">
                  <strong>标准图片 (.jpg)</strong>
                  <span>纯白底色 · 兼容所有通用图片查看器</span>
                </div>
              </label>

              <label class="format-card" :class="{ active: exportConfig.format === 'webp' }">
                <input type="radio" value="webp" v-model="exportConfig.format" />
                <div class="format-tag">WebP</div>
                <div class="format-info">
                  <strong>轻量图片 (.webp)</strong>
                  <span>极高压缩率 · 适合网页及移动端展示</span>
                </div>
              </label>

              <label class="format-card" :class="{ active: exportConfig.format === 'both' }">
                <input type="radio" value="both" v-model="exportConfig.format" />
                <div class="format-tag">ALL</div>
                <div class="format-info">
                  <strong>SVG + PNG 双格式合集</strong>
                  <span>自动建立分类子目录 · 一站式完整归档</span>
                </div>
              </label>
            </div>
          </div>

          <!-- 分辨率倍率 (针对位图格式) -->
          <div class="modal-section" v-if="exportConfig.format !== 'svg'">
            <label class="section-title">位图清晰度 / 分辨率倍率</label>
            <div class="pill-group">
              <label class="pill-option" :class="{ active: exportConfig.scale === 1 }">
                <input type="radio" :value="1" v-model="exportConfig.scale" />
                <span>1x 标准 (100% 原始尺寸)</span>
              </label>
              <label class="pill-option" :class="{ active: exportConfig.scale === 2 }">
                <input type="radio" :value="2" v-model="exportConfig.scale" />
                <span>2x 高清 (推荐 · 200% 清晰显示)</span>
              </label>
              <label class="pill-option" :class="{ active: exportConfig.scale === 4 }">
                <input type="radio" :value="4" v-model="exportConfig.scale" />
                <span>4x 超清 (300DPI 印刷打印级)</span>
              </label>
            </div>
          </div>

          <!-- 保存目标模式 (ZIP 压缩包 vs 本地文件夹) -->
          <div class="modal-section">
            <label class="section-title">保存方式</label>
            <div class="pill-group">
              <label class="pill-option" :class="{ active: exportConfig.target === 'zip' }">
                <input type="radio" value="zip" v-model="exportConfig.target" />
                <span>🗜️ 打包为 ZIP 压缩包 (推荐)</span>
              </label>
              <label
                class="pill-option"
                :class="{ active: exportConfig.target === 'folder', disabled: !isTauri }"
                :title="isTauri ? '直接写入指定本地文件夹' : '仅在桌面客户端支持'"
              >
                <input type="radio" value="folder" v-model="exportConfig.target" :disabled="!isTauri" />
                <span>📁 直接导出至本地文件夹 {{ !isTauri ? '(仅桌面版)' : '' }}</span>
              </label>
            </div>
          </div>

          <!-- 命名规则 -->
          <div class="modal-section">
            <label class="section-title">文件命名规则</label>
            <select v-model="exportConfig.namingPattern" class="naming-select">
              <option value="index-name-code">001_商品名称_条码 (推荐 · 有序防重)</option>
              <option value="name-code">商品名称_条码</option>
              <option value="code">仅条形码数值</option>
              <option value="name">仅商品名称</option>
            </select>
            <div class="sample-preview">
              <span>文件命名示例：</span>
              <code>{{ previewSampleFileName }}</code>
            </div>
          </div>

          <!-- 附加清单文件 -->
          <div class="modal-section">
            <label class="section-title">附加数据清单</label>
            <div class="checkbox-row">
              <label class="checkbox-label">
                <input type="checkbox" v-model="exportConfig.includeCsv" />
                <span>生成 Excel 兼容清单 (CSV UTF-8 BOM，包含条码、商品名、制式)</span>
              </label>
              <label class="checkbox-label">
                <input type="checkbox" v-model="exportConfig.includeJson" />
                <span>生成 JSON 结构化数据清单</span>
              </label>
            </div>
          </div>

          <!-- 进度指示 -->
          <div v-if="isExporting" class="export-progress-wrap">
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" :style="{ width: `${exportProgress.percent}%` }"></div>
            </div>
            <div class="progress-info">
              <span>{{ exportProgress.message }}</span>
              <b>{{ exportProgress.percent }}%</b>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="button button-secondary" :disabled="isExporting" @click="isExportModalOpen = false">
            取消
          </button>
          <button class="button button-primary" :disabled="isExporting || exportTargetItems.length === 0" @click="executeBatchExport">
            {{ isExporting ? "正在导出中…" : `开始批量导出 (${exportTargetItems.length} 项) →` }}
          </button>
        </div>
      </div>
    </div>

    <!-- 批量打印与标签排版工作台模态框 -->
    <PrintModal
      :is-open="isPrintModalOpen"
      :items="items"
      :selected-ids="selectedIds"
      @close="isPrintModalOpen = false"
    />
  </main>
</template>
