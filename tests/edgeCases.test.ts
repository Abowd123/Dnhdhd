import { describe, expect, it } from "vitest";
import { analyzeBeam, queryAt, tryAnalyzeBeam } from "../src/engine/analyze";
import { BeamModel } from "../src/engine/types";

const EI = 40000; // 200 GPa × 2e-4 m⁴
const span = (id: string, length: number) => ({ id, length, E: 200, I: 2e-4 });

describe("أحمال على مواضع حرجة", () => {
  it("حمل مركز فوق مسند تماماً: يمرّ كله إلى ذلك المسند ولا يُنتج قصاً ولا عزماً", () => {
    const a = analyzeBeam({
      spans: [span("s1", 6)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
      ],
      loads: [{ type: "point", at: 0, magnitude: -50 }],
    });
    expect(a.solution.supportReactions[0].Fy).toBeCloseTo(50, 9);
    expect(a.solution.supportReactions[1].Fy).toBeCloseTo(0, 9);
    expect(a.diagrams.extrema.maxAbsV.value).toBeCloseTo(0, 9);
    expect(a.diagrams.extrema.maxAbsM.value).toBeCloseTo(0, 9);
    expect(Math.abs(a.deflection.maxAbsDeflection.value)).toBeLessThan(1e-14);
    expect(a.health.ok).toBe(true);
  });

  it("عزم مركز عند طرف الكمرة: M = 30 يسار الطرف وصفر بعده", () => {
    const a = analyzeBeam({
      spans: [span("s1", 6)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
      ],
      loads: [{ type: "moment", at: 6, magnitude: 30 }],
    });
    expect(a.solution.supportReactions[0].Fy).toBeCloseTo(5, 9);
    expect(a.solution.supportReactions[1].Fy).toBeCloseTo(-5, 9);
    const q = queryAt(a, 6);
    expect(q.M.left).toBeCloseTo(30, 8);
    expect(queryAt(a, 3).V.left).toBeCloseTo(5, 9);
  });

  it("عزم مركز فوق تثبيت تام: يُمتصّ كاملاً في رد الفعل العزمي", () => {
    const a = analyzeBeam({
      spans: [span("s1", 3)],
      supports: [{ at: 0, type: "fixed" }],
      loads: [{ type: "moment", at: 0, magnitude: 20 }],
    });
    expect(a.solution.supportReactions[0].Mz).toBeCloseTo(-20, 9);
    expect(a.solution.supportReactions[0].Fy).toBeCloseTo(0, 9);
    expect(a.diagrams.extrema.maxAbsM.value).toBeCloseTo(0, 9);
    expect(a.health.ok).toBe(true);
  });

  it("حمل مركز فوق مفصل داخلي: يذهب كله إلى الجانب الأصلب", () => {
    // fixed@0 + مفصل@6 + roller@12. الجزء الأيمن مفصول الطرفين فلا يقاوم
    // إزاحة العقدة 6 إطلاقاً، فالكابولي الأيسر يحمل كل الـ 10 kN.
    const a = analyzeBeam({
      spans: [span("s1", 6), span("s2", 6)],
      supports: [
        { at: 0, type: "fixed" },
        { at: 12, type: "roller" },
      ],
      hinges: [{ at: 6 }],
      loads: [{ type: "point", at: 6, magnitude: -10 }],
    });
    expect(a.solution.supportReactions.find((r) => r.at === 0)!.Fy).toBeCloseTo(10, 8);
    expect(a.solution.supportReactions.find((r) => r.at === 0)!.Mz).toBeCloseTo(60, 8);
    expect(a.solution.supportReactions.find((r) => r.at === 12)!.Fy).toBeCloseTo(0, 8);
    const q = queryAt(a, 6);
    expect(q.M.left).toBeCloseTo(0, 8);
    expect(q.v).toBeCloseTo((-10 * 6 ** 3) / (3 * EI), 10); // PL³/3EI = −0.018
    expect(a.health.ok).toBe(true);
  });

  it("حملان مركزان في الموضع نفسه يُجمعان", () => {
    const supports: BeamModel["supports"] = [
      { at: 0, type: "pinned" },
      { at: 6, type: "roller" },
    ];
    const one = analyzeBeam({
      spans: [span("s1", 6)],
      supports,
      loads: [{ type: "point", at: 3, magnitude: -50 }],
    });
    const two = analyzeBeam({
      spans: [span("s1", 6)],
      supports,
      loads: [
        { type: "point", at: 3, magnitude: -20 },
        { type: "point", at: 3, magnitude: -30 },
      ],
    });
    expect(two.diagrams.extrema.maxM.value).toBeCloseTo(one.diagrams.extrema.maxM.value, 10);
    expect(two.deflection.maxAbsDeflection.value).toBeCloseTo(
      one.deflection.maxAbsDeflection.value,
      12
    );
  });

  it("حمل صفري وحمل موزع صفري لا يُنتجان NaN", () => {
    const a = analyzeBeam({
      spans: [span("s1", 6)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
      ],
      loads: [
        { type: "point", at: 3, magnitude: 0 },
        { type: "udl", from: 1, to: 4, w: 0 },
      ],
    });
    for (const p of a.diagrams.points) {
      expect(Number.isFinite(p.V)).toBe(true);
      expect(Number.isFinite(p.M)).toBe(true);
    }
    expect(a.deflection.segments[0].ratio).toBe(Infinity);
    expect(a.health.ok).toBe(true);
  });

  it("نموذج بلا أحمال إطلاقاً: كل شيء صفر وبلا NaN", () => {
    const a = analyzeBeam({
      spans: [span("s1", 6), span("s2", 6)],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "roller" },
        { at: 12, type: "roller" },
      ],
      loads: [],
    });
    expect(a.diagrams.extrema.maxAbsV.value).toBeCloseTo(0, 12);
    expect(a.diagrams.extrema.maxAbsM.value).toBeCloseTo(0, 12);
    expect(Number.isFinite(a.deflection.maxAbsDeflection.value)).toBe(true);
    expect(a.deflection.maxAbsDeflection.value).toBeCloseTo(0, 14);
    expect(a.health.ok).toBe(true);
  });

  it("حمل لأعلى (رفع): الردود سالبة والعزم هوغ", () => {
    const a = analyzeBeam({
      spans: [span("s1", 6)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
      ],
      loads: [{ type: "udl", from: 0, to: 6, w: +10 }],
    });
    expect(a.solution.supportReactions[0].Fy).toBeCloseTo(-30, 9);
    expect(a.diagrams.extrema.minM.value).toBeCloseTo(-45, 8);
    expect(a.deflection.maxAbsDeflection.value).toBeCloseTo((5 * 10 * 6 ** 4) / (384 * EI), 12);
  });
});

describe("حالات مساند غير مألوفة", () => {
  it("نوابض فقط بلا أي درجة مقيَّدة: النظام مستقر مرناً", () => {
    const L = 8;
    const k = 5000;
    const P = -50;
    const a = analyzeBeam({
      spans: [span("s1", L)],
      supports: [
        { at: 0, type: "spring", springStiffness: k },
        { at: L, type: "spring", springStiffness: k },
      ],
      loads: [{ type: "point", at: L / 2, magnitude: P }],
    });
    expect(a.solution.beam.dofMap.prescribed.size).toBe(0);
    // بالتناظر: كل نابض يحمل P/2
    expect(a.solution.supportReactions[0].Fy).toBeCloseTo(25, 8);
    expect(a.solution.supportReactions[1].Fy).toBeCloseTo(25, 8);
    expect(a.solution.supportReactions[0].displacement).toBeCloseTo(-0.005, 10); // −25/5000
    // الترخيم المطلق = هبوط النابض + تقوس الكمرة
    const mid = queryAt(a, L / 2);
    expect(mid.v).toBeCloseTo(-0.005 + (P * L ** 3) / (48 * EI), 10); // −0.0183333
    // النسبي إلى الوتر = PL³/48EI فقط
    const seg = a.deflection.segments[0];
    expect(seg.maxRelative.value).toBeCloseTo((P * L ** 3) / (48 * EI), 12);
    expect(a.diagrams.extrema.maxM.value).toBeCloseTo((-P * L) / 4, 8);
    expect(a.health.ok).toBe(true);
  });

  it("هبوط تثبيت تام وحيد: انتقال جسمي صلب بلا أي إجهاد", () => {
    const delta = -0.005;
    const a = analyzeBeam({
      spans: [span("s1", 3)],
      supports: [{ at: 0, type: "fixed", settlement: delta }],
      loads: [],
    });
    expect(a.solution.supportReactions[0].Fy).toBeCloseTo(0, 12);
    expect(a.solution.supportReactions[0].Mz).toBeCloseTo(0, 12);
    expect(a.diagrams.extrema.maxAbsM.value).toBeCloseTo(0, 12);
    for (const p of a.deflection.points) expect(p.v).toBeCloseTo(delta, 14);
    const seg = a.deflection.segments[0];
    expect(seg.kind).toBe("cantilever");
    expect(Math.abs(seg.maxRelative.value)).toBeLessThan(1e-14);
    expect(seg.ratio).toBe(Infinity);
  });

  it("مفصلان داخليان مع قيود كافية", () => {
    const a = analyzeBeam({
      spans: [span("s1", 6), span("s2", 6)],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "roller" },
        { at: 12, type: "roller" },
      ],
      hinges: [{ at: 4 }, { at: 8 }],
      loads: [{ type: "udl", from: 0, to: 12, w: -10 }],
    });
    // كل مفصل يضيف درجة دوران واحدة
    expect(a.solution.beam.dofMap.nDof).toBe(2 * a.solution.beam.nodes.length + 2);
    expect(queryAt(a, 4).M.left).toBeCloseTo(0, 7);
    expect(queryAt(a, 4).M.right).toBeCloseTo(0, 7);
    expect(queryAt(a, 8).M.left).toBeCloseTo(0, 7);
    expect(queryAt(a, 8).M.right).toBeCloseTo(0, 7);
    expect(a.deflection.points.filter((p) => p.thetaJump)).toHaveLength(2);
    expect(a.health.ok).toBe(true);
  });

  it("كابوليان على الطرفين: ثلاثة قطاعات وقص صفري عند الطرفين الحرين", () => {
    const a = analyzeBeam({
      spans: [span("a", 2), span("b", 6), span("c", 2)],
      supports: [
        { at: 2, type: "pinned" },
        { at: 8, type: "roller" },
      ],
      loads: [{ type: "udl", from: 0, to: 10, w: -12 }],
    });
    expect(queryAt(a, 0).V.right).toBeCloseTo(0, 8);
    expect(queryAt(a, 10).V.left).toBeCloseTo(0, 8);
    expect(queryAt(a, 2).M.left).toBeCloseTo(-24, 8); // −wa²/2
    expect(a.deflection.segments).toHaveLength(3);
    expect(a.deflection.segments.filter((s) => s.kind === "cantilever")).toHaveLength(2);
  });
});

describe("متانة عددية", () => {
  it("تباين جساءة 1:10000 بين بحرين لا يُفسد التوازن", () => {
    const a = analyzeBeam({
      spans: [
        { id: "stiff", length: 6, E: 200, I: 2e-4 }, // EI = 40000
        { id: "soft", length: 6, E: 200, I: 2e-8 }, // EI = 4
      ],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "roller" },
        { at: 12, type: "roller" },
      ],
      loads: [{ type: "udl", from: 0, to: 12, w: -10 }],
    });
    // الحد 1e-7 أوسع من حد التحذير 1e-8 عن قصد: التباين يرفع مؤشر التكييف
    expect(a.health.equilibriumFy).toBeLessThan(1e-7);
    expect(a.health.equilibriumMz).toBeLessThan(1e-7);
    expect(Number.isFinite(a.health.conditionHint)).toBe(true);
    const total = a.solution.supportReactions.reduce((s, r) => s + r.Fy, 0);
    expect(total).toBeCloseTo(120, 6);
  });

  it("عنصر قصير جداً بجانب عنصر طويل", () => {
    const a = analyzeBeam({
      spans: [span("long", 6), span("tiny", 0.02)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
      ],
      loads: [{ type: "udl", from: 0, to: 6.02, w: -10 }],
    });
    expect(queryAt(a, 6).M.left).toBeCloseTo(-0.002, 10); // −w·a²/2
    expect(queryAt(a, 6.02).V.left).toBeCloseTo(0, 8);
    expect(a.health.equilibriumFy).toBeLessThan(1e-8);
  });

  it("أربعون بحراً: الحل يبقى متوازناً", () => {
    const n = 40;
    const spans = Array.from({ length: n }, (_, i) => span(`s${i}`, 5));
    const supports = Array.from({ length: n + 1 }, (_, i) => ({
      at: i * 5,
      type: (i === 0 ? "pinned" : "roller") as "pinned" | "roller",
    }));
    const a = analyzeBeam({
      spans,
      supports,
      loads: [{ type: "udl", from: 0, to: 5 * n, w: -10 }],
    });
    expect(a.solution.beam.dofMap.nDof).toBe(2 * (n + 1));
    const total = a.solution.supportReactions.reduce((s, r) => s + r.Fy, 0);
    expect(total).toBeCloseTo(10 * 5 * n, 5);
    expect(a.health.equilibriumFy).toBeLessThan(1e-8);
    expect(a.health.continuity).toBeLessThan(1e-8);
  });

  it("التطابق الخطي على القص والعزم والترخيم معاً", () => {
    const base: Pick<BeamModel, "spans" | "supports"> = {
      spans: [span("s1", 6), span("s2", 6)],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "roller" },
        { at: 12, type: "roller" },
      ],
    };
    const la: BeamModel["loads"] = [{ type: "udl", from: 0, to: 12, w: -10 }];
    const lb: BeamModel["loads"] = [{ type: "point", at: 9, magnitude: -40 }];
    const A = analyzeBeam({ ...base, loads: la });
    const B = analyzeBeam({ ...base, loads: lb });
    const AB = analyzeBeam({ ...base, loads: [...la, ...lb] });
    for (const x of [1, 3, 5.9, 7, 9, 11]) {
      const qa = queryAt(A, x);
      const qb = queryAt(B, x);
      const qab = queryAt(AB, x);
      expect(qab.V.left).toBeCloseTo(qa.V.left + qb.V.left, 8);
      expect(qab.M.left).toBeCloseTo(qa.M.left + qb.M.left, 8);
      expect(qab.v).toBeCloseTo(qa.v + qb.v, 12);
    }
  });
});

describe("رفض المُدخلات التالفة", () => {
  it("NaN في طول بحر", () => {
    const r = tryAnalyzeBeam({
      spans: [{ id: "s1", length: Number.NaN, E: 200, I: 2e-4 }],
      supports: [{ at: 0, type: "fixed" }],
      loads: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SPAN_INVALID");
  });

  it("NaN في قيمة حمل", () => {
    const r = tryAnalyzeBeam({
      spans: [span("s1", 6)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
      ],
      loads: [{ type: "point", at: 3, magnitude: Number.NaN }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LOAD_INVALID");
  });

  it("Infinity في جساءة نابض", () => {
    const r = tryAnalyzeBeam({
      spans: [span("s1", 6)],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "spring", springStiffness: Number.POSITIVE_INFINITY },
      ],
      loads: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SPRING_INVALID");
  });

  it("نص JSON تالف", () => {
    const r = tryAnalyzeBeam("{ spans: [ ");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("JSON");
      expect(r.message).toContain("JSON");
    }
  });

  it("جذر JSON مصفوفة لا كائناً", () => {
    const r = tryAnalyzeBeam("[]");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("JSON");
  });

  it("كل رسائل الرفض عربية وغير فارغة", () => {
    const bad: BeamModel[] = [
      { spans: [], supports: [], loads: [] },
      { spans: [span("s1", 6)], supports: [], loads: [] },
      { spans: [span("s1", 6)], supports: [{ at: 0, type: "roller" }], loads: [] },
    ];
    for (const m of bad) {
      const r = tryAnalyzeBeam(m);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message.length).toBeGreaterThan(10);
        expect(/[\u0600-\u06FF]/.test(r.message)).toBe(true);
      }
    }
  });
});

describe("طبقة analyze", () => {
  it("الوضع التفاعلي يخفّف العينات ولا يغيّر رقماً واحداً", () => {
    const model: BeamModel = {
      spans: [span("s1", 6), span("s2", 6)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
        { at: 12, type: "roller" },
      ],
      loads: [{ type: "udl", from: 0, to: 12, w: -10 }],
    };
    const fast = analyzeBeam(model, { interactive: true });
    const full = analyzeBeam(model, { samplesPerElement: 200 });
    expect(fast.diagrams.points.length).toBeLessThan(full.diagrams.points.length);
    expect(fast.diagrams.extrema.maxM.value).toBeCloseTo(full.diagrams.extrema.maxM.value, 10);
    expect(fast.diagrams.extrema.minM.value).toBeCloseTo(full.diagrams.extrema.minM.value, 10);
    expect(fast.deflection.maxAbsDeflection.value).toBeCloseTo(
      full.deflection.maxAbsDeflection.value,
      12
    );
    expect(fast.deflection.segments[0].ratio).toBeCloseTo(full.deflection.segments[0].ratio, 6);
  });

  it("health.worst يساوي أسوأ الفحوص الخمسة", () => {
    const a = analyzeBeam({
      spans: [span("s1", 6)],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "fixed" },
      ],
      loads: [{ type: "udl", from: 0, to: 6, w: -10 }],
    });
    const h = a.health;
    expect(h.worst).toBeCloseTo(
      Math.max(
        h.equilibriumFy,
        h.equilibriumMz,
        h.continuity,
        h.deflectionConsistency,
        h.solveResidual
      ),
      15
    );
    expect(h.ok).toBe(true);
  });
});
