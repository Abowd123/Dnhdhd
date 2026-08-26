// validate.ts — فحص النموذج قبل الحل.
// الهدف: منع أي مُدخل مشكوك فيه من الوصول إلى مرحلة الحل، لأن مصفوفة شبه
// منفردة قد تنجو من فحص المحور وتُخرج أرقاماً ضخمة بلا معنى.

import { fail } from "./errors";
import { BeamModel, GEOM_TOL, SupportDef } from "./types";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function fmt(x: number): string {
  return Number(x.toFixed(6)).toString();
}

/** الطول الكلي = مجموع أطوال البحور */
export function totalLength(model: BeamModel): number {
  return model.spans.reduce((s, sp) => s + sp.length, 0);
}

/** حدود البحور التراكمية: [x0, x1, ...] بطول nSpans+1 */
export function spanBoundaries(model: BeamModel): number[] {
  const b: number[] = [0];
  for (const sp of model.spans) b.push(b[b.length - 1] + sp.length);
  return b;
}

function checkSpans(model: BeamModel): void {
  if (!Array.isArray(model.spans) || model.spans.length === 0) {
    fail("SPAN_INVALID", "النموذج لا يحتوي أي بحر. أضف بحراً واحداً على الأقل.");
  }
  const ids = new Set<string>();
  model.spans.forEach((sp, i) => {
    const n = i + 1;
    if (!isFiniteNumber(sp.length) || sp.length <= 0) {
      fail("SPAN_INVALID", `طول البحر رقم ${n} يجب أن يكون عدداً موجباً (القيمة الحالية: ${sp.length}).`, { spanIndex: i });
    }
    if (!isFiniteNumber(sp.E) || sp.E <= 0) {
      fail("SPAN_INVALID", `معامل المرونة E للبحر رقم ${n} يجب أن يكون موجباً بالجيجاباسكال (القيمة الحالية: ${sp.E}).`, { spanIndex: i });
    }
    if (!isFiniteNumber(sp.I) || sp.I <= 0) {
      fail("SPAN_INVALID", `عزم القصور I للبحر رقم ${n} يجب أن يكون موجباً بوحدة m⁴ (القيمة الحالية: ${sp.I}).`, { spanIndex: i });
    }
    if (!sp.id) {
      fail("SPAN_INVALID", `البحر رقم ${n} بلا معرِّف id.`, { spanIndex: i });
    }
    if (ids.has(sp.id)) {
      fail("SPAN_DUPLICATE_ID", `المعرِّف "${sp.id}" مستخدم لأكثر من بحر. المعرِّفات يجب أن تكون فريدة.`, { id: sp.id });
    }
    ids.add(sp.id);
  });
}

function checkSupports(model: BeamModel, L: number): void {
  if (!Array.isArray(model.supports) || model.supports.length === 0) {
    fail("SUPPORT_INVALID", "النموذج بلا مساند. الكمرة غير مستقرة.");
  }
  const seen: number[] = [];
  for (const s of model.supports) {
    if (!isFiniteNumber(s.at)) {
      fail("SUPPORT_INVALID", `موضع مسند غير صالح: ${s.at}.`);
    }
    if (s.at < -GEOM_TOL || s.at > L + GEOM_TOL) {
      fail("SUPPORT_OUT_OF_RANGE", `مسند عند ${fmt(s.at)} م يقع خارج الكمرة (الطول الكلي ${fmt(L)} م).`, { at: s.at, totalLength: L });
    }
    if (seen.some((p) => Math.abs(p - s.at) < GEOM_TOL)) {
      fail("SUPPORT_DUPLICATE", `أكثر من مسند عند الموضع ${fmt(s.at)} م. احتفظ بمسند واحد فقط في كل موضع.`, { at: s.at });
    }
    seen.push(s.at);

    if (s.type === "spring") {
      if (!isFiniteNumber(s.springStiffness) || (s.springStiffness as number) <= 0) {
        fail("SPRING_INVALID", `المسند المرن عند ${fmt(s.at)} م يحتاج جساءة springStiffness موجبة بوحدة kN/m.`, { at: s.at });
      }
      if (isFiniteNumber(s.settlement) && Math.abs(s.settlement as number) > 0) {
        fail("NOT_IMPLEMENTED", `الجمع بين مسند مرن وهبوط مفروض عند ${fmt(s.at)} م غير مدعوم بعد.`, { at: s.at });
      }
    }
    if (isFiniteNumber(s.settlement) === false && s.settlement !== undefined) {
      fail("SUPPORT_INVALID", `قيمة هبوط غير صالحة عند المسند ${fmt(s.at)} م.`, { at: s.at });
    }
  }
}

function checkHinges(model: BeamModel, L: number): void {
  const hinges = model.hinges ?? [];
  const seen: number[] = [];
  for (const h of hinges) {
    if (!isFiniteNumber(h.at)) {
      fail("HINGE_OUT_OF_RANGE", `موضع مفصل غير صالح: ${h.at}.`);
    }
    if (h.at <= GEOM_TOL || h.at >= L - GEOM_TOL) {
      fail("HINGE_OUT_OF_RANGE", `المفصل عند ${fmt(h.at)} م يجب أن يكون داخل الكمرة بشكل صريح، لا على طرفها (الطول الكلي ${fmt(L)} م).`, { at: h.at });
    }
    if (seen.some((p) => Math.abs(p - h.at) < GEOM_TOL)) {
      fail("HINGE_DUPLICATE", `أكثر من مفصل عند الموضع ${fmt(h.at)} م.`, { at: h.at });
    }
    seen.push(h.at);

    const sup = model.supports.find((s) => Math.abs(s.at - h.at) < GEOM_TOL);
    if (sup && sup.type === "fixed") {
      fail("HINGE_CONFLICT", `لا يمكن وضع مفصل داخلي عند تثبيت تام (${fmt(h.at)} م). استخدم مسنداً مفصلياً بدلاً من ذلك.`, { at: h.at });
    }
    const mom = model.loads.find((l) => l.type === "moment" && Math.abs(l.at - h.at) < GEOM_TOL);
    if (mom) {
      fail("HINGE_CONFLICT", `عزم مركز عند المفصل نفسه (${fmt(h.at)} م) حالة غامضة: لا يُعرف على أي جانب من المفصل يُطبَّق. أزح أحدهما قليلاً.`, { at: h.at });
    }
  }
}

function checkLoads(model: BeamModel, L: number): void {
  if (!Array.isArray(model.loads)) {
    fail("LOAD_INVALID", "قائمة الأحمال غير صالحة.");
  }
  model.loads.forEach((l, i) => {
    const n = i + 1;
    if (l.type === "point" || l.type === "moment") {
      if (!isFiniteNumber(l.at)) fail("LOAD_INVALID", `موضع الحمل رقم ${n} غير صالح: ${l.at}.`, { loadIndex: i });
      if (l.at < -GEOM_TOL || l.at > L + GEOM_TOL) {
        fail("LOAD_OUT_OF_RANGE", `الحمل رقم ${n} عند ${fmt(l.at)} م يقع خارج الكمرة (الطول الكلي ${fmt(L)} م).`, { loadIndex: i });
      }
      if (!isFiniteNumber(l.magnitude)) {
        fail("LOAD_INVALID", `قيمة الحمل رقم ${n} غير صالحة: ${l.magnitude}.`, { loadIndex: i });
      }
    } else {
      if (!isFiniteNumber(l.from) || !isFiniteNumber(l.to)) {
        fail("LOAD_INVALID", `حدود الحمل الموزع رقم ${n} غير صالحة.`, { loadIndex: i });
      }
      if (l.to - l.from <= GEOM_TOL) {
        fail("LOAD_INVALID", `الحمل الموزع رقم ${n}: يجب أن تكون "to" أكبر من "from" (${fmt(l.from)} → ${fmt(l.to)}).`, { loadIndex: i });
      }
      if (l.from < -GEOM_TOL || l.to > L + GEOM_TOL) {
        fail("LOAD_OUT_OF_RANGE", `الحمل الموزع رقم ${n} (${fmt(l.from)} → ${fmt(l.to)} م) يتجاوز حدود الكمرة (الطول الكلي ${fmt(L)} م).`, { loadIndex: i });
      }
      if (l.type === "udl" && !isFiniteNumber(l.w)) {
        fail("LOAD_INVALID", `شدة الحمل الموزع رقم ${n} غير صالحة: ${l.w}.`, { loadIndex: i });
      }
      if (l.type === "linear" && (!isFiniteNumber(l.w1) || !isFiniteNumber(l.w2))) {
        fail("LOAD_INVALID", `شدتا الحمل المتغير رقم ${n} غير صالحتين.`, { loadIndex: i });
      }
    }
  });
}

/** عدد القيود التي يوفرها المسند في مستوى الانحناء */
function restraintCount(s: SupportDef): number {
  switch (s.type) {
    case "fixed":
      return 2; // إزاحة + دوران
    case "pinned":
    case "roller":
    case "spring":
      return 1; // إزاحة فقط (النابض قيد مرن، يكفي لمنع الحركة الحرة)
  }
}

/**
 * فحص كفاية القيود.
 * للكمرة في مستوى الانحناء نمطان جسميان صلبان (انتقال + دوران)،
 * وكل مفصل داخلي يضيف آلية واحدة. فالشرط: مجموع القيود ≥ 2 + عدد المفاصل.
 *
 * هذا شرط لازم وغير كاف — الفحص القاطع يبقى محور المصفوفة في مرحلة الحل
 * إضافة إلى متبقي التوازن. لذلك نبقي الفحصين معاً.
 */
function checkStability(model: BeamModel): void {
  const nHinges = (model.hinges ?? []).length;
  const provided = model.supports.reduce((s, sup) => s + restraintCount(sup), 0);
  const required = 2 + nHinges;
  if (provided < required) {
    fail(
      "UNSTABLE",
      `الكمرة غير مستقرة: القيود المتاحة ${provided} والمطلوب ${required} على الأقل` +
        (nHinges > 0 ? ` (نمطان جسميان صلبان + ${nHinges} مفصل داخلي).` : ` (نمطان جسميان صلبان).`) +
        ` أضف مساند أو أزل مفاصل.`,
      { provided, required, nHinges }
    );
  }
}

/** الفحص الشامل — يُستدعى تلقائياً من discretize() */
export function checkModel(model: BeamModel): void {
  checkSpans(model);
  const L = totalLength(model);
  checkSupports(model, L);
  checkLoads(model, L);
  checkHinges(model, L);
  checkStability(model);
}
