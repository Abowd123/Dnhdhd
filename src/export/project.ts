// project.ts — صيغة ملف المشروع: الحفظ والتحميل والترقية.
//
// الصيغة مُغلَّفة لا نموذجاً عارياً: الغلاف يحمل رقم إصدار المخطط، فتغييرُ
// بنية النموذج مستقبلاً يبقى قابلاً للترقية بلا كسر ملفات المستخدمين. مع ذلك
// نقبل النموذج العاري أيضاً لأن مراحل المشروع الأولى أنتجت ملفات بهذا الشكل،
// وكسرها بلا سبب عبثٌ.
//
// التحميل لا يكتفي بفحص الشكل بل يُشغّل المحرك كاملاً على النموذج قبل قبوله:
// ملف يُحمَّل ثم يُنتج شاشة خطأ أسوأ من ملف يُرفض برسالة واضحة عند فتحه.

import { AnalysisFailureCode, tryAnalyzeBeam } from "../engine/analyze";
import { BeamModel } from "../engine/types";

export const PROJECT_KIND = "beam-analysis-project";
export const SCHEMA_VERSION = 1;

export interface ProjectView {
  tensionSide: boolean;
  deflectionLimit: number;
}

export interface ProjectFile {
  kind: typeof PROJECT_KIND;
  schemaVersion: number;
  /** ISO 8601 */
  savedAt: string;
  app: string;
  /** اسم اختياري يُدخله المستخدم */
  name?: string;
  model: BeamModel;
  view?: ProjectView;
}

export type LoadResult =
  | { ok: true; project: ProjectFile; /** true إذا كان المصدر نموذجاً عارياً */ bare: boolean }
  | { ok: false; code: AnalysisFailureCode | "SCHEMA" | "VERSION"; message: string };

export const defaultView: ProjectView = { tensionSide: true, deflectionLimit: 360 };

export function buildProject(model: BeamModel, view: ProjectView, name?: string): ProjectFile {
  return {
    kind: PROJECT_KIND,
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    app: "أداة تحليل الكمرات",
    ...(name && name.trim() !== "" ? { name: name.trim() } : {}),
    model,
    view,
  };
}

export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(project, null, 2);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** يتحقق من قيم العرض ويُسقط ما لا يُفهم منها بدل الوثوق بالملف */
function sanitizeView(raw: unknown): ProjectView {
  if (!isRecord(raw)) return { ...defaultView };
  const limit = Number(raw.deflectionLimit);
  return {
    tensionSide: typeof raw.tensionSide === "boolean" ? raw.tensionSide : defaultView.tensionSide,
    deflectionLimit:
      Number.isFinite(limit) && limit > 0 && limit <= 10000 ? limit : defaultView.deflectionLimit,
  };
}

/**
 * يقبل: ملف مشروع مُغلَّف، أو نموذج كمرة عارياً (توافق مع المراحل الأولى).
 * يرفض: أي شيء آخر، وأي نموذج لا يجتاز المحرك.
 */
export function loadProject(input: string | unknown): LoadResult {
  let raw: unknown;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return {
        ok: false,
        code: "JSON",
        message: `الملف ليس JSON صالحاً: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  } else {
    raw = input;
  }

  if (!isRecord(raw)) {
    return { ok: false, code: "SCHEMA", message: "جذر الملف يجب أن يكون كائناً." };
  }

  const wrapped = raw.kind === PROJECT_KIND;
  const bare = !wrapped && Array.isArray(raw.spans);

  if (!wrapped && !bare) {
    return {
      ok: false,
      code: "SCHEMA",
      message:
        "الملف لا يبدو مشروع كمرة: لا يحمل العلامة \u200f«" +
        PROJECT_KIND +
        "»\u200f ولا يحتوي قائمة بحور.",
    };
  }

  if (wrapped) {
    const version = Number(raw.schemaVersion);
    if (!Number.isFinite(version) || version < 1) {
      return { ok: false, code: "SCHEMA", message: "رقم إصدار المخطط في الملف مفقود أو غير صالح." };
    }
    if (version > SCHEMA_VERSION) {
      return {
        ok: false,
        code: "VERSION",
        message:
          `الملف محفوظ بإصدار مخطط ${version} وهذه النسخة تفهم حتى ${SCHEMA_VERSION}. ` +
          `حدِّث الأداة أو احفظ الملف من نسخة أحدث بصيغة أقدم.`,
      };
    }
  }

  const modelRaw = wrapped ? raw.model : raw;
  const analysis = tryAnalyzeBeam(modelRaw as BeamModel);
  if (!analysis.ok) {
    return {
      ok: false,
      code: analysis.code,
      message: `الملف قُرئ لكن النموذج فيه مرفوض: ${analysis.message}`,
    };
  }

  const model = analysis.analysis.model;
  const view = sanitizeView(wrapped ? raw.view : undefined);
  const savedAt = typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString();
  const name = typeof raw.name === "string" ? raw.name : undefined;

  return {
    ok: true,
    bare,
    project: {
      kind: PROJECT_KIND,
      schemaVersion: SCHEMA_VERSION,
      savedAt,
      app: typeof raw.app === "string" ? raw.app : "أداة تحليل الكمرات",
      ...(name ? { name } : {}),
      model,
      view,
    },
  };
}

/** اسم ملف آمن على كل نظام، بلا محارف ممنوعة ولا فراغات طرفية */
export function safeFileName(base: string, extension: string): string {
  const cleaned = base
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  return `${cleaned === "" ? "كمرة" : cleaned}_${stamp}.${extension}`;
}
