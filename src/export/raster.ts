// raster.ts — تصدير SVG مستقل و PNG.
//
// المشكلة المركزية: عنصر SVG داخل الصفحة يعتمد على محيطه (أنماط CSS، الخطوط
// الموروثة، حجم الحاوية). حين يُنتزع إلى ملف يفقد كل ذلك. لهذا لا نُسلسل
// العنصر كما هو، بل ننسخه ثم:
//   • نُسقط سمات class (أنماط Tailwind لا معنى لها خارج الصفحة)
//   • نُثبّت عرضاً وارتفاعاً صريحين من viewBox
//   • نحقن خطاً وخلفية بيضاء داخل الفيلات الشفافة، مؤشر السحب)
//
// ملاحظة عن الخطوط في PNG: المتصفح يرسم SVG المُحوَّل إلى صورة في سياق معزول
// لا يُحمّل فيه خطوط الويب. نصوص مخططاتنا أرقام لاتينية وتسميات قصيرة، فمكدّس
// خطوط النظام يكفيها. العناوين العربية في HTML لا في SVG، فلا تتأثر.

const FONT_STACK =
  "'Segoe UI', system-ui, -apple-system, 'Noto Sans Arabic', 'Helvetica Neue', Arial, sans-serif";

export interface RasterOptions {
  /** مضاعف الدقة — 2 يكفي للعرض، 3 للطباعة */
  scale?: number;
  background?: string;
}

/** ينسخ العنصر ويُنظّفه ليصير ملفاً مستقلاً */
export function serializeSvg(source: SVGSVGElement, background = "#ffffff"): string {
  const clone = source.cloneNode(true) as SVGSVGElement;

  const viewBox = source.getAttribute("viewBox") ?? "";
  const [, , vw, vh] = viewBox.split(/\s+/).map(Number);
  const width = Number.isFinite(vw) && vw > 0 ? vw : source.clientWidth || 900;
  const height = Number.isFinite(vh) && vh > 0 ? vh : source.clientHeight || 200;
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (viewBox === "") clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  clone.removeAttribute("tabindex");

  // تنظيف: أنماط الصفحة، وعناصر التفاعل غير المرئية، ومؤشر السحب المؤقت
  clone.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
  clone.querySelectorAll("[tabindex]").forEach((el) => el.removeAttribute("tabindex"));
  clone.querySelectorAll('[fill="transparent"]').forEach((el) => el.remove());
  clone.querySelectorAll("[data-transient]").forEach((el) => el.remove());

  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `text{font-family:${FONT_STACK};}`;
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", background);
  clone.insertBefore(bg, clone.firstChild);
  clone.insertBefore(style, clone.firstChild);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** data URL بترميز UTF-8 — لا btoa: النصوص العربية تكسره */
function svgDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

export function svgToBlob(source: SVGSVGElement, background = "#ffffff"): Blob {
  return new Blob([serializeSvg(source, background)], { type: "image/svg+xml;charset=utf-8" });
}

export async function svgToPngBlob(
  source: SVGSVGElement,
  opts: RasterOptions = {}
): Promise<Blob> {
  const scale = Math.max(1, Math.min(opts.scale ?? 2, 6));
  const background = opts.background ?? "#ffffff";
  const text = serializeSvg(source, background);

  const viewBox = source.getAttribute("viewBox") ?? "";
  const [, , vw, vh] = viewBox.split(/\s+/).map(Number);
  const width = (Number.isFinite(vw) && vw > 0 ? vw : source.clientWidth || 900) * scale;
  const height = (Number.isFinite(vh) && vh > 0 ? vh : source.clientHeight || 200) * scale;

  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("تعذّر تحويل الرسم إلى صورة."));
    img.src = svgDataUrl(text);
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر الحصول على سياق رسم ثنائي الأبعاد.");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("تعذّر إنتاج ملف PNG."));
    }, "image/png");
  });
}

/** يجمع عدة رسوم في ملف SVG واحد مرتّب رأسياً — لتصدير المخططات مجتمعة */
export function stackSvgs(sources: SVGSVGElement[], gap = 12, background = "#ffffff"): Blob {
  const ns = "http://www.w3.org/2000/svg";
  const out = document.createElementNS(ns, "svg");
  let width = 0;
  let y = 0;
  const parts: { node: Element; width: number; height: number }[] = [];

  for (const source of sources) {
    const text = serializeSvg(source, background);
    const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
    const node = parsed.documentElement;
    const w = Number(node.getAttribute("width")) || 900;
    const h = Number(node.getAttribute("height")) || 200;
    parts.push({ node, width: w, height: h });
    width = Math.max(width, w);
    y += h + gap;
  }

  const height = Math.max(0, y - (parts.length > 0 ? gap : 0));
  out.setAttribute("xmlns", ns);
  out.setAttribute("width", String(width));
  out.setAttribute("height", String(height));
  out.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", background);
  out.appendChild(bg);

  let top = 0;
  for (const part of parts) {
    const group = document.createElementNS(ns, "g");
    group.setAttribute("transform", `translate(0,${top})`);
    for (const child of Array.from(part.node.childNodes)) {
      group.appendChild(document.importNode(child, true));
    }
    out.appendChild(group);
    top += part.height + gap;
  }

  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(out)}`], {
    type: "image/svg+xml;charset=utf-8",
  });
}

export function download(data: Blob, filename: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  // بعض المتصفحات تُلغي التنزيل إذا سُحب الـ URL فوراً
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, filename: string, mime: string): void {
  download(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

/** يبحث عن رسم مُعلَّم بـ data-export */
export function findExportSvg(id: string): SVGSVGElement | null {
  const el = document.querySelector(`svg[data-export="${id}"]`);
  return el instanceof SVGSVGElement ? el : null;
}
