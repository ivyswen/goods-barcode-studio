/**
 * 条码导出与格式转换工具库
 */

export type ExportFormat = "svg" | "png" | "jpeg" | "webp" | "both"; // both = svg + png
export type ImageScale = 1 | 2 | 4;
export type NamingPattern = "index-name-code" | "name-code" | "code" | "name";
export type ExportTarget = "zip" | "folder";

export interface BarcodeExportItem {
  id: string;
  name: string;
  value: string;
  format: string;
  svg: string;
  createdAt: string;
}

export interface ExportFileResult {
  fileName: string;
  folder?: string;
  bytes: Uint8Array;
  blob: Blob;
  mimeType: string;
}

export interface BatchExportOptions {
  format: ExportFormat;
  scale: ImageScale;
  namingPattern: NamingPattern;
  includeCsv: boolean;
  includeJson: boolean;
  backgroundColor: string;
  onProgress?: (current: number, total: number, message: string) => void;
}

/**
 * 净化文件名，去除跨平台非法字符
 */
export function sanitizeFileName(name: string, fallback: string = "barcode"): string {
  const clean = (name || fallback).trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "_").replace(/-+/g, "-").replace(/_+/g, "_");
  return clean.slice(0, 80) || fallback;
}

/**
 * 根据命名规则生成文件名主体（不含扩展名）
 */
export function formatFileNameBody(item: { name: string; value: string }, index: number, pattern: NamingPattern): string {
  const indexPrefix = String(index + 1).padStart(3, "0");
  const cleanName = sanitizeFileName(item.name, "商品");
  const cleanCode = sanitizeFileName(item.value, "条码");

  switch (pattern) {
    case "index-name-code":
      return `${indexPrefix}_${cleanName}_${cleanCode}`;
    case "name-code":
      return `${cleanName}_${cleanCode}`;
    case "code":
      return cleanCode;
    case "name":
      return cleanName;
    default:
      return `${indexPrefix}_${cleanName}_${cleanCode}`;
  }
}

/**
 * 将 SVG 解析并绘制到 HTML5 Canvas
 */
export async function renderSvgToCanvas(
  svgString: string,
  scale: number = 2,
  backgroundColor: string = "#ffffff"
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgString, "image/svg+xml");
      const svgEl = doc.querySelector("svg");
      if (!svgEl) {
        return reject(new Error("无效的 SVG 内容"));
      }

      // 获取 SVG 的自然尺寸
      let width = parseFloat(svgEl.getAttribute("width") || "0");
      let height = parseFloat(svgEl.getAttribute("height") || "0");

      if (!width || !height) {
        const viewBox = svgEl.getAttribute("viewBox");
        if (viewBox) {
          const parts = viewBox.split(/\s+/).map(Number);
          if (parts.length === 4) {
            width = parts[2];
            height = parts[3];
          }
        }
      }

      if (!width || !height) {
        width = 300;
        height = 120;
      }

      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));

      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return reject(new Error("Canvas 渲染上下文创建失败"));
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        // 背景填充
        if (backgroundColor && backgroundColor !== "transparent") {
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(0, 0, targetWidth, targetHeight);
        }

        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        resolve(canvas);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("SVG 渲染到图像失败"));
      };

      img.src = url;
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 将 Canvas 转为指定格式的 Blob 与 Uint8Array
 */
export async function canvasToBytes(
  canvas: HTMLCanvasElement,
  format: "png" | "jpeg" | "webp",
  quality: number = 0.95
): Promise<{ bytes: Uint8Array; blob: Blob; mimeType: string }> {
  const mimeType = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          return reject(new Error(`无法生成 ${format.toUpperCase()} 图像数据`));
        }
        const arrayBuffer = await blob.arrayBuffer();
        resolve({
          bytes: new Uint8Array(arrayBuffer),
          blob,
          mimeType,
        });
      },
      mimeType,
      quality
    );
  });
}

/**
 * 转换单个条码 SVG 为目标格式文件数据
 */
export async function convertBarcode(
  item: BarcodeExportItem,
  format: "svg" | "png" | "jpeg" | "webp",
  scale: ImageScale = 2,
  backgroundColor: string = "#ffffff"
): Promise<{ bytes: Uint8Array; blob: Blob; mimeType: string; extension: string }> {
  if (format === "svg") {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(item.svg);
    const blob = new Blob([bytes], { type: "image/svg+xml;charset=utf-8" });
    return {
      bytes,
      blob,
      mimeType: "image/svg+xml",
      extension: "svg",
    };
  }

  // 需要纯白底防止透明背景在某些查看器中变黑 (尤其对于 JPEG)
  const bg = format === "jpeg" ? (backgroundColor || "#ffffff") : backgroundColor;
  const canvas = await renderSvgToCanvas(item.svg, scale, bg);
  const result = await canvasToBytes(canvas, format);
  const extension = format === "jpeg" ? "jpg" : format;

  return {
    bytes: result.bytes,
    blob: result.blob,
    mimeType: result.mimeType,
    extension,
  };
}

/**
 * 生成带 UTF-8 BOM 的 CSV 清单，确保在 Excel / WPS 中打开不乱码且条码不被识别为科学计数法
 */
export function generateCsvManifest(
  entries: Array<{ index: number; name: string; value: string; format: string; fileName: string }>
): Uint8Array {
  const header = ["序号", "商品名称", "条形码内容", "条形码制式", "输出文件名称"];
  const rows = entries.map((entry) => [
    entry.index,
    `"${entry.name.replace(/"/g, '""')}"`,
    `"\t${entry.value.replace(/"/g, '""')}"`, // 前置制表符，强制 Excel 作为纯文本处理，防止科学计数法与丢失前导0
    `"${entry.format}"`,
    `"${entry.fileName.replace(/"/g, '""')}"`,
  ]);

  const csvContent = [header.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]); // UTF-8 BOM
  const encoded = new TextEncoder().encode(csvContent);
  const result = new Uint8Array(bom.length + encoded.length);
  result.set(bom, 0);
  result.set(encoded, bom.length);
  return result;
}

/**
 * 生成结构化 JSON 清单
 */
export function generateJsonManifest(
  entries: Array<{ index: number; name: string; value: string; format: string; fileName: string }>
): Uint8Array {
  const data = {
    generator: "条码工坊 (Goods Barcode Studio)",
    exportedAt: new Date().toISOString(),
    totalCount: entries.length,
    items: entries,
  };
  return new TextEncoder().encode(JSON.stringify(data, null, 2));
}

/**
 * 浏览器端触发文件下载
 */
export function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * 复制图像到系统剪贴板 (PNG 格式)
 */
export async function copyImageToClipboard(svgString: string, scale: number = 2, backgroundColor: string = "#ffffff"): Promise<void> {
  const canvas = await renderSvgToCanvas(svgString, scale, backgroundColor);
  const { blob } = await canvasToBytes(canvas, "png");
  if (!navigator.clipboard || !navigator.clipboard.write) {
    throw new Error("当前环境不支持直接写入剪贴板图像");
  }
  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob,
    }),
  ]);
}

/**
 * 复制文本内容到剪贴板
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}
