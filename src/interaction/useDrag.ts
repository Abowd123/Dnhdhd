// useDrag.ts — خُطاف سحب موحَّد للفأرة واللمس والقلم عبر Pointer Events.
//
// قرارات مقصودة:
//  • مستمعات على window لا على العنصر: العنصر المسحوب يُعاد رسمه عشرات المرات
//    في الثانية أثناء السحب (لأن النموذج يتغيّر)، وأي اعتماد على بقاء العنصر
//    نفسه أو على setPointerCapture عليه هشّ.
//  • عتبة 3 بكسل قبل تفعيل السحب: بدونها كل نقرة تصير سحبة، فيُفقد التحديد
//    بالنقر ويُسجَّل تغيير غير مقصود عند كل ضغطة.
//  • Escape يُلغي السحب ويستعيد النموذج كما كان — لا يُثبِّت موضعاً غير مقصود.
//  • Alt يُعطّل الالتقاط أثناء الحركة لتحديد موضع حر.

import { useCallback, useEffect, useRef, useState } from "react";

export interface DragModifiers {
  /** Alt مضغوط — الالتقاط معطَّل */
  free: boolean;
}

export interface DragOptions<T> {
  /** يُستدعى مرة واحدة عند تجاوز عتبة البكسل */
  onBegin(payload: T): void;
  /** يُستدعى عند كل حركة بعد التفعيل */
  onMove(payload: T, clientX: number, mods: DragModifiers): void;
  /** يُستدعى دائماً عند نهاية السحب المفعَّل */
  onEnd(payload: T): void;
  /** يُستدعى بدل onEnd عند الإلغاء بـ Escape أو pointercancel */
  onCancel(payload: T): void;
  /** عتبة التفعيل بالبكسل */
  threshold?: number;
}

export interface DragState<T> {
  /** حمولة السحب المفعَّل حالياً، أو null */
  payload: T | null;
  active: boolean;
  /** true إذا انتهى سحب مفعَّل في هذه الدورة — لكبت نقرة الإفلات */
  consumedClick(): boolean;
  /** يُربط بـ onPointerDown على المقبض */
  start(e: React.PointerEvent<Element>, payload: T): void;
}

export function useDrag<T>(opts: DragOptions<T>): DragState<T> {
  const threshold = opts.threshold ?? 3;
  const [active, setActive] = useState(false);

  // مرجع لا حالة: القيم تُقرأ داخل مستمعات window التي لا تُعاد ربطها كل رسم
  const ref = useRef<{
    payload: T;
    startX: number;
    started: boolean;
    pointerId: number;
  } | null>(null);
  const clickGuard = useRef(false);
  const cb = useRef(opts);
  cb.current = opts;

  const finish = useCallback((cancelled: boolean) => {
    const cur = ref.current;
    ref.current = null;
    setActive(false);
    if (!cur) return;
    if (cur.started) {
      clickGuard.current = true;
      if (cancelled) cb.current.onCancel(cur.payload);
      else cb.current.onEnd(cur.payload);
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    const onMove = (e: PointerEvent) => {
      const cur = ref.current;
      if (!cur || e.pointerId !== cur.pointerId) return;
      if (!cur.started) {
        if (Math.abs(e.clientX - cur.startX) < threshold) return;
        cur.started = true;
        cb.current.onBegin(cur.payload);
      }
      e.preventDefault();
      cb.current.onMove(cur.payload, e.clientX, { free: e.altKey });
    };

    const onUp = (e: PointerEvent) => {
      const cur = ref.current;
      if (!cur || e.pointerId !== cur.pointerId) return;
      finish(false);
    };

    const onCancel = () => finish(true);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current) {
        e.preventDefault();
        finish(true);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [active, threshold, finish]);

  const start = useCallback((e: React.PointerEvent<Element>, payload: T) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    ref.current = { payload, startX: e.clientX, started: false, pointerId: e.pointerId };
    setActive(true);
  }, []);

  const consumedClick = useCallback(() => {
    if (!clickGuard.current) return false;
    clickGuard.current = false;
    return true;
  }, []);

  return {
    payload: active && ref.current?.started ? ref.current.payload : null,
    active,
    consumedClick,
    start,
  };
}
