// poly.ts — أدوات متعددات حدود مشتركة بين المنحنيات الداخلية والترخيم.
//
// نُقلت من internalForces.ts لأن الترخيم يحتاجها على متعددات من الدرجة الخامسة.
// إيجاد الجذور بالتنصيف بعد كشف تغيّر الإشارة، لا بحلول رمزية: الحل الرمزي
// للتكعيبي والرباعي مليء بالحالات الخاصة وعرضة لفقدان دقة، والتنصيف يعطي
// دقة الآلة بسطور قليلة ويعمل على أي درجة.

import { GEOM_TOL } from "./types";

/** تقييم متعددة حدود بطريقة هورنر: c[0] + c[1]·s + c[2]·s² + … */
export function evalPoly(c: readonly number[], s: number): number {
  let v = 0;
  for (let i = c.length - 1; i >= 0; i--) v = v * s + c[i];
  return v;
}

/** مشتقة متعددة الحدود */
export function polyDerivative(c: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < c.length; i++) out.push(i * c[i]);
  return out.length > 0 ? out : [0];
}

/**
 * جذور a·s² + b·s + c الواقعة داخل (0, L).
 * الصيغة q = −½(b + sgn(b)·√Δ) تتجنب طرح عددين متقاربين عند |4ac| ≪ b²،
 * وهي حالة تحدث فعلاً مع حمل موزع ضعيف على عنصر قصير.
 */
export function quadraticRootsIn(a: number, b: number, c: number, L: number): number[] {
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (scale === 0) return [];
  const out: number[] = [];
  const push = (s: number) => {
    if (s > GEOM_TOL && s < L - GEOM_TOL) out.push(s);
  };

  if (Math.abs(a) <= scale * 1e-14) {
    if (Math.abs(b) > scale * 1e-14) push(-c / b);
    return out;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return out;
  const sq = Math.sqrt(disc);
  const q = -0.5 * (b + Math.sign(b || 1) * sq);
  push(q / a);
  if (Math.abs(q) > 0) push(c / q);
  return out;
}

/** جذور متعددة حدود من أي درجة داخل [0, L] */
export function polyRootsIn(c: readonly number[], L: number, subdivisions = 128): number[] {
  const roots: number[] = [];
  const record = (s: number) => {
    if (s >= -GEOM_TOL && s <= L + GEOM_TOL && !roots.some((r) => Math.abs(r - s) <= GEOM_TOL)) {
      roots.push(Math.min(Math.max(s, 0), L));
    }
  };

  let scale = 0;
  for (const v of c) scale = Math.max(scale, Math.abs(v));
  if (scale === 0) return [];
  const zeroTol = scale * 1e-14 * Math.max(1, L ** (c.length - 1));

  const step = L / subdivisions;
  let prevS = 0;
  let prevV = evalPoly(c, 0);
  if (Math.abs(prevV) <= zeroTol) record(0);

  for (let i = 1; i <= subdivisions; i++) {
    const s = i * step;
    const v = evalPoly(c, s);
    if (Math.abs(v) <= zeroTol) {
      record(s);
    } else if (prevV * v < 0) {
      let lo = prevS;
      let hi = s;
      let flo = prevV;
      for (let k = 0; k < 60; k++) {
        const mid = 0.5 * (lo + hi);
        const fmid = evalPoly(c, mid);
        if (flo * fmid <= 0) hi = mid;
        else {
          lo = mid;
          flo = fmid;
        }
      }
      record(0.5 * (lo + hi));
    }
    prevS = s;
    prevV = v;
  }
  return roots.sort((a, b) => a - b);
}

/** جذور متعددة الحدود بعد إزاحة ثابتة: حل c(s) = offset */
export function polyRootsShifted(
  c: readonly number[],
  offset: number,
  L: number,
  subdivisions = 128
): number[] {
  const shifted = [...c];
  shifted[0] -= offset;
  return polyRootsIn(shifted, L, subdivisions);
}
