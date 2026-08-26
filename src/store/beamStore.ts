// beamStore.ts — حالة النموذج مع تراجع/إعادة، والحالة التفاعلية للواجهة.
//
// نمط السجل: تعديل عادي يدفع الحالة السابقة إلى past. أما السحب (المرحلة 8)
// فيلتقط صورة واحدة عند بدايته عبر beginInteraction ويُحدِّث بلا سجل خلال
// الحركة، ثم يدفع الصورة الملتقطة عند endInteraction. النتيجة أن سحبة واحدة
// تعادل خطوة تراجع واحدة لا مئة خطوة.
//
// الحذف المتسلسل: حذف بحر قد يُخرج مساند أو أحمالاً عن الكمرة. لا نحذفها
// بصمت ولا نتركها لتُنتج خطأ غامضاً، بل نحذفها ونُعلن ذلك في notice.

import { create } from "zustand";
import {
  BeamModel,
  HingeDef,
  LoadDef,
  SpanDef,
  SupportDef,
  SupportType,
} from "../engine/types";
import { spanBoundaries, totalLength } from "../engine/validate";

const HISTORY_LIMIT = 50;
const TOL = 1e-6;

/** خطوة الإزاحة بالأسهم — مطابقة لشبكة الالتقاط المغناطيسي في المرحلة 8 */
export const NUDGE_STEP = 0.25;

export const defaultModel: BeamModel = {
  version: "1.0",
  spans: [
    { id: "s1", length: 6, E: 200, I: 2e-4 },
    { id: "s2", length: 6, E: 200, I: 2e-4 },
    { id: "s3", length: 2, E: 200, I: 2e-4 },
  ],
  supports: [
    { at: 0, type: "fixed" },
    { at: 6, type: "roller" },
    { at: 12, type: "roller" },
  ],
  loads: [
    { type: "udl", from: 0, to: 12, w: -15 },
    { type: "point", at: 9, magnitude: -40 },
    { type: "linear", from: 12, to: 14, w1: -20, w2: 0 },
  ],
};

export type Selection =
  | { kind: "span"; index: number }
  | { kind: "support"; index: number }
  | { kind: "hinge"; index: number }
  | { kind: "load"; index: number };

export type LoadPatch = Partial<{
  at: number;
  magnitude: number;
  from: number;
  to: number;
  w: number;
  w1: number;
  w2: number;
}>;

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.index === b.index;
}

function nextSpanId(spans: SpanDef[]): string {
  const used = new Set(spans.map((s) => s.id));
  for (let i = 1; i <= spans.length + 1; i++) {
    const id = `s${i}`;
    if (!used.has(id)) return id;
  }
  return `s${Date.now()}`;
}

function isOccupied(model: BeamModel, x: number): boolean {
  return (
    model.supports.some((s) => Math.abs(s.at - x) < TOL) ||
    (model.hinges ?? []).some((h) => Math.abs(h.at - x) < TOL)
  );
}

function hasMomentAt(model: BeamModel, x: number): boolean {
  return model.loads.some((l) => l.type === "moment" && Math.abs(l.at - x) < TOL);
}

/** أول موضع مرشَّح غير مشغول — لإضافة مسند أو مفصل بلا تعارض */
function freeSpot(model: BeamModel, candidates: number[], fallback: number): number {
  for (const c of candidates) {
    if (!isOccupied(model, c)) return c;
  }
  return fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

interface BeamStore {
  model: BeamModel;
  past: BeamModel[];
  future: BeamModel[];
  /** صورة النموذج عند بداية تفاعل مستمر (سحب) */
  pending: BeamModel | null;
  interacting: boolean;
  cursorX: number | null;
  selection: Selection | null;
  tensionSide: boolean;
  deflectionLimit: number;
  /** إعلان عن تغيير متسلسل نفّذته الواجهة — يُعرض للمستخدم ولا يُخفى */
  notice: string | null;

  setModel(model: BeamModel): void;
  patch(next: BeamModel, history?: boolean): void;
  resetModel(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  beginInteraction(): void;
  endInteraction(): void;
  cancelInteraction(): void;
  resizeDistributedLoad(index: number, edge: "from" | "to", x: number, history?: boolean): void;
  setCursorX(x: number | null): void;
  setSelection(sel: Selection | null): void;
  toggleTensionSide(): void;
  setDeflectionLimit(v: number): void;
  dismissNotice(): void;
  /** استبدال كامل من ملف: يمحو السجل لأن ما قبله لا يخصّ هذا المشروع */
  replaceProject(model: BeamModel, view?: { tensionSide: boolean; deflectionLimit: number }, notice?: string): void;
  setNotice(message: string | null): void;

  addSpan(): void;
  updateSpan(index: number, patch: Partial<SpanDef>): void;
  removeSpan(index: number): void;

  addSupport(): void;
  updateSupport(index: number, patch: Partial<SupportDef>): void;
  setSupportType(index: number, type: SupportType): void;
  removeSupport(index: number): void;

  addHinge(): void;
  updateHinge(index: number, patch: Partial<HingeDef>): void;
  removeHinge(index: number): void;

  addLoad(kind: LoadDef["type"]): void;
  updateLoad(index: number, patch: LoadPatch): void;
  changeLoadKind(index: number, kind: LoadDef["type"]): void;
  removeLoad(index: number): void;

  /** إزاحة عنصر إلى موضع مطلق — أساس السحب في المرحلة 8 */
  moveEntity(sel: Selection, at: number, history?: boolean): void;
  /** إزاحة نسبية بالأسهم */
  nudge(sel: Selection, delta: number): void;
}

export const useBeamStore = create<BeamStore>()((set, get) => ({
  model: defaultModel,
  past: [],
  future: [],
  pending: null,
  interacting: false,
  cursorX: null,
  selection: null,
  tensionSide: true,
  deflectionLimit: 360,
  notice: null,

  setModel(model) {
    get().patch(model);
  },

  patch(next, history = true) {
    const { model, past } = get();
    if (history) {
      set({ model: next, past: [...past, model].slice(-HISTORY_LIMIT), future: [] });
    } else {
      set({ model: next, future: [] });
    }
  },

  resetModel() {
    get().patch(defaultModel);
    set({ selection: null, cursorX: null, notice: null });
  },

  undo() {
    const { past, model, future } = get();
    if (past.length === 0) return;
    set({
      model: past[past.length - 1],
      past: past.slice(0, -1),
      future: [model, ...future].slice(0, HISTORY_LIMIT),
      selection: null,
    });
  },

  redo() {
    const { future, model, past } = get();
    if (future.length === 0) return;
    set({
      model: future[0],
      future: future.slice(1),
      past: [...past, model].slice(-HISTORY_LIMIT),
      selection: null,
    });
  },

  canUndo() {
    return get().past.length > 0;
  },

  canRedo() {
    return get().future.length > 0;
  },

  beginInteraction() {
    set({ interacting: true, pending: get().model });
  },

  endInteraction() {
    const { pending, model, past } = get();
    if (pending && pending !== model) {
      set({ past: [...past, pending].slice(-HISTORY_LIMIT), future: [] });
    }
    set({ interacting: false, pending: null });
  },

  cancelInteraction() {
    const { pending } = get();
    if (pending) set({ model: pending });
    set({ interacting: false, pending: null });
  },

  resizeDistributedLoad(index, edge, x, history = true) {
    const { model } = get();
    const l = model.loads[index];
    if (!l || (l.type !== "udl" && l.type !== "linear")) return;
    const L = totalLength(model);
    // الحد الأدنى للعرض 0.25 م: عرض صفري يرفضه المحرك، فنمنعه في الواجهة
    const MIN = NUDGE_STEP;
    const next =
      edge === "from"
        ? { ...l, from: clamp(x, 0, l.to - MIN) }
        : { ...l, to: clamp(x, l.from + MIN, L) };
    get().patch({ ...model, loads: model.loads.map((v, i) => (i === index ? next : v)) }, history);
  },

  setCursorX(x) {
    set({ cursorX: x });
  },

  setSelection(sel) {
    set({ selection: sel });
  },

  toggleTensionSide() {
    set({ tensionSide: !get().tensionSide });
  },

  setDeflectionLimit(v) {
    set({ deflectionLimit: v });
  },

  dismissNotice() {
    set({ notice: null });
  },

  replaceProject(model, view, notice) {
    set({
      model,
      past: [],
      future: [],
      pending: null,
      interacting: false,
      selection: null,
      cursorX: null,
      notice: notice ?? null,
      ...(view ? { tensionSide: view.tensionSide, deflectionLimit: view.deflectionLimit } : {}),
    });
  },

  setNotice(message) {
    set({ notice: message });
  },

  // ————— البحور —————

  addSpan() {
    const { model } = get();
    const last = model.spans[model.spans.length - 1];
    const span: SpanDef = {
      id: nextSpanId(model.spans),
      length: last?.length ?? 6,
      E: last?.E ?? 200,
      I: last?.I ?? 2e-4,
    };
    get().patch({ ...model, spans: [...model.spans, span] });
  },

  updateSpan(index, patch) {
    const { model } = get();
    const spans = model.spans.map((s, i) => (i === index ? { ...s, ...patch } : s));
    get().patch({ ...model, spans });
  },

  removeSpan(index) {
    const { model } = get();
    if (model.spans.length <= 1) {
      set({ notice: "لا يمكن حذف البحر الأخير — الكمرة تحتاج بحراً واحداً على الأقل." });
      return;
    }
    const spans = model.spans.filter((_, i) => i !== index);
    const L = spans.reduce((s, sp) => s + sp.length, 0);

    const supports = model.supports.filter((s) => s.at <= L + TOL);
    const hinges = (model.hinges ?? []).filter((h) => h.at < L - TOL);
    const loads = model.loads.filter((l) =>
      l.type === "point" || l.type === "moment" ? l.at <= L + TOL : l.to <= L + TOL
    );

    const dropped =
      model.supports.length - supports.length +
      (model.hinges ?? []).length - hinges.length +
      model.loads.length - loads.length;

    get().patch({ ...model, spans, supports, hinges, loads });
    set({
      selection: null,
      notice:
        dropped > 0
          ? `حُذف البحر، ومعه ${dropped} عنصراً وقع خارج الكمرة بعد تقصيرها إلى ${Number(
              L.toFixed(4)
            )} م.`
          : null,
    });
  },

  // ————— المساند —————

  addSupport() {
    const { model } = get();
    const L = totalLength(model);
    const at = freeSpot(model, [...spanBoundaries(model), L / 2, L / 4, (3 * L) / 4], L);
    const supports = [...model.supports, { at, type: "roller" as SupportType }].sort(
      (a, b) => a.at - b.at
    );
    get().patch({ ...model, supports });
  },

  updateSupport(index, patch) {
    const { model } = get();
    const supports = model.supports.map((s, i) => (i === index ? { ...s, ...patch } : s));
    get().patch({ ...model, supports });
  },

  setSupportType(index, type) {
    const { model } = get();
    const supports = model.supports.map((s, i) => {
      if (i !== index) return s;
      const next: SupportDef = { at: s.at, type };
      // الجساءة تُنقل فقط إذا كان النوع الجديد نابضاً، والهبوط لا يجتمع مع نابض
      if (type === "spring") next.springStiffness = s.springStiffness ?? 5000;
      else if (s.settlement !== undefined) next.settlement = s.settlement;
      return next;
    });
    get().patch({ ...model, supports });
  },

  removeSupport(index) {
    const { model } = get();
    get().patch({ ...model, supports: model.supports.filter((_, i) => i !== index) });
    set({ selection: null });
  },

  // ————— المفاصل —————

  addHinge() {
    const { model } = get();
    const L = totalLength(model);
    const bounds = spanBoundaries(model);
    const mids: number[] = [];
    for (let i = 0; i < bounds.length - 1; i++) mids.push((bounds[i] + bounds[i + 1]) / 2);
    const candidates = [...mids, L / 3, (2 * L) / 3].filter(
      (x) => x > NUDGE_STEP && x < L - NUDGE_STEP && !hasMomentAt(model, x)
    );
    const at = freeSpot(model, candidates, L / 2);
    const hinges = [...(model.hinges ?? []), { at }].sort((a, b) => a.at - b.at);
    get().patch({ ...model, hinges });
  },

  updateHinge(index, patch) {
    const { model } = get();
    const hinges = (model.hinges ?? []).map((h, i) => (i === index ? { ...h, ...patch } : h));
    get().patch({ ...model, hinges });
  },

  removeHinge(index) {
    const { model } = get();
    get().patch({ ...model, hinges: (model.hinges ?? []).filter((_, i) => i !== index) });
    set({ selection: null });
  },

  // ————— الأحمال —————

  addLoad(kind) {
    const { model } = get();
    const L = totalLength(model);
    const mid = L / 2;
    let load: LoadDef;
    switch (kind) {
      case "point":
        load = { type: "point", at: mid, magnitude: -20 };
        break;
      case "moment":
        load = { type: "moment", at: mid, magnitude: 20 };
        break;
      case "udl":
        load = { type: "udl", from: 0, to: L, w: -10 };
        break;
      case "linear":
        load = { type: "linear", from: 0, to: L, w1: 0, w2: -10 };
        break;
    }
    get().patch({ ...model, loads: [...model.loads, load] });
  },

  updateLoad(index, patch) {
    const { model } = get();
    const loads = model.loads.map((l, i) =>
      i === index ? (Object.assign({}, l, patch) as LoadDef) : l
    );
    get().patch({ ...model, loads });
  },

  changeLoadKind(index, kind) {
    const { model } = get();
    const l = model.loads[index];
    if (!l || l.type === kind) return;
    const L = totalLength(model);

    const at = l.type === "point" || l.type === "moment" ? l.at : l.from;
    const from = l.type === "udl" || l.type === "linear" ? l.from : clamp(at - 1, 0, L);
    const to = l.type === "udl" || l.type === "linear" ? l.to : clamp(at + 1, 0, L);
    const mag =
      l.type === "point" || l.type === "moment" ? l.magnitude : l.type === "udl" ? l.w : l.w1;
    const value = mag !== 0 ? mag : -10;

    let next: LoadDef;
    switch (kind) {
      case "point":
        next = { type: "point", at, magnitude: value };
        break;
      case "moment":
        next = { type: "moment", at, magnitude: value };
        break;
      case "udl":
        next = { type: "udl", from, to: to > from ? to : Math.min(from + 1, L), w: value };
        break;
      case "linear":
        next = {
          type: "linear",
          from,
          to: to > from ? to : Math.min(from + 1, L),
          w1: 0,
          w2: value,
        };
        break;
    }
    get().patch({ ...model, loads: model.loads.map((x, i) => (i === index ? next : x)) });
  },

  removeLoad(index) {
    const { model } = get();
    get().patch({ ...model, loads: model.loads.filter((_, i) => i !== index) });
    set({ selection: null });
  },

  // ————— الإزاحة —————

  moveEntity(sel, at, history = true) {
    const { model } = get();
    const L = totalLength(model);

    if (sel.kind === "support") {
      const x = clamp(at, 0, L);
      const supports = model.supports.map((s, i) => (i === sel.index ? { ...s, at: x } : s));
      get().patch({ ...model, supports }, history);
      return;
    }

    if (sel.kind === "hinge") {
      // المفصل يجب أن يبقى داخل الكمرة بشكل صريح، لا على طرفها
      const x = clamp(at, NUDGE_STEP, Math.max(NUDGE_STEP, L - NUDGE_STEP));
      const hinges = (model.hinges ?? []).map((h, i) => (i === sel.index ? { ...h, at: x } : h));
      get().patch({ ...model, hinges }, history);
      return;
    }

    if (sel.kind === "load") {
      const l = model.loads[sel.index];
      if (!l) return;
      let next: LoadDef;
      if (l.type === "point" || l.type === "moment") {
        next = { ...l, at: clamp(at, 0, L) };
      } else {
        // الحمل الموزع يُنقل كوحدة واحدة: الطول محفوظ والطرفان داخل الكمرة
        const width = l.to - l.from;
        const from = clamp(at, 0, Math.max(0, L - width));
        next = { ...l, from, to: from + width };
      }
      get().patch({ ...model, loads: model.loads.map((x, i) => (i === sel.index ? next : x)) }, history);
    }
  },

  nudge(sel, delta) {
    const { model } = get();
    if (sel.kind === "span") return;

    let base: number;
    if (sel.kind === "support") base = model.supports[sel.index]?.at ?? 0;
    else if (sel.kind === "hinge") base = (model.hinges ?? [])[sel.index]?.at ?? 0;
    else {
      const l = model.loads[sel.index];
      if (!l) return;
      base = l.type === "point" || l.type === "moment" ? l.at : l.from;
    }
    get().moveEntity(sel, base + delta);
  },
}));
