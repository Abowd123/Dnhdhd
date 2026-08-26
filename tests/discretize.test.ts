import { describe, expect, it } from "vitest";
import { discretize, computeEI } from "../src/engine/discretize";
import { BeamError } from "../src/engine/errors";
import { BeamModel } from "../src/engine/types";

const span = (id: string, length: number): BeamModel["spans"][number] => ({
  id,
  length,
  E: 200,
  I: 2e-4,
});

const simple = (loads: BeamModel["loads"], length = 6): BeamModel => ({
  spans: [span("s1", length)],
  supports: [
    { at: 0, type: "pinned" },
    { at: length, type: "roller" },
  ],
  loads,
});

describe("computeEI", () => {
  it("يحوّل GPa إلى kN·m² بشكل صحيح", () => {
    // 200 GPa × 2e-4 m⁴ = 200e6 kN/m² × 2e-4 = 40000 kN·m²
    expect(computeEI(200, 2e-4)).toBeCloseTo(40000, 9);
  });
});

describe("التقطيع", () => {
  it("كمرة بسيطة بحمل موزع كامل → عنصر واحد", () => {
    const d = discretize(simple([{ type: "udl", from: 0, to: 6, w: -10 }]));
    expect(d.nodes.map((n) => n.x)).toEqual([0, 6]);
    expect(d.elements).toHaveLength(1);
    expect(d.elements[0].w1).toBeCloseTo(-10, 12);
    expect(d.elements[0].w2).toBeCloseTo(-10, 12);
  });

  it("حمل موزع جزئي يُنشئ عقداً عند حدوده", () => {
    const d = discretize(simple([{ type: "udl", from: 2, to: 4.5, w: -15 }]));
    expect(d.nodes.map((n) => n.x)).toEqual([0, 2, 4.5, 6]);
    expect(d.elements.map((e) => [e.w1, e.w2])).toEqual([
      [0, 0],
      [-15, -15],
      [0, 0],
    ]);
  });

  it("الحمل المركز يصبح حملاً عقدياً دقيقاً لا حملاً داخل عنصر", () => {
    const d = discretize(simple([{ type: "point", at: 2.5, magnitude: -50 }], 8));
    const node = d.nodes.find((n) => Math.abs(n.x - 2.5) < 1e-9);
    expect(node).toBeDefined();
    expect(node!.P).toBeCloseTo(-50, 12);
    expect(d.nodes.reduce((s, n) => s + n.P, 0)).toBeCloseTo(-50, 12);
  });

  it("العزم المركز يُسجَّل على العقدة", () => {
    const d = discretize(simple([{ type: "moment", at: 3, magnitude: 20 }]));
    const node = d.nodes.find((n) => Math.abs(n.x - 3) < 1e-9)!;
    expect(node.M).toBeCloseTo(20, 12);
  });

  it("الأحمال الموزعة المتداخلة تُجمع بالتطابق الخطي", () => {
    const d = discretize(
      simple([
        { type: "udl", from: 0, to: 6, w: -10 },
        { type: "udl", from: 2, to: 4, w: -5 },
      ])
    );
    const mid = d.elements.find((e) => Math.abs(e.x0 - 2) < 1e-9)!;
    expect(mid.w1).toBeCloseTo(-15, 12);
    expect(mid.w2).toBeCloseTo(-15, 12);
  });

  it("الحمل الخطي المتغير يُستوفى صحيحاً عند نقاط التقطيع", () => {
    // مثلث من 0 إلى -20 على 6 م، مقطوع عند 3 م بحمل مركز
    const d = discretize(
      simple([
        { type: "linear", from: 0, to: 6, w1: 0, w2: -20 },
        { type: "point", at: 3, magnitude: -10 },
      ])
    );
    expect(d.elements).toHaveLength(2);
    expect(d.elements[0].w1).toBeCloseTo(0, 12);
    expect(d.elements[0].w2).toBeCloseTo(-10, 12);
    expect(d.elements[1].w1).toBeCloseTo(-10, 12);
    expect(d.elements[1].w2).toBeCloseTo(-20, 12);
  });

  it("كل عنصر يقع داخل بحر واحد وجساءته من ذلك البحر", () => {
    const model: BeamModel = {
      spans: [
        { id: "s1", length: 6, E: 200, I: 2e-4 },
        { id: "s2", length: 4, E: 30, I: 8e-4 },
      ],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller" },
        { at: 10, type: "roller" },
      ],
      loads: [{ type: "udl", from: 3, to: 8, w: -12 }],
    };
    const d = discretize(model);
    expect(d.nodes.map((n) => n.x)).toEqual([0, 3, 6, 8, 10]);
    const bySpan = d.elements.map((e) => e.spanId);
    expect(bySpan).toEqual(["s1", "s1", "s2", "s2"]);
    expect(d.elements[0].EI).toBeCloseTo(40000, 6);
    expect(d.elements[3].EI).toBeCloseTo(24000, 6);
  });

  it("المسند داخل البحر مسموح ولا يُتجاهل بصمت", () => {
    const model: BeamModel = {
      spans: [{ id: "s1", length: 10, E: 200, I: 2e-4 }],
      supports: [
        { at: 0, type: "pinned" },
        { at: 4, type: "roller" },
        { at: 10, type: "roller" },
      ],
      loads: [],
    };
    const d = discretize(model);
    expect(d.nodes.filter((n) => n.support !== undefined)).toHaveLength(3);
  });
});

describe("خريطة درجات الحرية", () => {
  it("بلا مفاصل: درجتان لكل عقدة", () => {
    const d = discretize(simple([{ type: "point", at: 2, magnitude: -10 }]));
    expect(d.dofMap.nDof).toBe(2 * d.nodes.length);
  });

  it("المفصل يضيف درجة دوران واحدة ويفصل دوران الجانبين", () => {
    const model: BeamModel = {
      spans: [
        { id: "s1", length: 6, E: 200, I: 2e-4 },
        { id: "s2", length: 6, E: 200, I: 2e-4 },
      ],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "roller" },
        { at: 12, type: "roller" },
      ],
      hinges: [{ at: 8 }],
      loads: [],
    };
    const d = discretize(model);
    expect(d.dofMap.nDof).toBe(2 * d.nodes.length + 1);

    const hingeNode = d.nodes.find((n) => n.hinge)!;
    expect(d.dofMap.rotationsOf[hingeNode.index]).toHaveLength(2);

    const left = d.elements.find((e) => e.nodeEnd === hingeNode.index)!;
    const right = d.elements.find((e) => e.nodeStart === hingeNode.index)!;
    // الإزاحة الرأسية مشتركة، والدوران مفصول
    expect(d.dofMap.elementDofs[left.index][2]).toBe(d.dofMap.elementDofs[right.index][0]);
    expect(d.dofMap.elementDofs[left.index][3]).not.toBe(d.dofMap.elementDofs[right.index][1]);
  });

  it("التثبيت التام يقيّد الإزاحة والدوران، والمتحرك يقيّد الإزاحة فقط", () => {
    const model: BeamModel = {
      spans: [{ id: "s1", length 
: 6, E: 200, I: 2e-4 }],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "roller" },
      ],
      loads: [],
    };
    const d = discretize(model);
    expect(d.dofMap.prescribed.size).toBe(3);
    expect(d.dofMap.prescribed.get(d.dofMap.verticalOf[0])).toBe(0);
    expect(d.dofMap.prescribed.get(d.dofMap.rotationsOf[0][0])).toBe(0);
    expect(d.dofMap.prescribed.has(d.dofMap.rotationsOf[1][0])).toBe(false);
  });

  it("الهبوط المفروض يُسجَّل كقيمة مفروضة لا كصفر", () => {
    const model: BeamModel = {
      spans: [{ id: "s1", length: 6, E: 200, I: 2e-4 }],
      supports: [
        { at: 0, type: "pinned" },
        { at: 6, type: "roller", settlement: -0.005 },
      ],
      loads: [],
    };
    const d = discretize(model);
    expect(d.dofMap.prescribed.get(d.dofMap.verticalOf[1])).toBeCloseTo(-0.005, 12);
  });

  it("المسند المرن يُسجَّل كجساءة لا كقيد", () => {
    const model: BeamModel = {
      spans: [{ id: "s1", length: 6, E: 200, I: 2e-4 }],
      supports: [
        { at: 0, type: "fixed" },
        { at: 6, type: "spring", springStiffness: 5000 },
      ],
      loads: [],
    };
    const d = discretize(model);
    const v = d.dofMap.verticalOf[1];
    expect(d.dofMap.springs.get(v)).toBe(5000);
    expect(d.dofMap.prescribed.has(v)).toBe(false);
  });
});

describe("رفض المُدخلات الخاطئة بدل الإخفاق الصامت", () => {
  const expectCode = (fn: () => unknown, code: string) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(BeamError);
      expect((e as BeamError).code).toBe(code);
      expect((e as BeamError).message.length).toBeGreaterThan(0);
      return;
    }
    throw new Error(`كان متوقعاً رفض المُدخل بالرمز ${code} لكن لم يُرفَض`);
  };

  it("مسند خارج الكمرة", () => {
    expectCode(
      () =>
        discretize({
          spans: [span("s1", 6)],
          supports: [
            { at: 0, type: "pinned" },
            { at: 9, type: "roller" },
          ],
          loads: [],
        }),
      "SUPPORT_OUT_OF_RANGE"
    );
  });

  it("بحر بطول صفر", () => {
    expectCode(
      () =>
        discretize({
          spans: [span("s1", 0)],
          supports: [{ at: 0, type: "fixed" }],
          loads: [],
        }),
      "SPAN_INVALID"
    );
  });

  it("مسند وحيد متحرك → عدم استقرار", () => {
    expectCode(
      () =>
        discretize({
          spans: [span("s1", 6)],
          supports: [{ at: 0, type: "roller" }],
          loads: [],
        }),
      "UNSTABLE"
    );
  });

  it("مفصل بلا قيد إضافي → عدم استقرار", () => {
    expectCode(
      () =>
        discretize({
          spans: [span("s1", 6)],
          supports: [
            { at: 0, type: "pinned" },
            { at: 6, type: "roller" },
          ],
          hinges: [{ at: 3 }],
          loads: [],
        }),
      "UNSTABLE"
    );
  });

  it("مفصل على طرف الكمرة", () => {
    expectCode(
      () =>
        discretize({
          spans: [span("s1", 6)],
          supports: [
            { at: 0, type: "fixed" },
            { at: 6, type: "fixed" },
          ],
          hinges: [{ at: 6 }],
          loads: [],
        }),
      "HINGE_OUT_OF_RANGE"
    );
  });

  it("عزم مركز عند المفصل نفسه", () => {
    expectCode(
      () =>
        discretize({
          spans: [span("s1", 12)],
          supports: [
            { at: 0, type: "fixed" },
            { at: 6, type: "roller" },
            { at: 12, type: "roller" },
          ],
          hinges: [{ at: 8 }],
          loads: [{ type: "moment", at: 8, magnitude: 20 }],
        }),
      "HINGE_CONFLICT"
    );
  });

  it("مسند مرن بلا جساءة", () => {
    expectCode(
      () =>
        discretize({
          spans: [span("s1", 6)],
          supports: [
            { at: 0, type: "fixed" },
            { at: 6, type: "spring" },
          ],
          loads: [],
        }),
      "SPRING_INVALID"
    );
  });

  it("حمل موزع بحدود مقلوبة", () => {
    expectCode(() => discretize(simple([{ type: "udl", from: 4, to: 2, w: -10 }])), "LOAD_INVALID");
  });

  it("حمل موزع يتجاوز نهاية الكمرة", () => {
    expectCode(
      () => discretize(simple([{ type: "udl", from: 4, to: 9, w: -10 }])),
      "LOAD_OUT_OF_RANGE"
    );
  });

  it("مسندان في الموضع نفسه", () => {
    expectCode(
      () =>
        discretize({
          spans: [span("s1", 6)],
          supports: [
            { at: 0, type: "pinned" },
            { at: 0, type: "fixed" },
            { at: 6, type: "roller" },
          ],
          loads: [],
        }),
      "SUPPORT_DUPLICATE"
    );
  });
});
