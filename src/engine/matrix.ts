// matrix.ts — تفكيك LU مع محورية جزئية.
//
// اخترنا LU لا الحذف الغاوسي المباشر لأن التفكيك يُعاد استخدامه مع أطراف
// يمنى متعددة بلا كلفة إضافية — وهو ما تحتاجه خطوط التأثير والأحمال المتحركة
// في المرحلة الثالثة من النطاق.
//
// تفاوت المحورية نسبي لأكبر عنصر في المصفوفة، لا مطلق: قيم EI تُقاس
// بعشرات الآلاف، فأي حد مطلق مثل 1e-12 يمرّ عليه شبه المنفرد بلا اكتشاف.

import { fail } from "./errors";

export interface LuFactorization {
  n: number;
  lu: number[][];
  piv: number[];
  minPivot: number;
  maxPivot: number;
}

/** أكبر قيمة مطلقة في متجه */
export function maxAbs(v: number[]): number {
  let m = 0;
  for (const x of v) m = Math.max(m, Math.abs(x));
  return m;
}

export function luDecompose(A: number[][], labels?: string[]): LuFactorization {
  const n = A.length;
  if (n === 0) return { n: 0, lu: [], piv: [], minPivot: 0, maxPivot: 0 };

  const lu = A.map((row) => [...row]);
  const piv = Array.from({ length: n }, (_, i) => i);

  let aMax = 0;
  for (const row of lu) aMax = Math.max(aMax, maxAbs(row));
  if (aMax === 0) {
    fail("UNSTABLE", "مصفوفة الصلابة صفرية بالكامل — النموذج بلا أي جساءة فعّالة.");
  }
  const tol = aMax * 1e-12;

  let minPivot = Infinity;
  let maxPivot = 0;

  for (let c = 0; c < n; c++) {
    let best = c;
    let bestVal = Math.abs(lu[c][c]);
    for (let r = c + 1; r < n; r++) {
      const v = Math.abs(lu[r][c]);
      if (v > bestVal) {
        bestVal = v;
        best = r;
      }
    }

    if (bestVal <= tol) {
      const where = labels?.[piv[c]] ? ` عند ${labels[piv[c]]}` : "";
      fail(
        "UNSTABLE",
        `الكمرة غير مستقرة: مصفوفة الصلابة منفردة${where}. ` +
          `يوجد نمط حركة حر (آلية) — أضف مسنداً أو أزل مفصلاً.`,
        { column: c, pivot: bestVal, tolerance: tol }
      );
    }

    if (best !== c) {
      const tmpRow = lu[c];
      lu[c] = lu[best];
      lu[best] = tmpRow;
      const tmpP = piv[c];
      piv[c] = piv[best];
      piv[best] = tmpP;
    }

    const p = lu[c][c];
    minPivot = Math.min(minPivot, Math.abs(p));
    maxPivot = Math.max(maxPivot, Math.abs(p));

    for (let r = c + 1; r < n; r++) {
      const f = lu[r][c] / p;
      lu[r][c] = f;
      for (let k = c + 1; k < n; k++) lu[r][k] -= f * lu[c][k];
    }
  }

  return { n, lu, piv, minPivot, maxPivot };
}

export function luSolve(fac: LuFactorization, b: number[]): number[] {
  const { n, lu, piv } = fac;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[piv[i]];
    for (let j = 0; j < i; j++) s -= lu[i][j] * y[j];
    y[i] = s;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= lu[i][j] * x[j];
    x[i] = s / lu[i][i];
  }
  return x;
}

export function matVec(A: number[][], x: number[]): number[] {
  return A.map((row) => {
    let s = 0;
    for (let j = 0; j < row.length; j++) s += row[j] * x[j];
    return s;
  });
}

/** ‖Ax − b‖∞ منسوباً إلى مقياس المسألة — مؤشر على تدهور عددي */
export function relativeResidual(A: number[][], x: number[], b: number[]): number {
  if (A.length === 0) return 0;
  const Ax = matVec(A, x);
  const r = Ax.map((v, i) => v - b[i]);
  let aMax = 0;
  for (const row of A) aMax = Math.max(aMax, maxAbs(row));
  const scale = Math.max(maxAbs(b), aMax * maxAbs(x), Number.MIN_VALUE);
  return maxAbs(r) / scale;
}
