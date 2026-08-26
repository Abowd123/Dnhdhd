// analyze.ts — نقطة الدخول الوحيدة للمحرك: نموذج → حل + منحنيات + ترخيم + فحوص.
//
// الواجهة لا تستورد solveBeam ولا buildDiagrams مباشرة، بل تمرّ من هنا. الفائدة
// المباشرة أن نوع نتيجة التحليل معرَّف في مكان واحد، فلا تحتاج المكوّنات إلى
// استنتاج أنواعها من ReturnType — وهو ما كان يُنتج شكلاً ملتوياً في App.tsx.

import {
  BeamDeflection,
  buildDeflection,
  evaluateDeflectionAt,
} from "./deflection";
import { BeamError, BeamErrorCode } from "./errors";
import { BeamDiagrams, buildDiagrams, evaluateAt } from "./internalForces";
import { BeamSolution, solveBeam } from "./solver";
import { BeamModel } from "./types";

/**
 * عينات مخفَّفة أثناء السحب. القيم القصوى ومواقعها تُحسب تحليلياً من جذور
 * متعددات الحدود، فتخفيف الكثافة يُخشِّن الرسم فقط ولا يمسّ أي رقم معروض.
 */
export const INTERACTIVE_SAMPLES = 12;
export const DEFAULT_SAMPLES = 40;

/** حصيلة الفحوص المستقلة الأربعة في مكان واحد */
export interface AnalysisHealth {
  /** خطأ توازن القوى الرأسية النسبي */
  equilibriumFy: number;
  /** خطأ توازن العزوم النسبي */
  equilibriumMz: number;
  /** خطأ وثبات V و M عند العقد */
  continuity: number;
  /** خطأ تطابق تكامل M/EI مع درجات الحرية المحلولة */
  deflectionConsistency: number;
  /** ‖Kd − F‖ النسبي */
  solveResidual: number;
  /** maxPivot / minPivot — تقدير خشن لسوء التكييف */
  conditionHint: number;
  /** أسوأ الأخطاء أعلاه — رقم واحد للعرض السريع */
  worst: number;
  ok: boolean;
}

export interface BeamAnalysis {
  model: BeamModel;
  solution: BeamSolution;
  diagrams: BeamDiagrams;
  deflection: BeamDeflection;
  health: AnalysisHealth;
}

export interface AnalyzeOptions {
  samplesPerElement?: number;
  /** يستخدم INTERACTIVE_SAMPLES ويتجاهل samplesPerElement */
  interactive?: boolean;
  /** الطول المرجعي للكابولي في نسبة L/δ — الافتراضي 2 */
  cantileverFactor?: number;
}

/** يرمي BeamError عند أي مُدخل مرفوض أو فحص فاشل */
export function analyzeBeam(model: BeamModel, opts: AnalyzeOptions = {}): BeamAnalysis {
  const samplesPerElement = opts.interactive
    ? INTERACTIVE_SAMPLES
    : (opts.samplesPerElement ?? DEFAULT_SAMPLES);

  const solution = solveBeam(model);
  const diagrams = buildDiagrams(solution, { samplesPerElement });
  const deflection = buildDeflection(solution, diagrams, {
    samplesPerElement,
    cantileverFactor: opts.cantileverFactor,
  });

  const health = summarizeHealth(solution, diagrams, deflection);
  return { model, solution, diagrams, deflection, health };
}

function summarizeHealth(
  solution: BeamSolution,
  diagrams: BeamDiagrams,
  deflection: BeamDeflection
): AnalysisHealth {
  const eq = solution.equilibrium;
  const worst = Math.max(
    eq.relativeFy,
    eq.relativeMz,
    eq.solveResidual,
    diagrams.continuity.maxError,
    deflection.consistency.maxError
  );
  return {
    equilibriumFy: eq.relativeFy,
    equilibriumMz: eq.relativeMz,
    continuity: diagrams.continuity.maxError,
    deflectionConsistency: deflection.consistency.maxError,
    solveResidual: eq.solveResidual,
    conditionHint: eq.conditionHint,
    worst,
    ok: eq.ok && diagrams.continuity.ok && deflection.consistency.ok && eq.solveResidual <= 1e-8,
  };
}

export type AnalysisFailureCode = BeamErrorCode | "JSON" | "UNKNOWN";

export type AnalysisResult =
  | { ok: true; analysis: BeamAnalysis }
  | { ok: false; code: AnalysisFailureCode; message: string; details?: Record<string, unknown> };

/**
 * نسخة لا ترمي أبداً — للاستخدام في الواجهة حيث كل ضغطة مفتاح تعيد التحليل.
 * يقبل نموذجاً أو نصاً بصيغة JSON.
 */
export function tryAnalyzeBeam(
  input: BeamModel | string,
  opts: AnalyzeOptions = {}
): AnalysisResult {
  let model: BeamModel;
  if (typeof input === "string") {
    try {
      model = JSON.parse(input) as BeamModel;
    } catch (e) {
      return {
        ok: false,
        code: "JSON",
        message: `ملف JSON غير صالح: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (model === null || typeof model !== "object" || Array.isArray(model)) {
      return { ok: false, code: "JSON", message: "الجذر في ملف JSON يجب أن يكون كائناً." };
    }
  } else {
    model = input;
  }

  try {
    return { ok: true, analysis: analyzeBeam(model, opts) };
  } catch (e) {
    if (e instanceof BeamError) {
      return { ok: false, code: e.code, message: e.message, details: e.details };
    }
    return { ok: false, code: "UNKNOWN", message: e instanceof Error ? e.message : String(e) };
  }
}

export interface CombinedQuery {
  x: number;
  V: { left: number; right: number };
  M: { left: number; right: number };
  /** متر — لأسفل سالب. الترخيم مستمر دائماً */
  v: number;
  /** راديان — ينفصل عند المفصل الداخلي فقط */
  theta: { left: number; right: number };
  /** انفصال في V أو M: حمل مركز أو عزم مركز أو رد فعل */
  forceJump: boolean;
  /** انفصال في الميل: مفصل داخلي */
  thetaJump: boolean;
}

/** استعلام نقطي موحَّد — ما يحتاجه المؤشر المتزامن في مكالمة واحدة */
export function queryAt(analysis: BeamAnalysis, x: number): CombinedQuery {
  const f = evaluateAt(analysis.diagrams, x);
  const g = evaluateDeflectionAt(analysis.deflection, x);
  return {
    x: g.x,
    V: f.V,
    M: f.M,
    v: g.v,
    theta: g.theta,
    forceJump: f.discontinuous,
    thetaJump: g.thetaJump,
  };
}

export { evaluateAt, evaluateDeflectionAt };
export type { BeamDeflection, BeamDiagrams, BeamSolution };
