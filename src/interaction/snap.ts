// snap.ts — منطق الالتقاط المغناطيسي، دالات خالصة بلا أي اعتماد على DOM أو React.
//
// السبب في فصله: الالتقاط هو الموضع الذي يشعر فيه المستخدم بأن الأداة «تفهم»
// أو «تعانده»، وسلوكه يحتاج اختبارات لا معاينة بصرية. لا يستورد هذا الملف شيئاً
// من الواجهة، فكل قاعدة فيه مُختبَرة في tests/snap.test.ts.
//
// قاعدة الأولوية: الأهداف الدلالية (مسند، حد بحر، طرف كمرة، مفصل، طرف حمل)
// تتقدّم على الشبكة دائماً. أي هدف دلالي داخل نطاق الالتقاط يفوز حتى لو كانت
// نقطة شبكة أقرب عددياً — لأن المستخدم يقصد المسند لا الرقم المستدير.

import { BeamModel } from "../engine/types";
import { spanBoundaries, totalLength } from "../engine/validate";
import { Selection } from "../store/beamStore";

/** شبكة الالتقاط، ومطابقة لخطوة الإزاحة بالأسهم عن قصد */
export const GRID_STEP = 0.25;

/** نطاق الالتقاط بالبكسل — يُحوَّل إلى أمتار حسب مقياس الرسم الحالي */
export const SNAP_PIXELS = 9;

/** أقل عرض مسموح لحمل موزع عند تحرير أحد طرفيه */
export const MIN_LOAD_WIDTH = GRID_STEP;

export type SnapKind = "end" | "support" | "spanBoundary" | "hinge" | "loadEdge" | "grid";

/** ترتيب الأولوية عند تعادل المسافة — الأصغر أقوى */
const PRIORITY: Record<SnapKind, number> = {
  end: 0,
  support: 1,
  spanBoundary: 2,
  hinge: 3,
  loadEdge: 4,
  grid: 9,
};

export interface SnapTarget {
  x: number;
  kind: SnapKind;
  /** تسمية عربية تُعرض في دليل الالتقاط أثناء السحب */
  label: string;
}

export interface SnapResult {
  /** الموضع النهائي بعد التقييد والالتقاط */
  x: number;
  /** الموضع بعد التقييد وقبل الالتقاط */
  raw: number;
  /** الهدف الذي التُقط إليه، أو null إذا لم يحدث التقاط */
  target: SnapTarget | null;
}

/** ما يجري سحبه — طرف واحد من حمل موزع أو العنصر كله */
export interface DragSubject {
  sel: Selection;
  /** عند تحرير حمل موزع: أي طرف يُسحب */
  edge?: "from" | "to";
}

const fmt = (v: number): string => {
  const r = Number(v.toFixed(3));
  return Object.is(r, -0) ? "0" : String(r);
};

function dedupe(targets: SnapTarget[]): SnapTarget[] {
  const out: SnapTarget[] = [];
  for (const t of targets) {
    const existing = out.find((o) => Math.abs(o.x - t.x) < 1e-9);
    if (!existing) {
      out.push(t);
    } else if (PRIORITY[t.kind] < PRIORITY[existing.kind]) {
      out[out.indexOf(existing)] = t;
    }
  }
  return out.sort((a, b) => a.x - b.x);
}

/**
 * أهداف الالتقاط الدلالية للنموذج، مستثنىً منها موضع العنصر المسحوب نفسه —
 * وإلا التصق بموضعه الأصلي ولم يتحرك.
 *
 * لا نضيف أنصاف البحور: هدف بلا معنى إنشائي يزيد عدد نقاط اللزق فيصير
 * التحديد الدقيق أصعب لا أسهل. الشبكة تغطي هذه الحاجة بشكل أكثر قابلية للتوقع.
 */
export function collectSnapTargets(model: BeamModel, subject?: DragSubject): SnapTarget[] {
  const L = totalLength(model);
  const targets: SnapTarget[] = [
    { x: 0, kind: "end", label: "بداية الكمرة" },
    { x: L, kind: "end", label: "نهاية الكمرة" },
  ];

  spanBoundaries(model)
    .slice(1, -1)
    .forEach((b, i) => {
      targets.push({ x: b, kind: "spanBoundary", label: `حد البحر ${i + 1}/${i + 2}` });
    });

  model.supports.forEach((s, i) => {
    if (subject?.sel.kind === "support" && subject.sel.index === i) return;
    targets.push({ x: s.at, kind: "support", label: `مسند عند ${fmt(s.at)} م` });
  });

  (model.hinges ?? []).forEach((h, i) => {
    if (subject?.sel.kind === "hinge" && subject.sel.index === i) return;
    targets.push({ x: h.at, kind: "hinge", label: `مفصل عند ${fmt(h.at)} م` });
  });

  model.loads.forEach((l, i) => {
    const isSelf = subject?.sel.kind === "load" && subject.sel.index === i;
    if (l.type === "point" || l.type === "moment") {
      if (isSelf) return;
      targets.push({ x: l.at, kind: "loadEdge", label: `حمل عند ${fmt(l.at)} م` });
      return;
    }
    // عند تحرير طرف من حمل موزع، الطرف المقابل هدف مشروع (لكن يمنعه حد العرض الأدنى)
    if (isSelf && subject?.edge === undefined) return;
    if (!(isSelf && subject?.edge === "from")) {
      targets.push({ x: l.from, kind: "loadEdge", label: `بداية حمل عند ${fmt(l.from)} م` });
    }
    if (!(isSelf && subject?.edge === "to")) {
      targets.push({ x: l.to, kind: "loadEdge", label: `نهاية حمل عند ${fmt(l.to)} م` });
    }
  });

  return dedupe(targets.filter((t) => t.x >= -1e-9 && t.x <= L + 1e-9));
}

export interface SnapOptions {
  /** الحد الأدنى المسموح للموضع */
  min?: number;
  /** الحد الأعلى المسموح للموضع */
  max?: number;
  /** خطوة الشبكة — صفر أو undefined يلغي التقاط الشبكة */
  grid?: number;
  /** false يلغي الالتقاط كلياً (مفتاح Alt أثناء السحب) */
  enabled?: boolean;
}

export function snapPosition(
  rawInput: number,
  targets: SnapTarget[],
  tolerance: number,
  opts: SnapOptions = {}
): SnapResult {
  const min = opts.min ?? Number.NEGATIVE_INFINITY;
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  const raw = Math.min(Math.max(rawInput, min), max);

  if (opts.enabled === false || !Number.isFinite(tolerance) || tolerance <= 0) {
    return { x: raw, raw, target: null };
  }

  // الأهداف الدلالية أولاً — أي هدف داخل النطاق يتقدّم على الشبكة
  const semantic = targets
    .filter((t) => t.x >= min - 1e-9 && t.x <= max + 1e-9 && Math.abs(t.x - raw) <= tolerance)
    .sort((a, b) => {
      const d = Math.abs(a.x - raw) - Math.abs(b.x - raw);
      if (Math.abs(d) > 1e-12) return d;
      return PRIORITY[a.kind] - PRIORITY[b.kind];
    });

  if (semantic.length > 0) {
    const t = semantic[0];
    return { x: t.x, raw, target: t };
  }

  const grid = opts.grid ?? 0;
  if (grid > 0) {
    const g = Math.round(raw / grid) * grid;
    if (g >= min - 1e-9 && g <= max + 1e-9 && Math.abs(g - raw) <= tolerance) {
      // تصفية خطأ الفاصلة العائمة الناتج عن الضرب
      const clean = Number(g.toFixed(9));
      return { x: clean, raw, target: { x: clean, kind: "grid", label: `شبكة ${fmt(clean)} م` } };
    }
  }

  return { x: raw, raw, target: null };
}

/** المدى المسموح لموضع العنصر المسحوب — يمنع المُدخلات التي يرفضها المحرك أصلاً */
export function dragBounds(
  model: BeamModel,
  subject: DragSubject
): { min: number; max: number } {
  const L = totalLength(model);

  if (subject.sel.kind === "hinge") {
    // المفصل يجب أن يبقى داخل الكمرة بشكل صريح لا على طرفها
    return { min: GRID_STEP, max: Math.max(GRID_STEP, L - GRID_STEP) };
  }

  if (subject.sel.kind === "load") {
    const l = model.loads[subject.sel.index];
    if (!l) return { min: 0, max: L };
    if (l.type === "point" || l.type === "moment") return { min: 0, max: L };
    if (subject.edge === "from") return { min: 0, max: l.to - MIN_LOAD_WIDTH };
    if (subject.edge === "to") return { min: l.from + MIN_LOAD_WIDTH, max: L };
    // نقل الحمل الموزع كوحدة: الطول محفوظ فالطرف الأيسر مقيَّد بالعرض
    return { min: 0, max: Math.max(0, L - (l.to - l.from)) };
  }

  return { min: 0, max: L };
}

/** الموضع الحالي للعنصر المسحوب — نقطة البداية للسحب النسبي */
export function subjectPosition(model: BeamModel, subject: DragSubject): number {
  const { sel, edge } = subject;
  if (sel.kind === "support") return model.supports[sel.index]?.at ?? 0;
  if (sel.kind === "hinge") return (model.hinges ?? [])[sel.index]?.at ?? 0;
  if (sel.kind === "load") {
    const l = model.loads[sel.index];
    if (!l) return 0;
    if (l.type === "point" || l.type === "moment") return l.at;
    return edge === "to" ? l.to : l.from;
  }
  return 0;
}
