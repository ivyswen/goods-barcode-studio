<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from "vue";
import type { BarcodeExportItem } from "../utils/exporter";
import {
  type PrintOptions,
  type PrintItemConfig,
  LABEL_PRESETS,
  flattenPrintItems,
  paginatePrintItems,
  generatePrintStyle,
} from "../utils/printer";

const props = defineProps<{
  isOpen: boolean;
  items: BarcodeExportItem[];
  selectedIds: Set<string>;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const PRINT_CONFIG_STORAGE_KEY = "goods_barcode_print_settings_v1";

const DEFAULT_PRINT_CONFIG: PrintOptions = {
  presetId: "roll-50x30",
  category: "roll",
  widthMm: 50,
  heightMm: 30,
  cols: 1,
  rows: 1,
  gapMm: 0,
  paddingMm: 2,
  pageMarginTopMm: 0,
  pageMarginLeftMm: 0,
  showName: true,
  showCodeText: true,
  showPrice: false,
  showCustomNote: false,
  customNoteText: "合格证",
  textAlign: "center",
  barcodeHeightRatio: 50,
  borderStyle: "none",
};

const printScope = ref<"all" | "selected">(props.selectedIds.size > 0 ? "selected" : "all");
const selectedPresetId = ref<string>("roll-50x30");
const batchQty = ref<number>(1);
const previewPage = ref<number>(1);
const previewZoom = ref<number>(1); // 缩放倍率
const saveFeedbackText = ref<string>("");

// 打印与排版选项
const config = reactive<PrintOptions>({ ...DEFAULT_PRINT_CONFIG });

// 每个商品的独立份数与附加参数
const itemEntries = ref<PrintItemConfig[]>([]);

// 从 localStorage 读取已保存的设置
function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(PRINT_CONFIG_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.config && typeof parsed.config === "object") {
      Object.assign(config, parsed.config);
    }
    if (parsed.selectedPresetId) {
      selectedPresetId.value = parsed.selectedPresetId;
    }
    if (typeof parsed.batchQty === "number") {
      batchQty.value = parsed.batchQty;
    }
  } catch (err) {
    console.error("加载打印持久化参数失败:", err);
  }
}

// 自动写入 localStorage 保存
function saveConfigToStorage() {
  try {
    const payload = {
      config: { ...config },
      selectedPresetId: selectedPresetId.value,
      batchQty: batchQty.value,
    };
    localStorage.setItem(PRINT_CONFIG_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("保存打印持久化参数失败:", err);
  }
}

// 恢复默认设置
function resetToDefault() {
  Object.assign(config, DEFAULT_PRINT_CONFIG);
  selectedPresetId.value = DEFAULT_PRINT_CONFIG.presetId;
  batchQty.value = 1;
  saveConfigToStorage();
  saveFeedbackText.value = "已恢复默认";
  setTimeout(() => {
    saveFeedbackText.value = "";
  }, 2000);
}

// 初始化加载配置
loadSavedConfig();

// 深度监听所有配置变动，自动同步到本地存储
watch([config, selectedPresetId, batchQty], () => {
  saveConfigToStorage();
}, { deep: true });

// 初始化商品清单
watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      const scopeItems =
        props.selectedIds.size > 0 && printScope.value === "selected"
          ? props.items.filter((it) => props.selectedIds.has(it.id))
          : props.items;

      itemEntries.value = scopeItems.map((item) => {
        const existing = itemEntries.value.find((e) => e.item.id === item.id);
        return {
          item,
          quantity: existing ? existing.quantity : 1,
          price: existing?.price ?? "",
          note: existing?.note ?? "",
        };
      });
      previewPage.value = 1;
    }
  },
  { immediate: true }
);

// 切换范围时重新过滤商品
function handleScopeChange(scope: "all" | "selected") {
  printScope.value = scope;
  const scopeItems =
    scope === "selected" && props.selectedIds.size > 0
      ? props.items.filter((it) => props.selectedIds.has(it.id))
      : props.items;

  itemEntries.value = scopeItems.map((item) => {
    const existing = itemEntries.value.find((e) => e.item.id === item.id);
    return {
      item,
      quantity: existing ? existing.quantity : 1,
      price: existing?.price ?? "",
      note: existing?.note ?? "",
    };
  });
  previewPage.value = 1;
}

// 切换预设
function applyPreset(presetId: string) {
  selectedPresetId.value = presetId;
  const preset = LABEL_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;

  config.presetId = preset.id;
  config.category = preset.category;
  config.widthMm = preset.widthMm;
  config.heightMm = preset.heightMm;
  config.cols = preset.cols ?? 1;
  config.rows = preset.rows ?? 1;
  config.gapMm = preset.gapHorizontalMm ?? 0;
  config.paddingMm = preset.labelPaddingMm ?? 2;
  config.pageMarginTopMm = preset.pageMarginTopMm ?? 0;
  config.pageMarginLeftMm = preset.pageMarginLeftMm ?? 0;
  previewPage.value = 1;
}

// 批量设置份数
function applyBatchQty() {
  const qty = Math.max(1, Math.floor(batchQty.value || 1));
  itemEntries.value.forEach((e) => (e.quantity = qty));
}

// 展开后扁平化的所有打印标签
const flattenedLabels = computed(() => {
  return flattenPrintItems(itemEntries.value);
});

// 每页容纳标签数
const itemsPerPage = computed(() => {
  if (config.category === "roll") return 1;
  return Math.max(1, config.cols * config.rows);
});

// 分页列表
const pages = computed(() => {
  return paginatePrintItems(flattenedLabels.value, itemsPerPage.value);
});

const totalPages = computed(() => Math.max(1, pages.value.length));
const totalLabelsCount = computed(() => flattenedLabels.value.length);

const currentPageItems = computed(() => {
  const pageIndex = Math.min(Math.max(0, previewPage.value - 1), pages.value.length - 1);
  return pages.value[pageIndex] || [];
});

function prevPage() {
  if (previewPage.value > 1) previewPage.value -= 1;
}

function nextPage() {
  if (previewPage.value < totalPages.value) previewPage.value += 1;
}

// 调起系统原生打印
async function handlePrint() {
  if (flattenedLabels.value.length === 0) return;

  // 1. 注入动态打印样式
  const styleEl = document.createElement("style");
  styleEl.id = "dynamic-barcode-print-style";
  styleEl.innerHTML = generatePrintStyle(config);
  document.head.appendChild(styleEl);

  await nextTick();

  // 2. 调用系统打印
  window.print();

  // 3. 打印后移除动态样式
  setTimeout(() => {
    const existing = document.getElementById("dynamic-barcode-print-style");
    if (existing) document.head.removeChild(existing);
  }, 1000);
}
</script>

<template>
  <div v-if="isOpen" class="print-modal-overlay" @click.self="emit('close')">
    <div class="print-modal-card">
      <!-- 头部 -->
      <header class="print-modal-header">
        <div class="header-title-block">
          <p class="eyebrow">BARCODE BATCH PRINTING ENGINE</p>
          <h2>批量打印与标签排版</h2>
        </div>
        <div class="header-right-actions">
          <span class="auto-save-indicator" title="所有排版及纸张尺寸修改均自动即时保存">
            <i class="auto-save-dot"></i> {{ saveFeedbackText || "设置已自动保存" }}
          </span>
          <span class="paper-stat-badge">
            共 <b>{{ totalLabelsCount }}</b> 张标签 · 折合 <b>{{ totalPages }}</b> 页纸张
          </span>
          <button class="modal-close-btn" @click="emit('close')">×</button>
        </div>
      </header>

      <!-- 主体三栏布局 -->
      <div class="print-modal-body">
        <!-- 左侧：规格与排版设置 -->
        <aside class="print-sidebar">
          <!-- 范围选择 -->
          <div class="config-group">
            <div class="group-header-with-action">
              <label class="group-title">打印范围</label>
              <button type="button" class="btn-micro" title="重置为初始默认打印参数" @click="resetToDefault">
                重置默认
              </button>
            </div>
            <div class="pill-segmented">
              <button
                type="button"
                :class="{ active: printScope === 'all' }"
                @click="handleScopeChange('all')"
              >
                全部条码 ({{ items.length }})
              </button>
              <button
                type="button"
                :class="{ active: printScope === 'selected', disabled: selectedIds.size === 0 }"
                :disabled="selectedIds.size === 0"
                @click="handleScopeChange('selected')"
              >
                已勾选 ({{ selectedIds.size }})
              </button>
            </div>
          </div>

          <!-- 纸张规格预设 -->
          <div class="config-group">
            <label class="group-title">纸张与排版规格</label>
            <select
              class="preset-select"
              v-model="selectedPresetId"
              @change="applyPreset(selectedPresetId)"
            >
              <optgroup label="热敏卷筒标签纸 (单标连续打印)">
                <option
                  v-for="p in LABEL_PRESETS.filter((x) => x.category === 'roll' && x.id !== 'custom')"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }}
                </option>
              </optgroup>
              <optgroup label="A4 / 平张拼版纸 (多行多列网格)">
                <option
                  v-for="p in LABEL_PRESETS.filter((x) => x.category === 'sheet')"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.name }}
                </option>
              </optgroup>
              <optgroup label="自定义">
                <option value="custom">自定义规格 (mm)...</option>
              </optgroup>
            </select>
          </div>

          <!-- 自定义尺寸调节 -->
          <div class="config-group" v-if="selectedPresetId === 'custom' || config.category === 'sheet'">
            <div class="dimension-grid">
              <label class="dim-field">
                <span>标签宽(mm)</span>
                <input v-model.number="config.widthMm" type="number" min="10" max="300" step="1" />
              </label>
              <label class="dim-field">
                <span>标签高(mm)</span>
                <input v-model.number="config.heightMm" type="number" min="10" max="300" step="1" />
              </label>
              <template v-if="config.category === 'sheet'">
                <label class="dim-field">
                  <span>拼版列数</span>
                  <input v-model.number="config.cols" type="number" min="1" max="10" />
                </label>
                <label class="dim-field">
                  <span>拼版行数</span>
                  <input v-model.number="config.rows" type="number" min="1" max="20" />
                </label>
                <label class="dim-field">
                  <span>间隙(mm)</span>
                  <input v-model.number="config.gapMm" type="number" min="0" max="20" step="0.5" />
                </label>
                <label class="dim-field">
                  <span>上边距(mm)</span>
                  <input v-model.number="config.pageMarginTopMm" type="number" min="0" max="50" step="0.5" />
                </label>
              </template>
            </div>
          </div>

          <!-- 标签内容开关 -->
          <div class="config-group">
            <label class="group-title">标签显示内容</label>
            <div class="switch-list">
              <label class="compact-switch">
                <input type="checkbox" v-model="config.showName" />
                <span>商品名称</span>
              </label>
              <label class="compact-switch">
                <input type="checkbox" v-model="config.showCodeText" />
                <span>人工可读数字条码</span>
              </label>
              <label class="compact-switch">
                <input type="checkbox" v-model="config.showPrice" />
                <span>零售价格 (¥)</span>
              </label>
              <label class="compact-switch">
                <input type="checkbox" v-model="config.showCustomNote" />
                <span>自定义副标题/备注</span>
              </label>
            </div>

            <div v-if="config.showCustomNote" class="custom-note-input">
              <input v-model="config.customNoteText" type="text" placeholder="例如：合格证、限时特惠、特级" />
            </div>
          </div>

          <!-- 布局细调 -->
          <div class="config-group">
            <label class="group-title">排版细节</label>
            <div class="slider-row">
              <span>条码高度占比 <b>{{ config.barcodeHeightRatio }}%</b></span>
              <input v-model.number="config.barcodeHeightRatio" type="range" min="25" max="75" step="5" />
            </div>
            <div class="slider-row">
              <span>边框虚线辅助</span>
              <select v-model="config.borderStyle" class="mini-select">
                <option value="none">无边框 (正常印刷)</option>
                <option value="dashed">浅色虚线 (便于手剪裁切)</option>
                <option value="solid">细实线</option>
              </select>
            </div>
          </div>

          <!-- 商品份数设置清单 -->
          <div class="config-group fill-group">
            <div class="group-header-with-action">
              <label class="group-title">商品打印份数</label>
              <div class="batch-qty-tool">
                <span>统设:</span>
                <input v-model.number="batchQty" type="number" min="1" max="999" class="qty-input-mini" />
                <button type="button" class="btn-micro" @click="applyBatchQty">应用</button>
              </div>
            </div>

            <div class="item-qty-scroll">
              <table class="qty-table">
                <thead>
                  <tr>
                    <th>商品品名</th>
                    <th v-if="config.showPrice" width="60">价格</th>
                    <th width="85">份数</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="entry in itemEntries" :key="entry.item.id">
                    <td class="name-cell" :title="entry.item.name">
                      <b>{{ entry.item.name }}</b>
                      <small>{{ entry.item.value }}</small>
                    </td>
                    <td v-if="config.showPrice">
                      <input
                        v-model="entry.price"
                        type="text"
                        placeholder="¥0.00"
                        class="table-input"
                      />
                    </td>
                    <td>
                      <div class="qty-stepper">
                        <button
                          type="button"
                          @click="entry.quantity = Math.max(0, entry.quantity - 1)"
                        >
                          -
                        </button>
                        <input v-model.number="entry.quantity" type="number" min="0" max="999" />
                        <button type="button" @click="entry.quantity += 1">+</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </aside>

        <!-- 右侧：所见即所得即时打印预览区 -->
        <main class="print-preview-workspace">
          <!-- 预览工具栏 -->
          <div class="preview-toolbar">
            <div class="page-nav">
              <button
                class="btn-nav"
                :disabled="previewPage <= 1"
                @click="prevPage"
                title="上一页"
              >
                ◀
              </button>
              <span class="page-indicator">
                第 <b>{{ previewPage }}</b> / {{ totalPages }} 页
              </span>
              <button
                class="btn-nav"
                :disabled="previewPage >= totalPages"
                @click="nextPage"
                title="下一页"
              >
                ▶
              </button>
            </div>

            <div class="zoom-controls">
              <span>缩放:</span>
              <button
                type="button"
                :class="{ active: previewZoom === 0.75 }"
                @click="previewZoom = 0.75"
              >
                75%
              </button>
              <button
                type="button"
                :class="{ active: previewZoom === 1 }"
                @click="previewZoom = 1"
              >
                100%
              </button>
              <button
                type="button"
                :class="{ active: previewZoom === 1.25 }"
                @click="previewZoom = 1.25"
              >
                125%
              </button>
            </div>
          </div>

          <!-- 模拟纸张画布 -->
          <div class="preview-stage-container">
            <div
              class="virtual-paper"
              :class="config.category === 'roll' ? 'paper-roll' : 'paper-sheet'"
              :style="{
                transform: `scale(${previewZoom})`,
                transformOrigin: 'top center',
                width: config.category === 'roll' ? `${config.widthMm}mm` : '210mm',
                minHeight: config.category === 'roll' ? `${config.heightMm}mm` : '297mm',
                paddingTop: config.category === 'sheet' ? `${config.pageMarginTopMm}mm` : '0',
                paddingLeft: config.category === 'sheet' ? `${config.pageMarginLeftMm}mm` : '0',
                paddingRight: config.category === 'sheet' ? `${config.pageMarginLeftMm}mm` : '0',
              }"
            >
              <!-- 纸张内标签网格 -->
              <div
                class="virtual-grid"
                :style="{
                  display: 'grid',
                  gridTemplateColumns:
                    config.category === 'roll'
                      ? '1fr'
                      : `repeat(${config.cols}, ${config.widthMm}mm)`,
                  gridAutoRows: `${config.heightMm}mm`,
                  gap: `${config.gapMm}mm`,
                }"
              >
                <div
                  v-for="(label, idx) in currentPageItems"
                  :key="idx"
                  class="virtual-label"
                  :class="[`border-${config.borderStyle}`]"
                  :style="{
                    width: `${config.widthMm}mm`,
                    height: `${config.heightMm}mm`,
                    padding: `${config.paddingMm}mm`,
                  }"
                >
                  <!-- 顶部：商品名与副标题 -->
                  <div class="label-header" v-if="config.showName || config.showCustomNote">
                    <span v-if="config.showCustomNote" class="label-badge">{{ config.customNoteText }}</span>
                    <strong v-if="config.showName" class="label-name">{{ label.item.name }}</strong>
                  </div>

                  <!-- 中部：条码图形 -->
                  <div
                    class="label-barcode-box"
                    :style="{ height: `${config.barcodeHeightRatio}%` }"
                    v-html="label.item.svg"
                  ></div>

                  <!-- 底部：价格与备注 -->
                  <div class="label-footer" v-if="config.showPrice && label.price">
                    <span class="label-price">{{ label.price.startsWith('¥') ? label.price : `¥${label.price}` }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <!-- 底部操作栏 -->
      <footer class="print-modal-footer">
        <button class="button button-secondary" @click="emit('close')">关闭</button>
        <button
          class="button button-primary"
          :disabled="totalLabelsCount === 0"
          @click="handlePrint"
        >
          <span>🖨️</span> 立即调用系统打印 ({{ totalLabelsCount }} 张标签 / {{ totalPages }} 页) →
        </button>
      </footer>
    </div>

    <!-- 隐藏式真实打印 DOM 树 (仅供 @media print 捕获并直接输出) -->
    <div id="print-portal" class="print-portal-dom">
      <div
        v-for="(page, pIdx) in pages"
        :key="pIdx"
        class="print-page"
      >
        <div
          v-for="(label, lIdx) in page"
          :key="lIdx"
          class="print-label-cell"
          :class="[`border-${config.borderStyle}`]"
          :style="{
            width: `${config.widthMm}mm`,
            height: `${config.heightMm}mm`,
            padding: `${config.paddingMm}mm`,
          }"
        >
          <div class="label-header" v-if="config.showName || config.showCustomNote">
            <span v-if="config.showCustomNote" class="label-badge">{{ config.customNoteText }}</span>
            <strong v-if="config.showName" class="label-name">{{ label.item.name }}</strong>
          </div>

          <div
            class="label-barcode-box"
            :style="{ height: `${config.barcodeHeightRatio}%` }"
            v-html="label.item.svg"
          ></div>

          <div class="label-footer" v-if="config.showPrice && label.price">
            <span class="label-price">{{ label.price.startsWith('¥') ? label.price : `¥${label.price}` }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
