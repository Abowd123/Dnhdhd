import { describe, expect, it } from "vitest";
import { buildDeflection, evaluateDeflectionAt } from "../src/engine/deflection";
import { buildDiagrams } from "../src/engine/internalForces";
import { solveBeam } from "../src/engine/solver";
import { BeamModel } from "../src/engine/types";

// E = 200 GPa، I = 2e-4 m⁴  →  EI = 40000 kN·m²
const EI = 40000;
const span = (id: string, length: number) => ({ id, length, E: 200, I: 2e-4 });

function analyze(model: BeamModel, samples = 40) {
  const sol = solveBeam(model);
  const diagrams = buildDiagrams(sol, { samplesPerElement: samples });
  return buildDeflection(sol, diagrams, { samplesPerElement: samples });
}

const simple = (loads: BeamModel["loads"], L = 6): BeamModel => ({
  spans: [span("s1", L)],
  supports: [
    { at: 0, type: "pinned" },
    { at: L, type: "roller" },
  ],
  loads,
});

describe("حلول مغلقة للترخيم", () => {
  it("كمرة بسيطة بحمل موزع: δ = 5wL⁴/384EI في المنتصف", () => {
    const w = -10;
    const L = 6;
    const d = analyze(simple([{ type: "udl", from: 0, to: L, w }]));
    const expected = (5 * w * L ** 4) / (384 * EI); // −4.21875e-3
    expect(d.maxAbsDeflection.value).toBeCloseTo(expected, 12);
    expect(d.maxAbsDeflection.x).toBeCloseTo(3, 9);
    // الميل عند الطرفين = ∓wL³/24EI
    expect(evaluateDeflectionAt(d, 0).theta.right).toBeCloseTo((w * L ** 3) / (24 * EI), 12);
    expect(evaluateDeflectionAt(d, L).theta.left).toBeCloseTo(-(w * L ** 3) / (24 * EI), 12);
    // الترخيم ينعدم عند المسندين
    expect(evaluateDeflectionAt(d, 0).v).toBeCloseTo(0, 14);
    expect(evaluateDeflectionAt(d, L).v).toBeCloseTo(0, 14);
    expect(d.consistency.ok).toBe(true);
  });

  it("كمرة بسيطة بحمل مركز في المنتصف: δ = PL³/48EI والميل PL²/16EI", () => {
    const P = -50;
    const L = 8;
    const d = analyze(simple([{ type: "point", at: L / 2, magnitude: P }], L));
    expect(d.maxAbsDeflection.value).toBeCloseTo((P * L ** 3) / (48 * EI), 12); // −0.0133333
    expect(d.maxAbsDeflection.x).toBeCloseTo(4, 9);
    expect(evaluateDeflectionAt(d, 0).theta.right).toBeCloseTo((P * L ** 2) / (16 * EI), 12);
  });

  it("كابولي بحمل عند الطرف: δ = PL³/3EI والميل PL²/2EI", () => {
    const P = -10;
    const L = 3;
    const d = analyze({
      spans: [span("s1", L)],
      supports: [{ at: 0, type: "fixed" }],
      loads: [{ type: "point", at: L, magnitude: P }],
    });
    expect(evaluateDeflectionAt(d, L).v).toBeCloseTo((P * L ** 3) / (3 * EI), 12); // −2.25e-3
    expect(evaluateDeflectionAt(d, L).theta.left).toBeCloseTo((P * L ** 2) / (2 * EI), 12);
    // عند التثبيت التام: إزاحة صفر وميل صفر
    expect(evaluateDeflectionAt(d, 0).v).toBeCloseTo(0, 14);
    expect(evaluateDeflectionAt(d, 0).theta.right).toBeCloseTo(0, 14);
  });

  it("كابولي بحمل موزع: δ = wL⁴/8EI والميل wL³/6EI", () => {
    const w = -10;
    const L = 4;
    const d = analyze({
      spans: [span("s1", L)],
      supports: [{ at: 0, type: "fixed" }],
      loads: [{ type: "udl", from: 0, to: L, w }],
    });
    expect(evaluateDeflectionAt(d, L).v).toBeCloseTo((w * L ** 4) / (8 * EI), 12); // −8e-3
    expect(evaluateDeflectionAt(d, L).theta.left).toBeCloseTo((w * L ** 3) / (6 * EI), 12);
    expect(d.maxAbsDeflection.x).toBeCloseTo(L, 9);
  });

  it("مثبتة الطرفين بحمل موزع: δ = wL⁴/384EI — خُمس الكمرة البسيطة", () => {
    const w = -10;
    const L = 6;
    const d = analyze({
      spans: [span("s1", L)],
      supports: [
        { at: 0, type: "fixed" },
        { at: L, type: "fixed" },
      ],
      loads: [{ type: "udl", from: 0, to: L, w }],
    });
    expect(evaluateDeflectionAt(d, 3).v).toBeCloseTo((w * L ** 4) / (384 * EI), 12); // −8.4375e-4
    expect(d.maxAbsRotation.value).not.toBe(0);
    // الميل صفر عند كلا التثبيتين
    expect(evaluateDeflectionAt(d, 0).theta.right).toBeCloseTo(0, 14);
    expect(evaluateDeflectionAt(d, L).theta.left).toBeCloseTo(0, 14);
  });

  it("مثبتة الطرفين بحمل مركز في المنتصف: δ = PL³/192EI", () => {
    const P = -40;
    const L = 8;
    const d = analyze({
      spans: [span("s1", L)],
      supports: [
        { at: 0, type: "fixed" },
        { at: L, type: "fixed" },
      ],
      loads: [{ type: "point", at: L / 2, magnitude: P }],
    });
    expect(evaluateDeflectionAt(d, L / 2).v).toBeCloseTo((P * L ** 3) / (192 * EI), 12);
  });

  it("كابولي مدعوم (fixed + roller) بحمل موزع: δmax = wL⁴/185EI عند 0.5785L", () => {
    const w = -12;
    const L = 6;
    const d = analyze({
      spans: [span("s1", L)],
      supports: [
        { at: 0, type: "fixed" },
        { at: L, type: "roller" },
      ],
      loads: [{ type: "udl", from: 0, to: L, w }],
    });
    // القيم الجدولية تقريبية بثلاث خانات، فالتفاوت هنا نسبي لا مطلق
    const approx = (w * L ** 4) / (185 * EI);
    expect(d.maxAbsDeflection.value / approx).toBeCloseTo(1, 3);
    expect(d.maxAbsDeflection.x / L).toBeCloseTo(0.5785, 3);
  });
});

describe("فحص التناسق — تكامل M/EI يعيد القيم العقدية", () => {
  it("نموذج مختلط: التناسق محقَّق بدقة الآلة", () => {
    const d = analyze({
      spans: [
        { id: "s1", length: 6, E: 200, I: 2e-4 },
        { id: "s2", length: 4.5, E: 30, I: 8e-4 },
        { id: "s3", length: 3, E: 200, I: 2e-4 },
      ],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "roller" },
        { at: 10.5, type: "pinned", settlement: -0.003 },
      ],
      loads: [
        { type: "point", at: 3, magnitude: -50 },
        { type: "moment", at: 6, magnitude: 20 },
        { type: "udl", from: 6, to: 10.5, w: -15 },
        { type: "linear", from: 10.5, to: 13.5, w1: -20, w2: 0 },
      ],
    });
    expect(d.consistency.ok).toBe(true);
    expect(d.consistency.maxError).toBeLessThan 
(1e-10);
  });

  it("تقسيم البحر إلى بحرين بنفس الجساءة لا يغيّر الترخيم — دليل الضبط", () => {
    const loads: BeamModel["loads"] = [{ type: "udl", from: 0, to: 6, w: -10 }];
    const one = analyze({
      spans: [span("s1", 6)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
      ],
      loads,
    });
    const two = analyze({
      spans: [span("a", 2), span("b", 1.5), span("c", 2.5)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
      ],
      loads,
    });
    expect(two.maxAbsDeflection.value).toBeCloseTo(one.maxAbsDeflection.value, 12);
    expect(two.maxAbsDeflection.x).toBeCloseTo(one.maxAbsDeflection.x, 9);
    expect(two.elements.length).toBeGreaterThan(one.elements.length);
  });

  it("تخفيف العينات لا يغيّر القيم القصوى لأنها تحليلية", () => {
    const model = simple([{ type: "udl", from: 0, to: 6, w: -10 }]);
    const coarse = analyze(model, 3);
    const fine = analyze(model, 200);
    expect(coarse.maxAbsDeflection.value).toBeCloseTo(fine.maxAbsDeflection.value, 12);
    expect(coarse.maxAbsDeflection.x).toBeCloseTo(fine.maxAbsDeflection.x, 10);
    expect(coarse.points.length).toBeLessThan(fine.points.length);
  });

  it("التطابق الخطي: ترخيم مجموع حملين = مجموع ترخيمَي كل منهما", () => {
    const a: BeamModel["loads"] = [{ type: "udl", from: 0, to: 6, w: -10 }];
    const b: BeamModel["loads"] = [{ type: "point", at: 2, magnitude: -30 }];
    const dA = analyze(simple(a));
    const dB = analyze(simple(b));
    const dAB = analyze(simple([...a, ...b]));
    for (const x of [1, 2, 3, 4, 5]) {
      const sum = evaluateDeflectionAt(dA, x).v + evaluateDeflectionAt(dB, x).v;
      expect(evaluateDeflectionAt(dAB, x).v).toBeCloseTo(sum, 12);
    }
  });
});

describe("الهبوط والمسند المرن والمفصل", () => {
  it("الهبوط المفروض يظهر في المنحنى بقيمته بالضبط", () => {
    const delta = -0.005;
    const d = analyze({
      spans: [span("s1", 6)],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "roller", settlement: delta },
      ],
      loads: [],
    });
    expect(evaluateDeflectionAt(d, 6).v).toBeCloseTo(delta, 14);
    expect(evaluateDeflectionAt(d, 0).v).toBeCloseTo(0, 14);
    // منحنى كابولي مدعوم بإزاحة طرفية: v(x) = δ(3x² L − x³)/(2L³)
    const L = 6;
    const x = 3;
    expect(evaluateDeflectionAt(d, x).v).toBeCloseTo(
      (delta * (3 * x * x * L - x ** 3)) / (2 * L ** 3),
      12
    );
  });

  it("الهبوط الجسمي الصلب لا يُنتج ترخيماً نسبياً ولا نسبة L/δ", () => {
    // مسندان مفصليان أحدهما هابط وبلا أحمال: الكمرة تميل بلا تقوس
    const d = analyze({
      spans: [span("s1", 6)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller", settlement: -0.01 },
      ],
      loads: [],
    });
    const seg = d.segments.find((s) => s.kind === "internal")!;
    expect(Math.abs(seg.maxRelative.value)).toBeLessThan(1e-14);
    expect(seg.ratio).toBe(Infinity);
    // لكن الترخيم المطلق موجود فعلاً
    expect(Math.abs(seg.maxAbsolute.value)).toBeCloseTo(0.01, 12);
  });

  it("المسند المرن: الإزاحة عنده تطابق حل النابض", () => {
    const L = 3;
    const ks = 1000;
    const d = analyze({
      spans: [span("s1", L)],
      supports: [
        { at: 0, type: "fixed" },
        { at: L, type: "spring", springStiffness: ks },
      ],
      loads: [{ type: "point", at: L, magnitude: -10 }],
    });
    const kBeam = (3 * EI) / L ** 3;
    expect(evaluateDeflectionAt(d, L).v).toBeCloseTo(-10 / (ks + kBeam), 12);
  });

  it("المفصل الداخلي: الترخيم مستمر والميل ينفصل", () => {
    const d = analyze({
      spans: [span("s1", 6), span("s2", 6)],
      supports: [
        { at: 0, type: "fixed" },
        { at: 12, type: "roller" },
      ],
      hinges: [{ at: 6 }],
      loads: [{ type: "point", at: 9, magnitude: -10 }],
    });
    const q = evaluateDeflectionAt(d, 6);
    expect(q.thetaJump).toBe(true);
    expect(q.theta.left).not.toBeCloseTo(q.theta.right, 6);
    // الجزء الأيسر كابولي بطرف 5 kN: δ = PL³/3EI عند المفصل
    expect(q.v).toBeCloseTo((-5 * 6 ** 3) / (3 * EI), 10);
    // نقطة انفصال الميل مسجَّلة في مجموعة الرسم
    expect(d.points.some((p) => p.thetaJump)).toBe(true);
    expect(d.consistency.ok).toBe(true);
  });
});

describe("قطاعات قابلية الخدمة", () => {
  it("كمرة بسيطة: نسبة L/δ صحيحة وقطاع داخلي واحد", () => {
    const d = analyze(simple([{ type: "udl", from: 0, to: 6, w: -10 }]));
    expect(d.segments).toHaveLength(1);
    const seg = d.segments[0];
    expect(seg.kind).toBe("internal");
    expect(seg.effectiveLength).toBeCloseTo(6, 12);
    expect(seg.ratio).toBeCloseTo(6 / 4.21875e-3, 6); // ≈ 1422.2
  });

  it("كابولي طرفي يُعدّ قطاعاً منفصلاً بطول مرجعي مضاعف", () => {
    const d = analyze({
      spans: [span("s1", 6), span("s2", 2)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
      ],
      loads: [{ type: "udl", from: 0, to: 8, w: -10 }],
    });
    expect(d.segments).toHaveLength(2);
    const inner = d.segments.find((s) => s.kind === "internal")!;
    const tip = d.segments.find((s) => s.kind === "cantilever")!;
    expect(inner.fromX).toBeCloseTo(0, 12);
    expect(inner.toX).toBeCloseTo(6, 12);
    expect(tip.fromX).toBeCloseTo(6, 12);
    expect(tip.toX).toBeCloseTo(8, 12);
    expect(tip.effectiveLength).toBeCloseTo(4, 12); // 2 × 2
    // الكابولي يترخم لأسفل والبحر الداخلي كذلك
    expect(tip.maxRelative.value).toBeLessThan(0);
    expect(inner.maxRelative.value).toBeLessThan(0);
  });

  it("عامل الكابولي قابل للضبط من مكان واحد", () => {
    const model: BeamModel = {
      spans: [span("s1", 6), span("s2", 2)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
      ],
      loads: [{ type: "udl", from: 0, to: 8, w: -10 }],
    };
    const sol = solveBeam(model);
    const diagrams = buildDiagrams(sol);
    const d1 = buildDeflection(sol, diagrams, { cantileverFactor: 1 });
    const tip = d1.segments.find((s) => s.kind === "cantilever")!;
    expect(tip.effectiveLength).toBeCloseTo(2, 12);
  });

  it("ثلاثة بحور تُنتج ثلاثة قطاعات داخلية", () => {
    const d = analyze({
      spans: [span("s1", 5), span("s2", 5), span("s3", 5)],
      supports: [
        { at: 0, type: "pinned" },
        { at: 5, type: "roller" },
        { at: 10, type: "roller" },
        { at: 15, type: "roller" },
      ],
      loads: [{ type: "udl", from: 0, to: 15, w: -12 }],
    });
    expect(d.segments).toHaveLength(3);
    expect(d.segments.every((s) => s.kind === "internal")).toBe(true);
    // البحر الأوسط أقل ترخيماً من الطرفيين في كمرة ثلاثية متساوية البحور
    const [a, b, c] = d.segments;
    expect(Math.abs(b.maxRelative.value)).toBeLessThan(Math.abs(a.maxRelative.value));
    expect(Math.abs(a.maxRelative.value)).toBeCloseTo(Math.abs(c.maxRelative.value), 10);
  });
});
