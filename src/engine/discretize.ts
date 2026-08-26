// discretize.ts — تحويل نموذج المستخدم إلى عقد وعناصر جاهزة للتجميع.
//
// قاعدة التقطيع: تُنشأ عقدة عند كل موضع ذي معنى — حدود البحور، المساند،
// المفاصل، الأحمال المركزة والعزوم، وبداية/نهاية كل حمل موزع.
// النتيجة أن كل عنصر:
//   • يقع بالكامل داخل بحر واحد (جساءة EI ثابتة)
//   • يحمل حملاً موزعاً شبه منحرف يغطيه بالكامل (أو لا شيء)
//   • لا يحمل أي حمل مركز داخله — الأحمال المركزة تصبح أحمالاً عقدية دقيقة
// وهذا يجعل قوى النهايات المقيدة في مرحلة الحل صيغاً مغلقة بلا تقريب.

import { internal } from "./errors";
import { buildDofMap } from "./dofmap";
import { checkModel, spanBoundaries, totalLength } from "./validate";
import {
  BeamElement,
  BeamModel,
  BeamNode,
  DiscretizedBeam,
  DistributedLoad,
  GEOM_TOL,
} from "./types";

/** 1 GPa = 1e6 kN/m² → EI بوحدة kN·m² */
export function computeEI(E_GPa: number, I_m4: number): number {
  return E_GPa * 1e6 * I_m4;
}

/** شدة الحمل الموزع عند الموضع x */
function intensityAt(load: DistributedLoad, x: number): number {
  if (load.type === "udl") return load.w;
  const t = (x - load.from) / (load.to - load.from);
  return load.w1 + (load.w2 - load.w1) * t;
}

/** فرز وإزالة المواضع المتقاربة ضمن التفاوت الهندسي */
function uniqueSorted(values: number[], tol = GEOM_TOL): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > tol) out.push(v);
  }
  return out;
}

/** جمع كل مواضع القطع من النموذج */
function collectCuts(model: BeamModel, L: number): number[] {
  const cuts: number[] = [0, L, ...spanBoundaries(model)];
  for (const s of model.supports) cuts.push(s.at);
  for (const h of model.hinges ?? []) cuts.push(h.at);
  for (const l of model.loads) {
    if (l.type === "point" || l.type === "moment") cuts.push(l.at);
    else {
      cuts.push(l.from);
      cuts.push(l.to);
    }
  }
  // تقييد المواضع داخل [0, L] لتفادي أخطاء التفاوت على الطرفين
  const clamped = cuts.map((x) => Math.min(Math.max(x, 0), L));
  return uniqueSorted(clamped);
}

/** إيجاد فهرس العقدة عند الموضع x، أو -1 */
function findNodeIndex(positions: number[], x: number): number {
  for (let i = 0; i < positions.length; i++) {
    if (Math.abs(positions[i] - x) <= GEOM_TOL) return i;
  }
  return -1;
}

export function discretize(model: BeamModel): DiscretizedBeam {
  checkModel(model);

  const L = totalLength(model);
  const positions = collectCuts(model, L);
  if (positions.length < 2) {
    internal("لم يُنتج التقطيع عقدتين على الأقل", { positions });
  }

  const hinges = model.hinges ?? [];

  const nodes: BeamNode[] = positions.map((x, index) => ({
    index,
    x,
    support: model.supports.find((s) => Math.abs(s.at - x) <= GEOM_TOL),
    hinge: hinges.some((h) => Math.abs(h.at - x) <= GEOM_TOL),
    P: 0,
    M: 0,
  }));

  // كل مسند ومفصل يجب أن يكون قد وجد عقدة — وإلا فخلل في التقطيع لا مُدخل خاطئ
  for (const s of model.supports) {
    if (findNodeIndex(positions, Math.min(Math.max(s.at, 0), L)) === -1) {
      internal(`لم تُنشأ عقدة عند المسند ${s.at} م`, { at: s.at });
    }
  }
  for (const h of hinges) {
    if (findNodeIndex(positions, h.at) === -1) {
      internal(`لم تُنشأ عقدة عند المفصل ${h.at} م`, { at: h.at });
    }
  }

  // العناصر بين كل عقدتين متتاليتين
  const bounds = spanBoundaries(model);
  const elements: BeamElement[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const x0 = positions[i];
    const x1 = positions[i + 1];
    const mid = 0.5 * (x0 + x1);

    let spanIdx = -1;
    for (let k = 0; k < model.spans.length; k++) {
      if (mid >= bounds[k] - GEOM_TOL && mid <= bounds[k + 1] + GEOM_TOL) {
        spanIdx = k;
        break;
      }
    }
    if (spanIdx === -1) internal(`لم يُنسب العنصر [${x0}, ${x1}] إلى أي بحر`, { x0, x1 });

    const span = model.spans[spanIdx];
    elements.push({
      index: i,
      nodeStart: i,
      nodeEnd: i + 1,
      x0,
      x1,
      L: x1 - x0,
      EI: computeEI(span.E, span.I),
      spanId: span.id,
      w1: 0,
      w2: 0,
    });
  }

  // توزيع الأحمال
  for (const load of model.loads) {
    if (load.type === "point") {
      const x = Math.min(Math.max(load.at, 0), L);
      const idx = findNodeIndex(positions, x);
      if (idx === -1) internal(`لم تُنشأ عقدة عند الحمل المركز ${load.at} م`, { at: load.at });
      nodes[idx].P += load.magnitude;
      continue;
    }

    if (load.type === "moment") {
      const x = Math.min(Math.max(load.at, 0), L);
      const idx = findNodeIndex(positions, x);
      if (idx === -1) internal(`لم تُنشأ عقدة عند العزم المركز ${load.at} م`, { at: load.at });
      nodes[idx].M += load.magnitude;
      continue;
    }

    // حمل موزع: كل عنصر إما داخله بالكامل أو خارجه بالكامل،
    // لأن التقطيع أنشأ عقدتين عند from و to.
    let covered = 0;
    for (const el of elements) {
      const inside = el.x0 >= load.from - GEOM_TOL && el.x1 <= load.to + GEOM_TOL;
      if (!inside) continue;
      el.w1 += intensityAt(load, el.x0);
      el.w2 += intensityAt(load, el.x1);
      covered += el.L;
    }
    if (Math.abs(covered - (load.to - load.from)) > 1e-6) {
      internal(
        `تغطية الحمل الموزع غير مكتملة: غُطِّي ${covered} م من ${load.to - load.from} م`,
        { from: load.from, to: load.to, covered }
      );
    }
  }

  const dofMap = buildDofMap(nodes, elements);

  return { totalLength: L, nodes, elements, dofMap };
}
