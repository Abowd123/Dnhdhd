// deflection.ts — منحنيا الميل والترخيم بتكامل مزدوج مضبوط لـ M/EI.
//
// اصطلاح الإشارات: v إزاحة رأسية بالمتر، لأعلى موجب. θ = dv/dx بالراديان،
// عكس عقارب الساعة موجب. والعلاقة الحاكمة EI·v″ = M باصطلاح العزم الموجب
// عند الترخيم لأسفل (شد بالألياف السفلية) — يمكن التحقق منها على كمرة بسيطة
// بحمل لأسفل: M > 0 والكمرة تتقوس محدَّبة لأعلى فـ v″ > 0.
//
// ثابتا التكامل v₀ و θ₀ يأتيان من متجه درجات الحرية المحلول مباشرة، لا
// بالتخمين. وبما أن طريقة الصلابة تعطي القيم العقدية مضبوطة لكمرة
// أويلر-برنولي، فالمنحنى الناتج مضبوط لا تقريبي.
//
// الاستمرارية: v مستمرة في كل الأحوال. θ تنفصل عند المفصل الداخلي فقط،
// ويعالجها dofMap تلقائياً لأن كل عنصر يقرأ درجة الدوران الخاصة بجانبه.

import { fail } from "./errors";
import type { BeamDiagrams } from "./internalForces";
import { evalPoly, polyRootsIn, polyRootsShifted } from "./poly";
import type { BeamSolution } from "./solver";
import { GEOM_TOL } from "./types";

export const DEFLECTION_WARN_TOL = 1e-8;
export const DEFLECTION_FAIL_TOL = 1e-5;

export interface ElementDeflection {
  index: number;
  x0: number;
  x1: number;
  L: number;
  EI: number;
  spanId: string;
  /** θ(s) — الدرجة الرابعة */
  tc: [number, number, number, number, number];
  /** v(s) — الدرجة الخامسة */
  vc: [number, number, number, number, number, number];
  /** معاملات M(s) — محفوظة لتحديد قمم الميل (θ′ = M/EI) */
  mc: readonly [number, number, number, number];
}

export interface DeflectionPoint {
  x: number;
  /** متر — لأسفل سالب */
  v: number;
  /** راديان */
  theta: number;
  elementIndex: number;
  /** true عند انفصال الميل (مفصل داخلي) */
  thetaJump: boolean;
}

export interface DeflectionExtremum {
  x: number;
  value: number;
  elementIndex: number;
}

/**
 * قطاع بين مسندين متتاليين، أو كابولي طرفي.
 * النسبة L/δ محسوبة على الترخيم **النسبي إلى وتر المسندين** لا المطلق:
 * إن هبط مسند، فالهبوط الجسمي الصلب لا يُحدث إجهاداً ولا يخص قابلية
 * الخدمة، والمعنيّ هو التقوس بين المسندين.
 */
export interface SegmentDeflection {
  fromX: number;
  toX: number;
  kind: "internal" | "cantilever";
  /**
   * الطول المرجعي للنسبة. للكابولي نستخدم ضِعف الطول البارز —
   * عرف شائع في أكواد قابلية الخدمة، وقابل للتغيير من مكان واحد هنا.
   */
  effectiveLength: number;
  /** أقصى ترخيم نسبي إلى الوتر (م) */
  maxRelative: DeflectionExtremum;
  /** أقصى ترخيم مطلق (م) — يشمل هبوط المساند */
  maxAbsolute: DeflectionExtremum;
  /** effectiveLength / |maxRelative| — Infinity إذا لم يوجد ترخيم */
  ratio: number;
}

export interface DeflectionConsistency {
  /** أكبر خطأ نسبي بين التكامل حتى s=L والقيم العقدية من الحل */
  maxError: number;
  worstElement: number;
  ok: boolean;
}

export interface BeamDeflection {
  totalLength: number;
  elements: ElementDeflection[];
  points: DeflectionPoint[];
  maxAbsDeflection: DeflectionExtremum;
  minDeflection: DeflectionExtremum;
  maxDeflection: DeflectionExtremum;
  maxAbsRotation: DeflectionExtremum;
  segments: SegmentDeflection[];
  consistency: DeflectionConsistency;
}

export interface DeflectionOptions {
  samplesPerElement?: number;
  /** ضِعف الطول للكابولي — اضبطه 1 إذا أردت الطول البارز نفسه */
  cantileverFactor?: number;
}

export function buildDeflection(
  sol: BeamSolution,
  diagrams: BeamDiagrams,
  opts: DeflectionOptions = {}
): BeamDeflection {
  const samples = Math.max(2, Math.floor(opts.samplesPerElement ?? 40));
  const cantileverFactor = opts.cantileverFactor ?? 2;

  const elements: ElementDeflection[] = diagrams.elements.map((p) => {
    const es = sol.elements[p.index];
    const v0 = es.d[0];
    const t0 = es.d[1];
    const [m0, m1, m2, m3] = p.mc;
    const e = p.EI;
    return {
      index: p.index,
      x0: p.x0,
      x1: p.x1,
      L: p.L,
      EI: e,
      spanId: p.spanId,
      tc: [t0, m0 / e, m1 / (2 * e), m2 / (3 * e), m3 / (4 * e)],
      vc: [v0, t0, m0 / (2 * e), m1 / (6 * e), m2 / (12 * e), m3 / (20 * e)],
      mc: p.mc,
    };
  });

  const consistency = checkConsistency(sol, elements);
  const points = samplePoints(elements, samples);
  const ext = computeExtrema(elements);
  const segments = buildSegments(sol, elements, cantileverFactor);

  return {
    totalLength: diagrams.totalLength,
    elements,
    points,
    ...ext,
    segments,
    consistency,
  };
}

/**
 * فحص تناسق مستقل: التكامل من بداية العنصر حتى s = L يجب أن يعيد قيم
 * الإزاحة والدوران عند العقدة اليمنى كما جاءت من حل النظام.
 *
 * قوة هذا الفحص أنه يربط مسارين مستقلين تماماً: مسار حل المصفوفة (الذي أنتج
 * درجات الحرية) ومسار قوى النهايات ثم التكامل (الذي أنتج المنحنى). أي خطأ في
 * معامل، أو في اشتقاق ثابت تكامل، أو في تحويل وحدة EI، يكسر التطابق.
 */
function checkConsistency(
  sol: BeamSolution,
  elements: ElementDeflection[]
): DeflectionConsistency {
  let scaleV = 0;
  let scaleT = 0;
  for (const es of sol.elements) {
    scaleV = Math.max(scaleV, Math.abs(es.d[0]), Math.abs(es.d[2]));
    scaleT = Math.max(scaleT, Math.abs(es.d[1]), Math.abs(es.d[3]));
  }
  scaleV = Math.max(scaleV, 1e-12);
  scaleT = Math.max(scaleT, 1e-12);

  let maxError = 0;
  let worstElement = -1;

  for (const el of elements) {
    const target = sol.elements[el.index].d;
    const errV = Math.abs(evalPoly(el.vc, el.L) - target[2]) / scaleV;
    const errT = Math.abs(evalPoly(el.tc, el.L) - target[3]) / scaleT;
    const err = Math.max(errV, errT);
    if (err > maxError) {
      maxError = err;
      worstElement = el.index;
    }
  }

  if (maxError > DEFLECTION_FAIL_TOL) {
    const el = elements.find((e) => e.index === worstElement);
    fail(
      "EQUILIBRIUM",
      `فشل فحص تناسق الترخيم عند العنصر ${worstElement}` +
        (el ? ` (${el.x0} → ${el.x1} م)` : "") +
        `: الخطأ النسبي ${maxError.toExponential(2)}. تكامل M/EI لا يعيد الإزاحة ` +
        `والدوران العقديين المحسوبين من حل النظام، فمنحنى الترخيم غير موثوق.`,
      { maxError, worstElement }
    );
  }

  return { maxError, worstElement, ok: maxError <= DEFLECTION_WARN_TOL };
}

function samplePoints(elements: ElementDeflection[], samples: number): DeflectionPoint[] {
  const points: DeflectionPoint[] = [];

  elements.forEach((el, ei) => {
    const critical = new Set<number>([0, el.L]);
    for (let i = 1; i < samples; i++) critical.add((i * el.L) / samples);
    // قمم الترخيم: θ = 0
    for (const s of polyRootsIn(el.tc, el.L)) critical.add(s);
    // قمم الميل ونقاط انقلاب المنحنى: M = 0
    for (const s of polyRootsIn(el.mc, el.L)) critical.add(s);

    const ordered = [...critical].sort((a, b) => a - b);
    const prev = points[points.length - 1];

    ordered.forEach((s, i) => {
      const x = el.x0 + s;
      const v = evalPoly(el.vc, s);
      const theta = evalPoly(el.tc, s);
      const isJump = i === 0 && ei > 0 && prev !== undefined && Math.abs(prev.theta - theta) > 1e-12;
      if (isJump) prev.thetaJump = true;
      points.push({ x, v, theta, elementIndex: el.index, thetaJump: isJump });
    });
  });

  return points;
}

function computeExtrema(elements: ElementDeflection[]): {
  maxAbsDeflection: DeflectionExtremum;
  minDeflection: DeflectionExtremum;
  maxDeflection: DeflectionExtremum;
  maxAbsRotation: DeflectionExtremum;
} {
  const minV: DeflectionExtremum = { x: 0, value: Infinity, elementIndex: 0 };
  const maxV: DeflectionExtremum = { x: 0, value: -Infinity, elementIndex: 0 };
  const maxT: DeflectionExtremum = { x: 0, value: 0, elementIndex: 0 };

  for (const el of elements) {
    const sV = new Set<number>([0, el.L, ...polyRootsIn(el.tc, el.L)]);
    for (const s of sV) {
      const v = evalPoly(el.vc, s);
      const x = el.x0 + s;
      if (v < minV.value) Object.assign(minV, { x, value: v, elementIndex: el.index });
      if (v > maxV.value) Object.assign(maxV, { x, value: v, elementIndex: el.index });
    }
    const sT = new Set<number>([0, el.L, ...polyRootsIn(el.mc, el.L)]);
    for (const s of sT) {
      const t = evalPoly(el.tc, s);
      if (Math.abs(t) > Math.abs(maxT.value)) {
        Object.assign(maxT, { x: el.x0 + s, value: t, elementIndex: el.index });
      }
    }
  }

  if (!Number.isFinite(minV.value)) Object.assign(minV, { value: 0 });
  if (!Number.isFinite(maxV.value)) Object.assign(maxV, { value: 0 });

  const maxAbs = Math.abs(minV.value) >= Math.abs(maxV.value) ? { ...minV } : { ...maxV };

  return {
    maxAbsDeflection: maxAbs,
    minDeflection: { ...minV },
    maxDeflection: { ...maxV },
    maxAbsRotation: { ...maxT },
  };
}

function buildSegments(
  sol: BeamSolution,
  elements: ElementDeflection[],
  cantileverFactor: number
): SegmentDeflection[] {
  const supports = [...sol.supportReactions].sort((a, b) => a.at - b.at);
  if (supports.length === 0) return [];

  const L = elements[elements.length - 1].x1;
  const out: SegmentDeflection[] = [];

  const first = supports[0];
  const last = supports[supports.length - 1];

  if (first.at > GEOM_TOL) {
    out.push(measure(elements, 0, first.at, "cantilever", first.displacement, 0, cantileverFactor));
  }
  for (let i = 0; i < supports.length - 1; i++) {
    const a = supports[i];
    const b = supports[i + 1];
    const slope = (b.displacement - a.displacement) / (b.at - a.at);
    out.push(measure(elements, a.at, b.at, "internal", a.displacement, slope, cantileverFactor));
  }
  if (last.at < L - GEOM_TOL) {
    out.push(measure(elements, last.at, L, "cantilever", last.displacement, 0, cantileverFactor));
  }

  return out;
}

/**
 * قياس أقصى ترخيم في قطاع، نسبةً إلى خط مرجعي datum(x) = v_a + slope·(x − x_a).
 * القمم تُحدَّد بحل θ(s) = slope تحليلياً — لا بمسح شبكة — فالنتيجة مضبوطة.
 */
function measure(
  elements: ElementDeflection[],
  fromX: number,
  toX: number,
  kind: "internal" | "cantilever",
  datumV: number,
  slope: number,
  cantileverFactor: number
): SegmentDeflection {
  const maxRelative: DeflectionExtremum = { x: fromX, value: 0, elementIndex: 0 };
  const maxAbsolute: DeflectionExtremum = { x: fromX, value: 0, elementIndex: 0 };

  const datumAt = (x: number) => datumV + slope * (x - fromX);

  for (const el of elements) {
    if (el.x1 <= fromX + GEOM_TOL || el.x0 >= toX - GEOM_TOL) continue;

    const sLo = Math.max(0, fromX - el.x0);
    const sHi = Math.min(el.L, toX - el.x0);
    const candidates = new Set<number>([sLo, sHi]);
    for (const s of polyRootsShifted(el.tc, slope, el.L)) {
      if (s > sLo && s < sHi) candidates.add(s);
    }

    for (const s of candidates) {
      const x = el.x0 + s;
      const v = evalPoly(el.vc, s);
      const rel = v - datumAt(x);
      if (Math.abs(rel) > Math.abs(maxRelative.value)) {
        Object.assign(maxRelative, { x, value: rel, elementIndex: el.index });
      }
      if (Math.abs(v) > Math.abs(maxAbsolute.value)) {
        Object.assign(maxAbsolute, { x, value: v, elementIndex: el.index });
      }
    }
  }

  const rawLength = toX - fromX;
  const effectiveLength = kind === "cantilever" ? rawLength * cantileverFactor : rawLength;
  const ratio =
    Math.abs(maxRelative.value) > 0 ? effectiveLength / Math.abs(maxRelative.value) : Infinity;

  return { fromX, toX, kind, effectiveLength, maxRelative, maxAbsolute, ratio };
}

/** استعلام نقطي: v مستمرة، و θ قد تنفصل عند المفصل الداخلي */
export function evaluateDeflectionAt(
  def: BeamDeflection,
  x: number
): { x: number; v: number; theta: { left: number; right: number }; thetaJump: boolean } {
  const xc = Math.min(Math.max(x, 0), def.totalLength);
  const polys = def.elements;

  const leftEl =
    [...polys].reverse().find((p) => xc > p.x0 + GEOM_TOL && xc <= p.x1 + GEOM_TOL) ?? polys[0];
  const rightEl =
    polys.find((p) => xc >= p.x0 - GEOM_TOL && xc < p.x1 - GEOM_TOL) ?? polys[polys.length - 1];

  const sL = Math.min(Math.max(xc - leftEl.x0, 0), leftEl.L);
  const sR = Math.min(Math.max(xc - rightEl.x0, 0), rightEl.L);

  const theta = { left: evalPoly(leftEl.tc, sL), right: evalPoly(rightEl.tc, sR) };

  return {
    x: xc,
    v: evalPoly(leftEl.vc, sL),
    theta,
    thetaJump: Math.abs(theta.left - theta.right) > 1e-12,
  };
}
