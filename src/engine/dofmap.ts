// dofmap.ts — بناء خريطة درجات الحرية.
//
// لماذا كائن مستقل: المفصل الداخلي يفصل دوران الجانبين عند عقدة واحدة،
// فتصبح للعقدة درجتا دوران بينما تبقى إزاحتها الرأسية مشتركة. أي ترقيم
// ضمني (node*2 + i) يستحيل معه دعم المفاصل دون إعادة كتابة الحل بالكامل.

import { internal } from "./errors";
import { BeamElement, BeamNode, DofMap } from "./types";

export function buildDofMap(nodes: BeamNode[], elements: BeamElement[]): DofMap {
  const n = nodes.length;
  if (n < 2) internal("عدد العقد أقل من اثنتين بعد التقطيع", { n });

  // العنصر المجاور على كل جانب من كل عقدة
  const leftElemOf = new Array<number>(n).fill(-1); // عنصر ينتهي عند العقدة
  const rightElemOf = new Array<number>(n).fill(-1); // عنصر يبدأ من العقدة
  for (const e of elements) {
    rightElemOf[e.nodeStart] = e.index;
    leftElemOf[e.nodeEnd] = e.index;
  }

  const verticalOf = new Array<number>(n).fill(-1);
  const rotationsOf: number[][] = Array.from({ length: n }, () => []);
  const rotLeftOf = new Array<number>(n).fill(-1); // درجة دوران الطرف الأيمن للعنصر الأيسر
  const rotRightOf = new Array<number>(n).fill(-1); // درجة دوران الطرف الأيسر للعنصر الأيمن
  const labels: string[] = [];

  let dof = 0;
  for (let i = 0; i < n; i++) {
    verticalOf[i] = dof;
    labels[dof] = `v @ عقدة ${i} (x=${nodes[i].x})`;
    dof++;

    const hasLeft = leftElemOf[i] !== -1;
    const hasRight = rightElemOf[i] !== -1;
    const splitRotation = nodes[i].hinge && hasLeft && hasRight;

    if (splitRotation) {
      rotLeftOf[i] = dof;
      labels[dof] = `θ يسار @ عقدة ${i} (مفصل)`;
      rotationsOf[i].push(dof);
      dof++;

      rotRightOf[i] = dof;
      labels[dof] = `θ يمين @ عقدة ${i} (مفصل)`;
      rotationsOf[i].push(dof);
      dof++;
    } else {
      const r = dof;
      labels[dof] = `θ @ عقدة ${i} (x=${nodes[i].x})`;
      rotationsOf[i].push(r);
      dof++;
      if (hasLeft) rotLeftOf[i] = r;
      if (hasRight) rotRightOf[i] = r;
    }
  }

  const elementDofs = elements.map((e) => {
    const vi = verticalOf[e.nodeStart];
    const ti = rotRightOf[e.nodeStart];
    const vj = verticalOf[e.nodeEnd];
    const tj = rotLeftOf[e.nodeEnd];
    if (vi < 0 || ti < 0 || vj < 0 || tj < 0) {
      internal(`تعيين درجات الحرية للعنصر ${e.index} غير مكتمل`, { element: e.index });
    }
    return [vi, ti, vj, tj];
  });

  const prescribed = new Map<number, number>();
  const springs = new Map<number, number>();

  for (let i = 0; i < n; i++) {
    const s = nodes[i].support;
    if (!s) continue;
    const v = verticalOf[i];

    if (s.type === "spring") {
      // قيد مرن: تُضاف الجساءة إلى قطر مصفوفة الصلابة في مرحلة الحل
      springs.set(v, s.springStiffness as number);
    } else {
      prescribed.set(v, s.settlement ?? 0);
    }

    if (s.type === "fixed") {
      for (const r of rotationsOf[i]) prescribed.set(r, 0);
    }
  }

  return { nDof: dof, verticalOf, rotationsOf, elementDofs, prescribed, springs, labels };
}

/** فهارس الدرجات الحرة (غير المقيَّدة بقيمة مفروضة) */
export function freeDofs(map: DofMap): number[] {
  const out: number[] = [];
  for (let i = 0; i < map.nDof; i++) if (!map.prescribed.has(i)) out.push(i);
  return out;
}
