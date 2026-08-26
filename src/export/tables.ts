// tables.ts — بناء جداول التصدير و CSV. دالات خالصة بلا DOM، فكلها مُختبَرة.
//
// قرارات مقصودة:
//  • علامة BOM في مقدمة كل ملف CSV: بدونها يقرأ Excel على ويندوز الملفَ
//    بترميز النظام المحلي فتتحوّل العناوين العربية إلى محارف مشوّهة.
//  • نهايات أسطر CRLF: ما ينصّ عليه RFC 4180 وما يتوقعه Excel.
//  • الفاصل قابل للاختيار: النسخ العربية والأوروبية من Excel تستخدم الفاصلة
//    المنقوطة لأن الفاصلة عندها فاصل عشري. الافتراضي فاصلة، والبديل معلن.
//  • الأرقام لاتينية بلا فاصل آلاف: أي فاصل يُفسد التحليل الآلي للملف.
//  • عند الانفصال (حمل مركز، عزم، رد فعل، مفصل) نُصدر صفّين بالمحور السيني
//    نفسه ونُميّزهما بعمود «الجهة». طمس الانفصال بمتوسط أو باختيار جهة واحدة
//    إخفاء لمعلومة فيزيائية حقيقية.

import { BeamAnalysis, queryAt } from "../engine/analyze";
import { BeamModel } from "../engine/types";

export type Delimiter = "," | ";" | "\t";

export interface TableOptions {
  delimiter?: Delimiter;
  /** خطوة الشبكة المنتظمة بالمتر — تُدمج مع النقاط الحرجة */
  step?: number;
  /** خانات عشرية للقوى والعزوم */
  digits?: number;
  /** خانات عشرية للترخيم بالمليمتر والميل بالمِلّي‑راديان */
  digitsFine?: number;
}

export interface DiagramRow {
  x: number;
  V: number;
  M: number;
  /** مم */
  v: number;
  /** مِلّي‑راديان */
  theta: number;
  side: "" | "يسار" | "يمين";
}

const CRLF = "\r\n";
const BOM = "\uFEFF";

function csvField(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || /[\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** رقم لاتيني بلا فاصل آلاف، و−0 يُطبع 0 */
export function csvNumber(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "";
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? "0" : String(r);
}

export function toCsv(rows: (string | number | null | undefined)[][], delimiter: Delimiter = ","): string {
  const body = rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return "";
          return csvField(typeof cell === "number" ? csvNumber(cell) : cell, delimiter);
        })
        .join(delimiter)
    )
    .join(CRLF);
  return BOM + body + CRLF;
}

/**
 * قائمة المواضع المُصدَّرة: اتحاد النقاط الحرجة من المنحنيات ومن الترخيم، مع
 * شبكة منتظمة. النقاط الحرجة (قمم، أصفار، عقد) تُدرج لأن الشبكة وحدها تفوّتها،
 * وهي أهم ما في الجدول.
 */
function exportPositions(analysis: BeamAnalysis, step: number): number[] {
  const L = analysis.diagrams.totalLength;
  const set = new Set<number>([0, L]);
  const add = (x: number) => set.add(Number(Math.min(Math.max(x, 0), L).toFixed(9)));

  for (const p of analysis.diagrams.points) add(p.x);
  for (const p of analysis.deflection.points) add(p.x);
  if (step > 0) {
    for (let x = 0; x <= L + 1e-9; x += step) add(x);
  }
  return [...set].sort((a, b) => a - b);
}

/** جدول القيم على طول الكمرة — الصفّان عند الانفصال مُميَّزان بعمود الجهة */
export function diagramRows(analysis: BeamAnalysis, opts: TableOptions = {}): DiagramRow[] {
  const step = opts.step ?? 0.1;
  const rows: DiagramRow[] = [];

  for (const x of exportPositions(analysis, step)) {
    const q = queryAt(analysis, x);
    const split = q.forceJump || q.thetaJump;
    if (!split) {
      rows.push({ x, V: q.V.left, M: q.M.left, v: q.v * 1000, theta: q.theta.left * 1000, side: "" });
      continue;
    }
    rows.push({
      x,
      V: q.V.left,
      M: q.M.left,
      v: q.v * 1000,
      theta: q.theta.left * 1000,
      side: "يسار",
    });
    rows.push({
      x,
      V: q.V.right,
      M: q.M.right,
      v: q.v * 1000,
      theta: q.theta.right * 1000,
      side: "يمين",
    });
  }
  return rows;
}

export function diagramsCsv(analysis: BeamAnalysis, opts: TableOptions = {}): string {
  const d = opts.digits ?? 4;
  const f = opts.digitsFine ?? 6;
  const rows: (string | number)[][] = [
    ["الموضع x (م)", "الجهة", "قوة القص V (kN)", "عزم الانحناء M (kN·m)", "الترخيم (مم)", "الميل (مِلّي‑راديان)"],
  ];
  for (const r of diagramRows(analysis, opts)) {
    rows.push([
      csvNumber(r.x, 6),
      r.side,
      csvNumber(r.V, d),
      csvNumber(r.M, d),
      csvNumber(r.v, f),
      csvNumber(r.theta, f),
    ]);
  }
  return toCsv(rows, opts.delimiter);
}

export function reactionsCsv(analysis: BeamAnalysis, opts: TableOptions = {}): string {
  const d = opts.digits ?? 4;
  const labels: Record<string, string> = {
    fixed: "تثبيت تام",
    pinned: "مسند مفصلي",
    roller: "مسند متحرك",
    spring: "مسند مرن (نابض)",
  };
  const rows: (string | number)[][] = [
    ["الموضع (م)", "نوع المسند", "القوة الرأسية (kN)", "العزم (kN·m)", "الإزاحة (مم)"],
  ];
  let total = 0;
  for (const r of analysis.solution.supportReactions) {
    total += r.Fy;
    rows.push([
      csvNumber(r.at, 6),
      labels[r.type] ?? r.type,
      csvNumber(r.Fy, d),
      r.Mz === null ? "" : csvNumber(r.Mz, d),
      csvNumber(r.displacement * 1000, 6),
    ]);
  }
  rows.push(["المجموع", "", csvNumber(total, d), "", ""]);
  return toCsv(rows, opts.delimiter);
}

export function serviceabilityCsv(analysis: BeamAnalysis, limit: number, opts: TableOptions = {}): string {
  const rows: (string | number)[][] = [
    [
      "من (م)",
      "إلى (م)",
      "النوع",
      "الطول المرجعي (م)",
      "أقصى ترخيم نسبي (مم)",
      "موضعه (م)",
      "أقصى ترخيم مطلق (مم)",
      "L/δ",
      `مقابل L/${limit}`,
    ],
  ];
  for (const s of analysis.deflection.segments) {
    rows.push([
      csvNumber(s.fromX, 6),
      csvNumber(s.toX, 6),
      s.kind === "cantilever" ? "كابولي" : "بين مسندين",
      csvNumber(s.effectiveLength, 6),
      csvNumber(s.maxRelative.value * 1000, 6),
      csvNumber(s.maxRelative.x, 6),
      csvNumber(s.maxAbsolute.value * 1000, 6),
      Number.isFinite(s.ratio) ? csvNumber(s.ratio, 1) : "∞",
      s.ratio >= limit ? "داخل الحد" : "يتجاوز الحد",
    ]);
  }
  return toCsv(rows, opts.delimiter);
}

/** جدول القيم القصوى ونتائج الفحوص — ما يُنسخ عادةً إلى تقرير */
export function summaryCsv(analysis: BeamAnalysis, opts: TableOptions = {}): string {
  const d = opts.digits ?? 4;
  const e = analysis.diagrams.extrema;
  const f = analysis.deflection;
  const h = analysis.health;
  const rows: (string | number)[][] = [
    ["الكمية", "القيمة", "الوحدة", "الموضع (م)"],
    ["أقصى قص (مطلقاً)", csvNumber(e.maxAbsV.value, d), "kN", csvNumber(e.maxAbsV.x, 6)],
    ["أقصى عزم موجب", csvNumber(e.maxM.value, d), "kN·m", csvNumber(e.maxM.x, 6)],
    ["أقصى عزم سالب", csvNumber(e.minM.value, d), "kN·m", csvNumber(e.minM.x, 6)],
    [
      "أقصى ترخيم (مطلقاً)",
      csvNumber(f.maxAbsDeflection.value * 1000, 6),
      "مم",
      csvNumber(f.maxAbsDeflection.x, 6),
    ],
    [
      "أقصى ميل",
      csvNumber(f.maxAbsRotation.value * 1000, 6),
      "مِلّي‑راديان",
      csvNumber(f.maxAbsRotation.x, 6),
    ],
    ["نقاط انعدام العزم", analysis.diagrams.momentZeros.map((z) => csvNumber(z, 4)).join(" | "), "م", ""],
    [],
    ["الفحص", "الخطأ النسبي", "", ""],
    ["توازن القوى الرأسية", h.equilibriumFy.toExponential(3), "", ""],
    ["توازن العزوم", h.equilibriumMz.toExponential(3), "", ""],
    ["استمرارية المنحنيات", h.continuity.toExponential(3), "", ""],
    ["تناسق تكامل M/EI", h.deflectionConsistency.toExponential(3), "", ""],
    ["متبقي حل النظام", h.solveResidual.toExponential(3), "", ""],
    ["تقدير سوء التكييف", h.conditionHint.toExponential(3), "", ""],
    ["الحصيلة", h.ok ? "كل الفحوص مُجتازة" : "تحذير — راجع القيم أعلاه", "", ""],
  ];
  return toCsv(rows, opts.delimiter);
}

/** وصف النموذج نفسه — يُصدَّر مع النتائج حتى تبقى الأرقام قابلة للتفسير */
export function modelCsv(model: BeamModel, opts: TableOptions = {}): string {
  const rows: (string | number)[][] = [["النوع", "المعرّف/الوصف", "قيمة 1", "قيمة 2", "قيمة 3"]];
  rows.push(["", "", "", "", ""]);
  rows.push(["بحور", "المعرّف", "الطول (م)", "E (GPa)", "I (m⁴)"]);
  for (const s of model.spans) {
    rows.push(["بحر", s.id, csvNumber(s.length, 6), csvNumber(s.E, 6), csvNumber(s.I, 10)]);
  }
  rows.push([]);
  rows.push(["مساند", "النوع", "الموضع (م)", "جساءة (kN/m)", "هبوط (مم)"]);
  for (const s of model.supports) {
    rows.push([
      "مسند",
      s.type,
      csvNumber(s.at, 6),
      s.springStiffness === undefined ? "" : csvNumber(s.springStiffness, 6),
      s.settlement === undefined ? "" : csvNumber(s.settlement * 1000, 6),
    ]);
  }
  if ((model.hinges ?? []).length > 0) {
    rows.push([]);
    rows.push(["مفاصل", "", "الموضع (م)", "", ""]);
    for (const h of model.hinges ?? []) rows.push(["مفصل", "", csvNumber(h.at, 6), "", ""]);
  }
  rows.push([]);
  rows.push(["أحمال", "النوع", "من/عند (م)", "إلى (م)", "القيمة"]);
  for (const l of model.loads) {
    if (l.type === "point") rows.push(["حمل", "مركز", csvNumber(l.at, 6), "", csvNumber(l.magnitude, 6)]);
    else if (l.type === "moment") rows.push(["حمل", "عزم", csvNumber(l.at, 6), "", csvNumber(l.magnitude, 6)]);
    else if (l.type === "udl")
      rows.push(["حمل", "موزع منتظم", csvNumber(l.from, 6), csvNumber(l.to, 6), csvNumber(l.w, 6)]);
    else
      rows.push([
        "حمل",
        "موزع متغير",
        csvNumber(l.from, 6),
        csvNumber(l.to, 6),
        `${csvNumber(l.w1, 6)} → ${csvNumber(l.w2, 6)}`,
      ]);
  }
  return toCsv(rows, opts.delimiter);
}
