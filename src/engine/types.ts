// types.ts — نموذج البيانات للمحرك
//
// اصطلاحات الوحدات والإشارات (ثابتة في كل المشروع):
//   الأطوال: متر (m)
//   القوى: كيلونيوتن (kN) — لأسفل سالب
//   العزوم: kN·m — عكس عقارب الساعة موجب
//   معامل المرونة E: جيجاباسكال (GPa)   [1 GPa = 1e6 kN/m²]
//   عزم القصور I: m⁴
//   الترخيم: متر — لأسفل سالب
//
// ملاحظة: في تحليل الكمرات (انحناء فقط، بلا قوى محورية) لا فرق حسابي بين
// المسند المفصلي والمتحرك؛ الفرق محوري وخارج نطاق هذه الأداة. نُبقي النوعين
// للتمثيل البصري ولوضوح المخرجات.

export type SupportType = "fixed" | "pinned" | "roller" | "spring";

/** بحر = منطقة جساءة ثابتة. المساند حرة الموضع ولا يلزم أن تكون على حدود البحور. */
export interface SpanDef {
  id: string;
  length: number; // m
  E: number; // GPa
  I: number; // m⁴
}

export interface SupportDef {
  at: number; // الموضع على طول الكمرة الكلي (m)
  type: SupportType;
  springStiffness?: number; // kN/m — إلزامي عندما type === "spring"
  settlement?: number; // m — هبوط مفروض، لأسفل سالب
}

export interface HingeDef {
  at: number; // مفصل داخلي — يجب أن يكون داخل الكمرة بشكل صريح
}

export interface PointLoad {
  type: "point";
  at: number;
  magnitude: number; // kN — لأسفل سالب
}

export interface AppliedMoment {
  type: "moment";
  at: number;
  magnitude: number; // kN·m — عكس عقارب الساعة موجب
}

export interface UDL {
  type: "udl";
  from: number;
  to: number;
  w: number; // kN/m منتظم — لأسفل سالب
}

export interface LinearLoad {
  type: "linear";
  from: number;
  to: number;
  w1: number; // kN/m عند from
  w2: number; // kN/m عند to
}

export type DistributedLoad = UDL | LinearLoad;
export type LoadDef = PointLoad | AppliedMoment | UDL | LinearLoad;

export interface BeamModel {
  version?: string;
  spans: SpanDef[];
  supports: SupportDef[];
  hinges?: HingeDef[];
  loads: LoadDef[];
}

// ————— النموذج بعد التقطيع —————

export interface BeamNode {
  index: number;
  x: number; // m
  support?: SupportDef;
  hinge: boolean;
  /** مجموع الأحمال المركزة عند هذه العقدة (kN) */
  P: number;
  /** مجموع العزوم المركزة عند هذه العقدة (kN·m) */
  M: number;
}

export interface BeamElement {
  index: number;
  nodeStart: number;
  nodeEnd: number;
  x0: number;
  x1: number;
  L: number;
  /** kN·m² — محسوبة كـ E(GPa) × 1e6 × I(m⁴) */
  EI: number;
  spanId: string;
  /** الحمل الموزع المتراكم عند بداية العنصر (kN/m) */
  w1: number;
  /** الحمل الموزع المتراكم عند نهاية العنصر (kN/m) */
  w2: number;
}

/**
 * خريطة درجات الحرية — كائن مستقل من اليوم الأول.
 * السبب: المفصل الداخلي يضيف درجة دوران ثانية عند العقدة، فلا يصلح
 * الترقيم الضمني node*2+i. أي ترقيم ضمني سيتحطم عند إضافة المفاصل.
 *
 * ترتيب الترقيم: لكل عقدة بالتسلسل → الإزاحة الرأسية ثم درجة/درجات الدوران.
 * هذا يُنتج مصفوفة صلابة نطاقية (banded) تحسّن الاستقرار العددي.
 */
export interface DofMap {
  nDof: number;
  /** فهرس درجة الإزاحة الرأسية لكل عقدة */
  verticalOf: number[];
  /** درجات الدوران لكل عقدة: واحدة عادةً، اثنتان عند مفصل داخلي */
  rotationsOf: number[][];
  /** لكل عنصر: [v_i, θ_i, v_j, θ_j] بالفهارس العامة */
  elementDofs: number[][];
  /** درجات مقيَّدة بقيمة مفروضة (0 عادةً، أو الهبوط) */
  prescribed: Map<number, number>;
  /** درجات مرتبطة بنابض: dof → جساءة kN/m */
  springs: Map<number, number>;
  /** أسماء وصفية للتشخيص ورسائل الخطأ */
  labels: string[];
}

export interface DiscretizedBeam {
  totalLength: number;
  nodes: BeamNode[];
  elements: BeamElement[];
  dofMap: DofMap;
}

/** تفاوت هندسي موحَّد: 1 ميكرومتر — لدمج المواضع المتقاربة */
export const GEOM_TOL = 1e-6;
