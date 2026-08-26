import { describe, expect, it } from "vitest";
import { analyzeBeam } from "../src/engine/analyze";
import { BeamModel } from "../src/engine/types";
import {
  PROJECT_KIND,
  SCHEMA_VERSION,
  buildProject,
  loadProject,
  safeFileName,
  serializeProject,
} from "../src/export/project";
import {
  csvNumber,
  diagramRows,
  diagramsCsv,
  modelCsv,
  reactionsCsv,
  serviceabilityCsv,
  summaryCsv,
  toCsv,
} from "../src/export/tables";

const span = (id: string, length: number) => ({ id, length, E: 200, I: 2e-4 });

const model: BeamModel = {
  version: "1.0",
  spans: [span("s1", 6), span("s2", 6), span("s3", 2)],
  supports: [
    { at: 0, type: "fixed" },
    { at: 6, type: "roller" },
    { at: 12, type: "roller" },
  ],
  loads: [
    { type: "udl", from: 0, to: 12, w: -15 },
    { type: "point", at: 9, magnitude: -40 },
    { type: "moment", at: 6, magnitude: 20 },
    { type: "linear", from: 12, to: 14, w1: -20, w2: 0 },
  ],
};

const analysis = analyzeBeam(model);
const lines = (csv: string): string[] => csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");

describe("بناء CSV", () => {
  it("يبدأ بعلامة BOM وينتهي أسطره بـ CRLF", () => {
    const csv = toCsv([["أ", "ب"], [1, 2]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv.includes("\n\n")).toBe(false);
  });

  it("يُحيط بعلامات تنصيص الحقول التي تحتوي الفاصل أو تنصيصاً أو سطراً جديداً", () => {
    expect(toCsv([["a,b"]])).toContain('"a,b"');
    expect(toCsv([['قال "نعم"']])).toContain('"قال ""نعم"""');
    expect(toCsv([["سطر\nثانٍ"]])).toContain('"سطر\nثانٍ"');
    // مع الفاصلة المنقوطة، الفاصلة لم تعد تحتاج تنصيصاً
    expect(toCsv([["a,b"]], ";")).not.toContain('"');
  });

  it("csvNumber يُنتج أرقاماً لاتينية بلا فاصل آلاف و−0 يصير 0", () => {
    expect(csvNumber(1234567.891, 2)).toBe("1234567.89");
    expect(csvNumber(-0)).toBe("0");
    expect(csvNumber(Number.NaN)).toBe("");
    expect(csvNumber(Number.POSITIVE_INFINITY)).toBe("");
    expect(csvNumber(1e-7, 4)).toBe("0");
  });

  it("الفاصل المختار يُستخدم فعلاً في كل الأعمدة", () => {
    const csv = reactionsCsv(analysis, { delimiter: ";" });
    expect(lines(csv)[0].split(";")).toHaveLength(5);
    const tab = reactionsCsv(analysis, { delimiter: "\t" });
    expect(lines(tab)[0].split("\t")).toHaveLength(5);
  });
});

describe("جدول المنحنيات", () => {
  it("يغطي الكمرة من صفر إلى الطول الكلي ومرتَّب", () => {
    const rows = diagramRows(analysis, { step: 0.25 });
    expect(rows[0].x).toBeCloseTo(0, 12);
    expect(rows[rows.length - 1].x).toBeCloseTo(14, 12);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].x).toBeGreaterThanOrEqual(rows[i - 1].x - 1e-12);
    }
  });

  it("يُصدر صفّين مُميَّزين عند الحمل المركز — الانفصال لا يُطمس", () => {
    const at9 = diagramRows(analysis, { step: 0.25 }).filter((r) => Math.abs(r.x - 9) < 1e-9);
    expect(at9).toHaveLength(2);
    expect(at9[0].side).toBe("يسار");
    expect(at9[1].side).toBe("يمين");
    expect(at9[1].V - at9[0].V).toBeCloseTo(-40, 6);
    // العزم مستمر عند الحمل المركز
    expect(at9[0].M).toBeCloseTo(at9[1].M, 6);
  });

  it("العزم المركز يُنتج وثبة قدرها −M في عمود العزم", () => {
    const at6 = diagramRows(analysis, { step: 0.25 }).filter((r) => Math.abs(r.x - 6) < 1e-9);
    expect(at6).toHaveLength(2);
    // وثبة العزم = −(العزم المسلَّط + رد الفعل العزمي) وعندها أيضاً رد فعل رأسي
    expect(at6[1].M - at6[0].M).toBeCloseTo(-20, 5);
  });

  it("المواضع الحرجة مُدرجة ولو لم تقع على الشبكة", () => {
    const rows = diagramRows(analysis, { step: 0.5 });
    const xMaxM = analysis.diagrams.extrema.maxM.x;
    expect(rows.some((r) => Math.abs(r.x - xMaxM) < 1e-6)).toBe(true);
    for (const z of analysis.diagrams.momentZeros) {
      expect(rows.some((r) => Math.abs(r.x - z) < 1e-6)).toBe(true);
    }
  });

  it("تخفيف الخطوة يُقلّل الصفوف ولا يُسقط النقاط الحرجة", () => {
    const coarse = diagramRows(analysis, { step: 1 });
    const fine = diagramRows(analysis, { step: 0.05 });
    expect(coarse.length).toBeLessThan(fine.length);
    const xMaxM = analysis.diagrams.extrema.maxM.x;
    expect(coarse.some((r) => Math.abs(r.x - xMaxM) < 1e-6)).toBe(true);
  });

  it("لا NaN ولا حقول فارغة في الجدول", () => {
    const csv = diagramsCsv(analysis, { step: 0.5 });
    expect(csv).not.toContain("NaN");
    expect(csv).not.toContain("Infinity");
    expect(csv).not.toContain("undefined");
  });
});

describe("جداول الردود والملخص والنموذج", () => {
  it("مجموع الردود في CSV يطابق مجموع الأحمال", () => {
    const rows = lines(reactionsCsv(analysis));
    const last = rows[rows.length - 1].split(",");
    expect(last[0]).toBe("المجموع");
    // 15×12 + 40 + حمل مثلثي 20×2/2 = 180 + 40 + 20
    expect(Number(last[2])).toBeCloseTo(240, 4);
  });

  it("الملخص يحمل الفحوص الست والحصيلة", () => {
    const csv = summaryCsv(analysis);
    for (const key of [
      "توازن القوى الرأسية",
      "توازن العزوم",
      "استمرارية المنحنيات",
      "تناسق تكامل M/EI",
      "متبقي حل النظام",
      "تقدير سوء التكييف",
      "الحصيلة",
    ]) {
      expect(csv).toContain(key);
    }
    expect(csv).toContain("كل الفحوص مُجتازة");
  });

  it("قابلية الخدمة تُصدِّر قطاعاً لكل مدى بين المساند وللكابولي", () => {
    const rows = lines(serviceabilityCsv(analysis, 360));
    expect(rows).toHaveLength(analysis.deflection.segments.length + 1);
    expect(rows[0]).toContain("L/360");
    expect(serviceabilityCsv(analysis, 360)).toMatch(/كابولي/);
  });

  it("وصف النموذج يشمل كل بحر ومسند وحمل", () => {
    const csv = modelCsv(model);
    for (const s of model.spans) expect(csv).toContain(s.id);
    expect(csv.match(/^مسند/gm) ?? []).toHaveLength(model.supports.length);
    expect(csv.match(/^حمل/gm) ?? []).toHaveLength(model.loads.length);
  });
});

describe("ملف المشروع", () => {
  it("رحلة ذهاب وعودة تحفظ النموذج والعرض", () => {
    const view = { tensionSide: false, deflectionLimit: 250 };
    const text = serializeProject(buildProject(model, view, "كمرة الاختبار"));
    const r = loadProject(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bare).toBe(false);
    expect(r.project.name).toBe("كمرة الاختبار");
    expect(r.project.view).toEqual(view);
    expect(r.project.model.spans).toHaveLength(3);
    expect(r.project.model.loads).toHaveLength(4);
    expect(r.project.kind).toBe(PROJECT_KIND);
  });

  it("يقبل النموذج العاري ويُعلّمه bare — توافق مع النسخ الأولى", () => {
    const r = loadProject(JSON.stringify(model));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bare).toBe(true);
    expect(r.project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.project.view).toEqual({ tensionSide: true, deflectionLimit: 360 });
  });

  it("يرفض إصداراً أحدث برسالة صريحة لا بمحاولة تفسير", () => {
    const p = buildProject(model, { tensionSide: true, deflectionLimit: 360 });
    const r = loadProject(JSON.stringify({ ...p, schemaVersion: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("VERSION");
      expect(r.message).toContain("99");
    }
  });

  it("يرفض ملفاً غريباً وملفاً بجذر مصفوفة و JSON تالفاً", () => {
    for (const bad of ['{"foo":1}', "[]", "{ not json"]) {
      const r = loadProject(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(["SCHEMA", "JSON"]).toContain(r.code);
    }
  });

  it("يرفض ملفاً سليم الشكل ونموذجه مرفوض — لا يُحمَّل ليفشل بعد الفتح", () => {
    const broken = {
      kind: PROJECT_KIND,
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      app: "x",
      model: { spans: [span("s1", 6)], supports: [{ at: 0, type: "roller" }], loads: [] },
    };
    const r = loadProject(JSON.stringify(broken));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("مرفوض");
      expect(/[\u0600-\u06FF]/.test(r.message)).toBe(true);
    }
  });

  it("قيم العرض التالفة تُستبدل بالافتراضي ولا تُوثَق بها", () => {
    const p = {
      kind: PROJECT_KIND,
      schemaVersion: 1,
      savedAt: "غير صالح",
      app: "x",
      model,
      view: { tensionSide: "نعم", deflectionLimit: -5 },
    };
    const r = loadProject(JSON.stringify(p));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.view).toEqual({ tensionSide: true, deflectionLimit: 360 });
  });

  it("الملف المحفوظ نص JSON صالح وقابل لإعادة القراءة", () => {
    const text = serializeProject(buildProject(model, { tensionSide: true, deflectionLimit: 360 }));
    expect(() => JSON.parse(text)).not.toThrow();
    expect(loadProject(loadProject(text).ok ? text : "{}").ok).toBe(true);
  });
});

describe("أسماء الملفات", () => {
  it("يُنقّي المحارف الممنوعة ويُضيف طابعاً زمنياً", () => {
    const name = safeFileName('كمرة/تجربة:رقم*1?"<>|', "csv");
    expect(name).toMatch(/\.csv$/);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("الاسم الفارغ يصير «كمرة»، والطويل يُقتطع", () => {
    expect(safeFileName("   ", "json").startsWith("كمرة_")).toBe(true);
    const long = safeFileName("ك".repeat(300), "png");
    expect(long.length).toBeLessThan(120);
  });
});
