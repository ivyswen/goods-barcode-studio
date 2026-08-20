/**
 * 条码批量打印与标签排版工具
 */
import type { BarcodeExportItem } from "./exporter";

export interface LabelPreset {
  id: string;
  name: string;
  category: "roll" | "sheet"; // roll: 卷筒单标连续纸; sheet: A4/平张拼版纸
  widthMm: number;            // 标签宽 (mm)
  heightMm: number;           // 标签高 (mm)
  sheetType?: "A4" | "A5" | "custom";
  rows?: number;              // 拼版行数 (仅 sheet)
  cols?: number;              // 拼版列数 (仅 sheet)
  pageMarginTopMm?: number;   // 页面上边距
  pageMarginLeftMm?: number;  // 页面左边距
  gapHorizontalMm?: number;   // 标签水平间隙
  gapVerticalMm?: number;     // 标签垂直间隙
  labelPaddingMm?: number;    // 标签内边距
}

export interface PrintItemConfig {
  item: BarcodeExportItem;
  quantity: number;
  price?: string;
  note?: string;
}

export interface PrintOptions {
  presetId: string;
  category: "roll" | "sheet";
  widthMm: number;
  heightMm: number;
  cols: number;
  rows: number;
  gapMm: number;
  paddingMm: number;
  pageMarginTopMm: number;
  pageMarginLeftMm: number;
  
  // 标签视觉与内容开关
  showName: boolean;
  showCodeText: boolean;
  showPrice: boolean;
  showCustomNote: boolean;
  customNoteText: string;
  textAlign: "center" | "left";
  barcodeHeightRatio: number; // 20 - 70 %
  borderStyle: "none" | "solid" | "dashed";
}

/**
 * 常用标准标签规格预设
 */
export const LABEL_PRESETS: LabelPreset[] = [
  // 卷筒热敏标签纸
  { id: "roll-40x30", name: "40 × 30 mm (常用热敏小标)", category: "roll", widthMm: 40, heightMm: 30, labelPaddingMm: 1.5 },
  { id: "roll-50x30", name: "50 × 30 mm (商品/服装通用标)", category: "roll", widthMm: 50, heightMm: 30, labelPaddingMm: 2 },
  { id: "roll-60x40", name: "60 × 40 mm (商超零售/食品标)", category: "roll", widthMm: 60, heightMm: 40, labelPaddingMm: 2 },
  { id: "roll-70x50", name: "70 × 50 mm (仓储货位/箱唛标)", category: "roll", widthMm: 70, heightMm: 50, labelPaddingMm: 2.5 },
  { id: "roll-80x50", name: "80 × 50 mm (大件商品/外箱标)", category: "roll", widthMm: 80, heightMm: 50, labelPaddingMm: 3 },
  { id: "roll-100x150", name: "100 × 150 mm (物流/快递面单)", category: "roll", widthMm: 100, heightMm: 150, labelPaddingMm: 4 },

  // A4 不干胶拼版纸
  {
    id: "a4-24-3x8",
    name: "A4 - 24联 (3列 × 8行 · 70×37mm)",
    category: "sheet",
    sheetType: "A4",
    widthMm: 70,
    heightMm: 37,
    cols: 3,
    rows: 8,
    pageMarginTopMm: 0,
    pageMarginLeftMm: 0,
    gapHorizontalMm: 0,
    gapVerticalMm: 0,
    labelPaddingMm: 2,
  },
  {
    id: "a4-21-3x7",
    name: "A4 - 21联 (3列 × 7行 · 63.5×38.1mm)",
    category: "sheet",
    sheetType: "A4",
    widthMm: 63.5,
    heightMm: 38.1,
    cols: 3,
    rows: 7,
    pageMarginTopMm: 15.1,
    pageMarginLeftMm: 7.2,
    gapHorizontalMm: 2.5,
    gapVerticalMm: 0,
    labelPaddingMm: 2,
  },
  {
    id: "a4-18-3x6",
    name: "A4 - 18联 (3列 × 6行 · 70×49.5mm)",
    category: "sheet",
    sheetType: "A4",
    widthMm: 70,
    heightMm: 49.5,
    cols: 3,
    rows: 6,
    pageMarginTopMm: 0,
    pageMarginLeftMm: 0,
    gapHorizontalMm: 0,
    gapVerticalMm: 0,
    labelPaddingMm: 2.5,
  },
  {
    id: "a4-12-2x6",
    name: "A4 - 12联 (2列 × 6行 · 105×48mm)",
    category: "sheet",
    sheetType: "A4",
    widthMm: 105,
    heightMm: 48,
    cols: 2,
    rows: 6,
    pageMarginTopMm: 4.5,
    pageMarginLeftMm: 0,
    gapHorizontalMm: 0,
    gapVerticalMm: 0,
    labelPaddingMm: 3,
  },
  {
    id: "custom",
    name: "自定义规格...",
    category: "roll",
    widthMm: 50,
    heightMm: 30,
    cols: 1,
    rows: 1,
    labelPaddingMm: 2,
  }
];

/**
 * 按照商品配置的打印份数展开为扁平的打印单元列表
 */
export function flattenPrintItems(items: PrintItemConfig[]): Array<{ item: BarcodeExportItem; price?: string; note?: string; printIndex: number }> {
  const result: Array<{ item: BarcodeExportItem; price?: string; note?: string; printIndex: number }> = [];
  let index = 1;

  for (const entry of items) {
    const count = Math.max(0, Math.floor(entry.quantity || 0));
    for (let i = 0; i < count; i++) {
      result.push({
        item: entry.item,
        price: entry.price,
        note: entry.note,
        printIndex: index++,
      });
    }
  }

  return result;
}

/**
 * 将扁平列表按照每页容量分组为页面列表
 */
export function paginatePrintItems<T>(items: T[], itemsPerPage: number): T[][] {
  if (itemsPerPage <= 0) return [items];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += itemsPerPage) {
    pages.push(items.slice(i, i + itemsPerPage));
  }
  return pages;
}

/**
 * 动态生成针对系统打印的 CSS 规则
 */
export function generatePrintStyle(opts: PrintOptions): string {
  if (opts.category === "roll") {
    return `
      @page {
        size: ${opts.widthMm}mm ${opts.heightMm}mm;
        margin: 0;
      }
      body {
        margin: 0;
        padding: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .print-page {
        width: ${opts.widthMm}mm;
        height: ${opts.heightMm}mm;
        page-break-after: always;
        break-after: page;
        page-break-inside: avoid;
        break-inside: avoid;
        box-sizing: border-box;
        overflow: hidden;
      }
    `;
  }

  // A4 / 平张拼版模式
  return `
    @page {
      size: A4 portrait;
      margin: ${opts.pageMarginTopMm}mm ${opts.pageMarginLeftMm}mm;
    }
    body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-page {
      width: calc(210mm - ${opts.pageMarginLeftMm * 2}mm);
      height: calc(297mm - ${opts.pageMarginTopMm * 2}mm);
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
      box-sizing: border-box;
      overflow: hidden;
      display: grid;
      grid-template-columns: repeat(${opts.cols}, ${opts.widthMm}mm);
      grid-template-rows: repeat(${opts.rows}, ${opts.heightMm}mm);
      column-gap: ${opts.gapMm}mm;
      row-gap: ${opts.gapMm}mm;
    }
  `;
}
