// ar.ts — كل النصوص العربية في ملف واحد.
// السبب: توحيد المصطلح الهندسي عبر الواجهة كلها، ومنع اختلاف الترجمة بين
// مكوّن وآخر. أي مصطلح جديد يُضاف هنا أولاً ثم يُستهلك، لا العكس.

export const ar = {
  app: {
    title: "أداة تحليل الكمرات — قوى القص وعزوم الانحناء",
    subtitle: "المرحلة 7: لوحة إدخال عربية ورسم تفاعلي للكمرة",
    disclaimer:
      "هذه الأداة للتحليل والتعلم. حدود الترخيم المعروضة للمقارنة البصرية فقط ولا تُغني عن " +
      "الكود المعمول به. أي نتيجة تُستخدم في تصميم فعلي تحتاج تحققاً مستقلاً من مهندس مسؤول.",
  },

  units: {
    length: "م",
    force: "kN",
    moment: "kN·m",
    distributed: "kN/m",
    modulus: "GPa",
    inertia: "m⁴",
    springStiffness: "kN/m",
    mm: "مم",
    mrad: "مِلّي‑راديان",
  },

  support: {
    fixed: "تثبيت تام",
    pinned: "مسند مفصلي",
    roller: "مسند متحرك",
    spring: "مسند مرن (نابض)",
  },

  supportShort: {
    fixed: "تثبيت",
    pinned: "مفصلي",
    roller: "متحرك",
    spring: "نابض",
  },

  load: {
    point: "حمل مركز",
    moment: "عزم مركز",
    udl: "حمل موزع منتظم",
    linear: "حمل موزع متغير خطياً",
  },

  fields: {
    position: "الموضع",
    length: "الطول",
    modulus: "معامل المرونة E",
    inertia: "عزم القصور I",
    supportType: "نوع المسند",
    springStiffness: "جساءة النابض",
    settlement: "الهبوط",
    magnitude: "القيمة",
    from: "من",
    to: "إلى",
    intensity: "الشدة",
    intensityStart: "الشدة عند البداية",
    intensityEnd: "الشدة عند النهاية",
    loadKind: "نوع الحمل",
  },

  sections: {
    spans: "البحور",
    supports: "المساند",
    hinges: "المفاصل الداخلية",
    loads: "الأحمال",
    json: "النموذج بصيغة JSON",
    glossary: "مسرد المصطلحات",
    display: "خيارات العرض",
  },

  actions: {
    add: "إضافة",
    remove: "حذف",
    undo: "تراجع",
    redo: "إعادة",
    reset: "إعادة تعيين",
    apply: "تطبيق",
    dismiss: "إغلاق",
    tensionSide: "رسم العزوم على جهة الشد",
    deflectionLimit: "حد الترخيم",
  },

  canvas: {
    title: "الكمرة",
    hint:
      "اسحب المساند والأحمال والمفاصل بالفأرة أو باللمس. المربّعان على طرفَي الحمل الموزع " +
      "يغيّران مداه. Alt أثناء السحب يُعطّل الالتقاط، و Esc يُلغي السحب. للوحة المفاتيح: " +
      "Tab للتنقل ثم الأسهم للإزاحة بمقدار 0.25 م — وكل موضع قابل للكتابة رقمياً في لوحة الإدخال.",
    beamAxis: "محور الكمرة",
    dimensions: "أطوال البحور",
  },

  shortcuts: {
    title: "اختصارات لوحة المفاتيح",
    rows: [
      ["Ctrl/⌘ + Z", "تراجع"],
      ["Ctrl/⌘ + Shift + Z", "إعادة"],
      ["Tab", "التنقل بين عناصر الكمرة"],
      ["→ ←", "إزاحة العنصر المحدَّد 0.25 م"],
      ["Delete", "حذف العنصر المحدَّد"],
      ["Esc", "إلغاء السحب أو إلغاء التحديد"],
      ["Alt (أثناء السحب)", "تعطيل الالتقاط المغناطيسي"],
    ] as const,
  },

  results: {
    reactions: "ردود الأفعال",
    maxima: "القيم القصوى",
    serviceability: "الترخيم لكل قطاع",
    healthOk: "فحوص السلامة: مُجتازة",
    healthWarn: "فحوص السلامة: تحذير",
    sfd: "مخطط قوى القص — SFD",
    bmd: "مخطط عزوم الانحناء — BMD",
    deflection: "منحنى الترخيم",
  },

  /** يُعرض في لوحة قابلة للطي — يوثّق المصطلح مقابل مقابله الإنجليزي */
  glossary: [
    ["قوة القص", "Shear Force"],
    ["عزم الانحناء", "Bending Moment"],
    ["الترخيم", "Deflection"],
    ["الميل", "Slope / Rotation"],
    ["مسند مفصلي", "Pinned Support"],
    ["مسند متحرك (بكرة)", "Roller Support"],
    ["تثبيت تام", "Fixed Support"],
    ["مسند مرن (نابض)", "Spring Support"],
    ["حمل مركز", "Point Load"],
    ["حمل موزع منتظم", "Uniformly Distributed Load"],
    ["حمل موزع متغير خطياً", "Linearly Varying Load"],
    ["عزم مركز", "Applied Moment"],
    ["مفصل داخلي", "Internal Hinge"],
    ["كابولي", "Cantilever / Overhang"],
    ["بحر", "Span"],
    ["رد الفعل", "Reaction"],
    ["هبوط المسند", "Support Settlement"],
    ["نقطة انعدام العزم", "Inflection Point"],
    ["قابلية الخدمة", "Serviceability"],
  ] as const,
};

export type SupportTypeKey = keyof typeof ar.support;
export type LoadKindKey = keyof typeof ar.load;
