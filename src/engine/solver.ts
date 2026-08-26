// solver.ts — التجميع والحل وردود الأفعال وفحص التوازن.
//
// كل الترقيم يمرّ عبر dofMap.elementDofs — لا ترقيم ضمني node*2+i في أي سطر.
// هذا ما يجعل المفصل الداخلي يعمل بلا أي كود خاص في هذا الملف: خريطة درجات
// الحرية تفصل دوران جانبي المفصل، والحل لا يعلم بوجوده أصلاً.

import { discretize } from "./discretize";
import { freeDofs } from "./dofmap";
import {
  distributedTotals,
  elementEndForces,
  elementStiffness,
  equivalentNodalLoads,
  Mat4,
  Vec4,
} from "./element";
import { fail, internal } from "./errors";
import { luDecompose, luSolve, relativeResidual } from "./matrix";
import { BeamModel, DiscretizedBeam, SupportType } from "./types";

/** فوق هذا الحد النسبي يُعتبر الحل مشكوكاً فيه ويُعرض تحذير */
export const EQUILIBRIUM_WARN_TOL = 1e-8;
/** فوق هذا الحد يُرفض الحل بدلاً من إرجاع أرقام لا يُوثق بها */
export const EQUILIBRIUM_FAIL_TOL = 1e-5;

export interface SupportReaction {
  nodeIndex: number;
  at: number; // m
  type: SupportType;
  Fy: number; // kN — لأعلى موجب
  /** kN·m — عكس عقارب الساعة موجب. null إذا لم يقيّد المسند الدوران */
  Mz: number | null;
  /** الإزاحة الرأسية المتحققة عند المسند (م) — مفيدة للنوابض والهبوط */
  displacement: number;
}

export interface ElementSolution {
  index: number;
  dofs: number[];
  /** إزاحات العنصر [v1, θ1, v2, θ2] */
  d: Vec4;
  /** مصفوفة الصلابة (محفوظة لتفادي إعادة حسابها في المرحلة 3) */
  k: Mat4;
  /** الأحمال العقدية المكافئة للحمل الموزع على العنصر */
  feq: Vec4;
  /** f = k·d − feq — انظر توثيق elementEndForces */
  endForces: Vec4;
}

export interface EquilibriumCheck {
  /** Σ القوى الرأسية (أحمال + ردود) — يجب أن يكون صفراً */
  residualFy: number;
  /** Σ العزوم حول x = 0 — يجب أن يكون صفراً */
  residualMz: number;
  relativeFy: number;
  relativeMz: number;
  /** ‖Kd − F‖ النسبي لنظام الدرجات الحرة */
  solveResidual: number;
  /** maxPivot / minPivot — تقدير خشن لسوء التكييف */
  conditionHint: number;
  ok: boolean;
}

export interface BeamSolution {
  beam: DiscretizedBeam;
  /** كل درجات الحرية العامة */
  d: number[];
  reactionsByDof: Map<number, number>;
  supportReactions: SupportReaction[];
  elements: ElementSolution[];
  equilibrium: EquilibriumCheck;
}

/** المدخل الرئيسي: نموذج المستخدم → حل كامل */
export function solveBeam(model: BeamModel): BeamSolution {
  return solveDiscretized(discretize(model));
}

export function solveDiscretized(beam: DiscretizedBeam): BeamSolution {
  const { nodes, elements, dofMap } = beam;
  const n = dofMap.nDof;

  // ————— التجميع —————
  // K هنا صلابة الهيكل فقط (بلا نوابض)، لأنها تُستخدم لاحقاً في حساب ردود
  // أفعال الدرجات المقيَّدة. جساءة النوابض تُضاف إلى النظام المُختزل فقط.
  const K: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const F = new Array<number>(n).fill(0);

  const elemSolutions: ElementSolution[] = elements.map((el) => {
    const k = elementStiffness(el.EI, el.L);
    const feq = equivalentNodalLoads(el.w1, el.w2, el.L);
    const dofs = dofMap.elementDofs[el.index];
    if (!dofs || dofs.length !== 4) internal(`درجات حرية العنصر ${el.index} غير معرَّفة`);

    for (let i = 0; i < 4; i++) {
      const row = K[dofs[i]];
      for (let j = 0; j < 4; j++) row[dofs[j]] += k[i][j];
      F[dofs[i]] += feq[i];
    }

    return { index: el.index, dofs, d: [0, 0, 0, 0], k, feq, endForces: [0, 0, 0, 0] };
  });

  // الأحمال العقدية (أحمال مركزة وعزوم — دقيقة بلا تقريب بفضل التقطيع)
  for (const nd of nodes) {
    if (nd.P !== 0) F[dofMap.verticalOf[nd.index]] += nd.P;
    if (nd.M !== 0) {
      const rots = dofMap.rotationsOf[nd.index];
      if (rots.length !== 1) {
        internal(
          `عزم مركز عند عقدة ذات درجتَي دوران (${nd.x} م) — كان يجب أن يرفضه الفحص المسبق`,
          { at: nd.x }
        );
      }
      F[rots[0]] += nd.M;
    }
  }

  // ————— الحل —————
  const free = freeDofs(dofMap);
  const freeIndexOf = new Map<number, number>();
  free.forEach((dof, i) => freeIndexOf.set(dof, i));

  const d = new Array<number>(n).fill(0);
  for (const [dof, value] of dofMap.prescribed) d[dof] = value;

  let solveResidual = 0;
  let conditionHint = 1;

  if (free.length > 0) {
    const Kff = free.map((r) => free.map((c) => K[r][c]));

    // النوابض قيود مرنة: تُضاف إلى القطر ولا تُقيَّد
    for (const [dof, ks] of dofMap.springs) {
      const i = freeIndexOf.get(dof);
      if (i === undefined) internal("درجة حرية نابض وُجدت مقيَّدة", { dof });
      Kff[i][i] += ks;
    }

    // الطرف الأيمن مع أثر الهبوط المفروض: F_f − K_fp · d_p
    const Ff = free.map((r) => {
      let v = F[r];
      for (const [dof, value] of dofMap.prescribed) {
        if (value !== 0) v -= K[r][dof] * value;
      }
      return v;
    });

    const lu = luDecompose(
      Kff,
      free.map((dof) => dofMap.labels[dof])
    );
    const df = luSolve(lu, Ff);
    free.forEach((dof, i) => (d[dof] = df[i]));

    solveResidual = relativeResidual(Kff, df, Ff);
    conditionHint = lu.minPivot > 0 ? lu.maxPivot / lu.minPivot : Infinity;
  }

  // ————— ردود الأفعال —————
  const reactionsByDof = new Map<number, number>();

  // الدرجات المقيَّدة: R = (K·d) − F
  for (const dof of dofMap.prescribed.keys()) {
    let s = 0;
    const row = K[dof];
    for (let c = 0; c < n; c++) {
      if (row[c] !== 0) s += row[c] * d[c];
    }
    reactionsByDof.set(dof, s - F[dof]);
  }

  // النوابض: القوة التي يبذلها النابض على الكمرة
  for (const [dof, ks] of dofMap.springs) {
    reactionsByDof.set(dof, -ks * d[dof]);
  }

  const supportReactions: SupportReaction[] = [];
  for (const nd of nodes) {
    if (!nd.support) continue;
    const v = dofMap.verticalOf[nd.index];
    let Mz: number | null = null;
    if (nd.support.type === "fixed") {
      Mz = 0;
      for (const r of dofMap.rotationsOf[nd.index]) Mz += reactionsByDof.get(r) ?? 0;
    }
    supportReactions.push({
      nodeIndex: nd.index,
      at: nd.x,
      type: nd.support.type,
      Fy: reactionsByDof.get(v) ?? 0,
      Mz,
      displacement: d[v],
    });
  }

  // ————— قوى نهايات العناصر —————
  for (const es of elemSolutions) {
    es.d = [d[es.dofs[0]], d[es.dofs[1]], d[es.dofs[2]], d[es.dofs[3]]];
    es.endForces = elementEndForces(es.k, es.d, es.feq);
  }

  const equilibrium = checkEquilibrium(beam, supportReactions, solveResidual, conditionHint);

  return { beam, d, reactionsByDof, supportReactions, elements: elemSolutions, equilibrium };
}

/**
 * فحص التوازن الكلي — يُنفَّذ على كل حل، لا في الاختبارات فقط.
 *
 * هذا ليس تكراراً لفحص المحور في LU: المصفوفة قد تُحَل بنجاح ومع ذلك يكون
 * التجميع أو توزيع الأحمال أو حساب ردود الأفعال خاطئاً. توازن القوى والعزوم
 * فحص مستقل يمرّ على المسار كله من المُدخل إلى المُخرج.
 */
function checkEquilibrium(
  beam: DiscretizedBeam,
  reactions: SupportReaction[],
  solveResidual: number,
  conditionHint: number
): EquilibriumCheck {
  let sumFy = 0;
  let sumMz = 0;
  let scaleFy = 0;
  let scaleMz = 0;

  const add = (fy: number, mz: number) => {
    sumFy += fy;
    sumMz += mz;
    scaleFy += Math.abs(fy);
    scaleMz += Math.abs(mz);
  };

  // الأحمال العقدية: العزم حول المبدأ لقوة رأسية عند x هو x·Fy
  for (const nd of beam.nodes) {
    if (nd.P !== 0) add(nd.P, nd.x * nd.P);
    if (nd.M !== 0) add(0, nd.M);
  }

  // الأحمال الموزعة
  for (const el of beam.elements) {
    if (el.w1 === 0 && el.w2 === 0) continue;
    const t = distributedTotals(el.w1, el.w2, el.L);
    add(t.Fy, el.x0 * t.Fy + t.firstMoment);
  }

  // ردود الأفعال
  for (const r of reactions) {
    add(r.Fy, r.at * r.Fy + (r.Mz ?? 0));
  }

  const relativeFy = Math.abs(sumFy) / Math.max(scaleFy, 1);
  const relativeMz = Math.abs(sumMz) / Math.max(scaleMz, 1);

  if (
    relativeFy > EQUILIBRIUM_FAIL_TOL ||
    relativeMz > EQUILIBRIUM_FAIL_TOL ||
    !Number.isFinite(sumFy) ||
    !Number.isFinite(sumMz)
  ) {
    fail(
      "EQUILIBRIUM",
      `فشل فحص التوازن — النتائج غير موثوقة ورُفض الحل. ` +
        `متبقي القوى الرأسية ${sumFy.toExponential(3)} kN (نسبي ${relativeFy.toExponential(2)})، ` +
        `متبقي العزوم ${sumMz.toExponential(3)} kN·m (نسبي ${relativeMz.toExponential(2)}). ` +
        `قد يكون السبب تبايناً حاداً في الجساءات (مؤشر التكييف ${conditionHint.toExponential(2)}).`,
      { sumFy, sumMz, relativeFy, relativeMz, conditionHint, solveResidual }
    );
  }

  return {
    residualFy: sumFy,
    residualMz: sumMz,
    relativeFy,
    relativeMz,
    solveResidual,
    conditionHint,
    ok: relativeFy <= EQUILIBRIUM_WARN_TOL && relativeMz <= EQUILIBRIUM_WARN_TOL,
  };
}
