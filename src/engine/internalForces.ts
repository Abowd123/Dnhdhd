// internalForces.ts — منحنيات قوى القص وعزوم الانحناء.
//
// اصطلاح الإشارات (ثابت في كل المشروع):
//   V موجب حين تكون محصلة القوى الرأسية على الجزء الأيسر من القطاع لأعلى
//   M موجب عند الترخيم لأسفل (Sagging) — شد بالألياف السفلية
//   وبالتالي: dV/dx = w(x)  و  dM/dx = V(x)   حيث w لأعلى موجب
//
// داخل كل عنصر، الحمل الموزع شبه منحرف يغطيه بالكامل (ضمِنه التقطيع في
// المرحلة 1)، فـ V متعددة حدود من الدرجة الثانية و M من الدرجة الثالثة —
// تمثيل مضبوط لا تقريبي. القيم القصوى تُحل تحليلياً، فكثافة العينات تؤثر
// في نعومة الرسم فقط لا في دقة الأرقام.
//
// الانفصالات: عند كل حمل مركز أو عزم مركز أو رد فعل، تُصدَر نقطتان بالمحور
// السيني نفسه (يسار ثم يمين)، فيرسم الخط وثبة رأسية تلقائياً. إغفال هذا هو
// سبب ظهور مخطط قص مائل خاطئ عند الأحمال المركزة في كثير من الأدوات.

import { fail } from "./errors";
import { evalPoly, polyRootsIn, quadraticRootsIn } from "./poly";
import type { BeamSolution } from "./solver";
import { GEOM_TOL } from "./types";

export const CONTINUITY_WARN_TOL = 1e-8;
export const CONTINUITY_FAIL_TOL = 1e-5;

export interface ElementPolynomials {
  index: number;
  x0: number;
  x1: number;
  L: number;
  EI: number;
  spanId: string;
  /** V(s) = vc[0] + vc[1]·s + vc[2]·s² */
  vc: [number, number, number];
  /** M(s) = mc[0] + mc[1]·s + mc[2]·s² + mc[3]·s³ */
  mc: [number, number, number, number];
}

export interface DiagramPoint {
  x: number;
  V: number;
  M: number;
  elementIndex: number;
  /** true إذا كانت هذه النقطة أحد طرفَي وثبة رأسية */
  jump: boolean;
}

export interface Extremum {
  x: number;
  value: number;
  elementIndex: number;
}

export interface DiagramExtrema {
  maxV: Extremum;
  minV: Extremum;
  maxM: Extremum;
  minM: Extremum;
  maxAbsV: Extremum;
  maxAbsM: Extremum;
}

export interface PointQuery {
  x: number;
  /** القيم يسار القطاع ويمينه — متساوية إن لم يكن هناك انفصال */
  V: { left: number; right: number };
  M: { left: number; right: number };
  discontinuous: boolean;
}

export interface ContinuityCheck {
  /** أكبر خطأ نسبي في وثبات V و M عند العقد */
  maxError: number;
  worstNode: number;
  ok: boolean;
}

export interface BeamDiagrams {
  totalLength: number;
  elements: ElementPolynomials[];
  points: DiagramPoint[];
  extrema: DiagramExtrema;
  /** مواضع انعدام عزم الانحناء (نقاط الانقلاب) */
  momentZeros: number[];
  continuity: ContinuityCheck;
}

export interface DiagramOptions {
  /** عينات موزَّعة بانتظام لكل عنصر — 12 أثناء السحب، 40+ عند الاستقرار */
  samplesPerElement?: number;
}

// ————— بناء المنحنيات —————

export function buildDiagrams(sol: BeamSolution, opts: DiagramOptions = {}): BeamDiagrams {
  const samples = Math.max(2, Math.floor(opts.samplesPerElement ?? 40));
  const { beam } = sol;

  const polys: ElementPolynomials[] = beam.elements.map((el) => {
    const f = sol.elements[el.index].endForces;
    const V0 = f[0];
    const M0 = -f[1];
    const dw = (el.w2 - el.w1) / el.L;
    return {
      index: el.index,
      x0: el.x0,
      x1: el.x1,
      L: el.L,
      EI: el.EI,
      spanId: el.spanId,
      vc: [V0, el.w1, dw / 2],
      mc: [M0, V0, el.w1 / 2, dw / 6],
    };
  });

  const continuity = checkContinuity(sol, polys);
  const { points, momentZeros } = samplePoints(polys, samples);
  const extrema = computeExtrema(polys);

  return {
    totalLength: beam.totalLength,
    elements: polys,
    points,
    extrema,
    momentZeros,
    continuity,
  };
}

/**
 * فحص استمرارية مستقل: عند كل عقدة يجب أن يساوي وثب المنحنى ما تفرضه
 * الأحمال المركزة وردود الأفعال بالضبط:
 *   ΔV = P + R_Fy        ΔM = −(M_app + R_Mz)
 * ويُطبَّق على الطرفين أيضاً باعتبار V = M = 0 خارج الكمرة.
 *
 * هذا لا يكرر فحص التوازن في المرحلة 2: ذاك يفحص المحصلة الكلية، وهذا يفحص
 * كل عقدة على حدة، فيكشف خطأ إشارة أو ثابت تكامل في عنصر واحد قد تُخفيه
 * محصلة كلية متوازنة.
 */
function checkContinuity(sol: BeamSolution, polys: ElementPolynomials[]): ContinuityCheck {
  const { beam } = sol;
  const reactionAt = new Map<number, { Fy: number; Mz: number }>();
  for (const r of sol.supportReactions) {
    reactionAt.set(r.nodeIndex, { Fy: r.Fy, Mz: r.Mz ?? 0 });
  }

  let scaleV = 1;
  let scaleM = 1;
  for (const p of polys) {
    scaleV = Math.max(scaleV, Math.abs(p.vc[0]), Math.abs(evalPoly(p.vc, p.L)));
    scaleM = Math.max(scaleM, Math.abs(p.mc[0]), Math.abs(evalPoly(p.mc, p.L)));
  }

  let maxError = 0;
  let worstNode = -1;

  for (const nd of beam.nodes) {
    const left = polys.find((p) => p.index === nd.index - 1);
    const right = polys.find((p) => p.index === nd.index);

    const Vleft = left ? evalPoly(left.vc, left.L) : 0;
    const Mleft = left ? evalPoly(left.mc, left.L) : 0;
    const Vright = right ? right.vc[0] : 0;
    const Mright = right ? right.mc[0] : 0;

    const R = reactionAt.get(nd.index) ?? { Fy: 0, Mz: 0 };
    const errV = Math.abs(Vright - Vleft - (nd.P + R.Fy)) / scaleV;
    const errM = Math.abs(Mright - Mleft + (nd.M + R.Mz)) / scaleM;
    const err = Math.max(errV, errM);

    if (err > maxError) {
      maxError = err;
      worstNode = nd.index;
    }
  }

  if (maxError > CONTINUITY_FAIL_TOL) {
    const nd = beam.nodes[worstNode];
    fail(
      "EQUILIBRIUM",
      `فشل فحص استمرارية المنحنيات عند العقدة ${worstNode} (x = ${nd?.x ?? "?"} م): ` +
        `الخطأ النسبي ${maxError.toExponential(2)}. وثبة القص أو العزم لا تطابق الأحمال ` +
        `وردود الأفعال عند تلك العقدة، والمنحنيات غير موثوقة.`,
      { maxError, worstNode }
    );
  }

  return { maxError, worstNode, ok: maxError <= CONTINUITY_WARN_TOL };
}

function samplePoints(
  polys: ElementPolynomials[],
  samples: number
): { points: DiagramPoint[]; momentZeros: number[] } {
  const points: DiagramPoint[] = [];
  const momentZeros: number[] = [];

  const addZero = (x: number) => {
    if (!momentZeros.some((z) => Math.abs(z - x) <= GEOM_TOL)) momentZeros.push(x);
  };

  polys.forEach((p, ei) => {
    // مواضع مميزة تُدرج إلى جانب العينات المنتظمة حتى لا تُفوَّت القمم
    const critical = new Set<number>([0, p.L]);
    for (let i = 1; i < samples; i++) critical.add((i * p.L) / samples);
    // قمم V: dV/ds = 0
    if (Math.abs(p.vc[2]) > 0) {
      const s = -p.vc[1] / (2 * p.vc[2]);
      if (s > GEOM_TOL && s < p.L - GEOM_TOL) critical.add(s);
    }
    // قمم M: V = 0
    for (const s of quadraticRootsIn(p.vc[2], p.vc[1], p.vc[0], p.L)) critical.add(s);
    // نقاط انعدام العزم
    const zeros = polyRootsIn(p.mc, p.L);
    for (const s of zeros) {
      critical.add(s);
      addZero(p.x0 + s);
    }
    if (Math.abs(evalPoly(p.mc, p.L)) <= 1e-12) addZero(p.x1);

    const ordered = [...critical].sort((a, b) => a - b);
    const prev = points[points.length - 1];

    ordered.forEach((s, i) => {
      const x = p.x0 + s;
      const V = evalPoly(p.vc, s);
      const M = evalPoly(p.mc, s);
      // وثبة عند بداية العنصر: نقطة نهاية العنصر السابق موجودة بنفس x
      const isJump =
        i === 0 &&
        ei > 0 &&
        prev !== undefined &&
        (Math.abs(prev.V - V) > 1e-9 || Math.abs(prev.M - M) > 1e-9);
      if (isJump) prev.jump = true;
      points.push({ x, V, M, elementIndex: p.index, jump: isJump });
    });
  });

  return { points, momentZeros: momentZeros.sort((a, b) => a - b) };
}

function computeExtrema(polys: ElementPolynomials[]): DiagramExtrema {
  const seed = (): Extremum => ({ x: 0, value: 0, elementIndex: 0 });
  const maxV = seed();
  const minV = seed();
  const maxM = seed();
  const minM = seed();
  let first = true;

  for (const p of polys) {
    const sV = new Set<number>([0, p.L]);
    if (Math.abs(p.vc[2]) > 0) {
      const s = -p.vc[1] / (2 * p.vc[2]);
      if (s > 0 && s < p.L) sV.add(s);
    }
    const sM = new Set<number>([0, p.L]);
    for (const s of quadraticRootsIn(p.vc[2], p.vc[1], p.vc[0], p.L)) sM.add(s);

    for (const s of sV) {
      const v = evalPoly(p.vc, s);
      const x = p.x0 + s;
      if (first || v > maxV.value) Object.assign(maxV, { x, value: v, elementIndex: p.index });
      if (first || v < minV.value) Object.assign(minV, { x, value: v, elementIndex: p.index });
      first = false;
    }
    for (const s of sM) {
      const m = evalPoly(p.mc, s);
      const x = p.x0 + s;
      if (m > maxM.value || (maxM.value === 0 && minM.value === 0 && m !== 0)) {
        if (m > maxM.value) Object.assign(maxM, { x, value: m, elementIndex: p.index });
      }
      if (m < minM.value) Object.assign(minM, { x, value: m, elementIndex: p.index });
    }
  }

  const maxAbsV = Math.abs(maxV.value) >= Math.abs(minV.value) ? { ...maxV } : { ...minV };
  const maxAbsM = Math.abs(maxM.value) >= Math.abs(minM.value) ? { ...maxM } : { ...minM };

  return { maxV, minV, maxM, minM, maxAbsV, maxAbsM };
}

/** استعلام نقطي — يُرجع القيم يسار القطاع ويمينه لأن الانفصال حقيقي فيزيائياً */
export function evaluateAt(diagrams: BeamDiagrams, x: number): PointQuery {
  const xc = Math.min(Math.max(x, 0), diagrams.totalLength);
  const polys = diagrams.elements;

  const leftPoly =
    [...polys].reverse().find((p) => xc > p.x0 + GEOM_TOL && xc <= p.x1 + GEOM_TOL) ??
    polys[0];
  const rightPoly =
    polys.find((p) => xc >= p.x0 - GEOM_TOL && xc < p.x1 - GEOM_TOL) ??
    polys[polys.length - 1];

  const sL = Math.min(Math.max(xc - leftPoly.x0, 0), leftPoly.L);
  const sR = Math.min(Math.max(xc - rightPoly.x0, 0), rightPoly.L);

  const V = { left: evalPoly(leftPoly.vc, sL), right: evalPoly(rightPoly.vc, sR) };
  const M = { left: evalPoly(leftPoly.mc, sL), right: evalPoly(rightPoly.mc, sR) };

  return {
    x: xc,
    V,
    M,
    discontinuous: Math.abs(V.left - V.right) > 1e-9 || Math.abs(M.left - M.right) > 1e-9,
  };
}

/** V و M عند موضع محدد بقيمة واحدة (الأكبر مطلقاً عند الانفصال) — للجداول */
export function worstAt(diagrams: BeamDiagrams, x: number): { x: number; V: number; M: number } {
  const q = evaluateAt(diagrams, x);
  return {
    x: q.x,
    V: Math.abs(q.V.left) >= Math.abs(q.V.right) ? q.V.left : q.V.right,
    M: Math.abs(q.M.left) >= Math.abs(q.M.right) ? q.M.left : q.M.right,
  };
}
