// errors.ts — أخطاء صريحة بالعربية.
// القاعدة الحاكمة للمشروع: إما أن نحسب النتيجة صحيحة، أو نرفض الحل.
// لا يُسمح بتجاهل أي مُدخل بصمت (لا continue، لا قيمة افتراضية مُخفية).

export type BeamErrorCode =
  | "SPAN_INVALID"
  | "SPAN_DUPLICATE_ID"
  | "SUPPORT_INVALID"
  | "SUPPORT_OUT_OF_RANGE"
  | "SUPPORT_DUPLICATE"
  | "SPRING_INVALID"
  | "HINGE_OUT_OF_RANGE"
  | "HINGE_DUPLICATE"
  | "HINGE_CONFLICT"
  | "LOAD_INVALID"
  | "LOAD_OUT_OF_RANGE"
  | "UNSTABLE"
  | "EQUILIBRIUM"
  | "NOT_IMPLEMENTED"
  | "INTERNAL";

export class BeamError extends Error {
  readonly code: BeamErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: BeamErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BeamError";
    this.code = code;
    this.details = details;
  }
}

export function fail(
  code: BeamErrorCode,
  message: string,
  details?: Record<string, unknown>
): never {
  throw new BeamError(code, message, details);
}

/** لميزة معروفة لكنها غير منفَّذة بعد — نرفض ولا نُرجع رقماً خاطئاً */
export function notImplemented(feature: string): never {
  throw new BeamError(
    "NOT_IMPLEMENTED",
    `الميزة غير مدعومة بعد: ${feature}. أُوقف الحل بدلاً من إرجاع نتيجة خاطئة.`,
    { feature }
  );
}

/** خلل داخلي في المحرك (لا يُتوقع حدوثه بمُدخلات صحيحة) */
export function internal(message: string, details?: Record<string, unknown>): never {
  throw new BeamError("INTERNAL", `خلل داخلي في المحرك: ${message}`, details);
}
