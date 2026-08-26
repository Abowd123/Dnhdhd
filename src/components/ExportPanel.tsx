// ExportPanel.tsx — لوحة التصدير والحفظ والتحميل.
//
// قرار PDF: نستخدم طباعة المتصفح مع ورقة أنماط مخصّصة، لا مكتبة توليد PDF.
// السبب تقني لا تفضيلي: مكتبات مثل jsPDF لا تُشكّل العربية — تحتاج تضمين خط
// عربي كامل ومكتبة تشكيل (bidi + ligatures) وإلا خرجت الحروف منفصلة ومقلوبة
// الترتيب. محرّك نصوص المتصفح يفعل هذا صحيحاً بالفعل، ويُنتج PDF متجهياً قابلاً
// للبحث عبر «طباعة إلى PDF» المتاحة في كل نظام. الكلفة أن المستخدم يمرّ بحوار
// الطباعة، والمقابل تقرير عربي صحيح فعلاً.

import { useRef, useState } from "react";
import { BeamAnalysis } from "../engine/analyze";
import { BeamModel } from "../engine/types";
import {
  diagramsCsv,
  modelCsv,
  reactionsCsv,
  serviceabilityCsv,
  summaryCsv,
  type Delimiter,
} from "../export/tables";
import {
  ProjectView,
  buildProject,
  loadProject,
  safeFileName,
  serializeProject,
} from "../export/project";
import {
  download,
  downloadText,
  findExportSvg,
  stackSvgs,
  svgToBlob,
  svgToPngBlob,
} from "../export/raster";

interface Props {
  model: BeamModel;
  analysis: BeamAnalysis | null;
  view: ProjectView;
  projectName: string;
  onProjectNameChange(name: string): void;
  onLoad(model: BeamModel, view: ProjectView, message: string): void;
  onError(message: string): void;
}

const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ",", label: "فاصلة (,)" },
  { value: ";", label: "فاصلة منقوطة (;)" },
  { value: "\t", label: "جدولة (Tab)" },
];

const STEPS = [0.05, 0.1, 0.25, 0.5];

function Btn({
  onClick,
  disabled,
  children,
  title,
}: {
  onClick(): void;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded border px-2 py-1 text-xs disabled:opacity-40 enabled:hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

export default function ExportPanel({
  model,
  analysis,
  view,
  projectName,
  onProjectNameChange,
  onLoad,
  onError,
}: Props) {
  const [delimiter, setDelimiter] = useState<Delimiter>(",");
  const [step, setStep] = useState(0.1);
  const [scale, setScale] = useState(2);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const base = projectName.trim() === "" ? "كمرة" : projectName;

  const csv = (build: (a: BeamAnalysis) => string, suffix: string) => {
    if (!analysis) return;
    downloadText(build(analysis), safeFileName(`${base}-${suffix}`, "csv"), "text/csv");
  };

  const svgOf = (id: string): SVGSVGElement | null => {
    const el = findExportSvg(id);
    if (!el) onError(`تعذّر إيجاد الرسم «${id}» في الصفحة. تأكد من ظهوره قبل التصدير.`);
    return el;
  };

  const exportPng = async (id: string, suffix: string) => {
    const el = svgOf(id);
    if (!el) return;
    try {
      const blob = await svgToPngBlob(el, { scale });
      download(blob, safeFileName(`${base}-${suffix}`, "png"));
    } catch (e) {
      onError(e instanceof Error ? e.message : "فشل تصدير PNG.");
    }
  };

  const exportSvg = (id: string, suffix: string) => {
    const el = svgOf(id);
    if (!el) return;
    download(svgToBlob(el), safeFileName(`${base}-${suffix}`, "svg"));
  };

  const exportAllSvg = () => {
    const ids = ["beam", "sfd", "bmd", "deflection"];
    const els = ids.map(findExportSvg).filter((e): e is SVGSVGElement => e !== null);
    if (els.length === 0) {
      onError("لا توجد رسوم قابلة للتصدير حالياً.");
      return;
    }
    download(stackSvgs(els), safeFileName(`${base}-الرسوم`, "svg"));
  };

  const saveProject = () => {
    const text = serializeProject(buildProject(model, view, projectName));
    downloadText(text, safeFileName(base, "json"), "application/json");
  };

  const openFile = async (file: File) => {
    try {
      const text = await file.text();
      const r = loadProject(text);
      if (!r.ok) {
        onError(`[${r.code}] ${r.message}`);
        return;
      }
      const name = r.project.name ?? file.name.replace(/\.json$/i, "");
      onProjectNameChange(name);
      onLoad(
        r.project.model,
        r.project.view ?? view,
        r.bare
          ? `حُمّل نموذج بالصيغة القديمة (نموذج عارٍ) من «${file.name}» وتُرقّي عند الحفظ.`
          : `حُمّل المشروع «${name}» المحفوظ في ${new Date(r.project.savedAt).toLocaleString(
              "ar-u-nu-latn"
            )}.`
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "تعذّر قراءة الملف.");
    }
  };

  return (
    <details className="mt-3 rounded border bg-white p-3 text-sm">
      <summary className="cursor-pointer font-semibold">التصدير والحفظ</summary>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="project-name" className="block text-xs text-slate-600">
            اسم المشروع (يُستخدم في أسماء الملفات)
          </label>
          <input
            id="project-name"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
            placeholder="كمرة ثلاثية البحور"
          />
        </div>

        <fieldset className="rounded border p-2">
          <legend className="px-1 text-xs font-semibold">المشروع</legend>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={saveProject}>حفظ ملف المشروع (JSON)</Btn>
            <Btn onClick={() => fileInput.current?.click()}>فتح ملف مشروع…</Btn>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
              e.currentTarget.value = "";
            }}
          />
          <p className="mt-1 text-xs text-slate-500">
            الملف يحمل رقم إصدار مخطط، ويُفحص بالمحرك كاملاً قبل قبوله. تُقبل أيضاً ملفات
            النموذج العاري من النسخ الأولى.
          </p>
        </fieldset>

        <fieldset className="rounded border p-2">
          <legend className="px-1 text-xs font-semibold">جداول CSV</legend>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <label className="text-xs">
              الفاصل
              <select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as Delimiter)}
                className="mt-0.5 w-full rounded border bg-white px-1 py-0.5 text-xs"
              >
                {DELIMITERS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              خطوة الجدول (م)
              <select
                value={step}
                onChange={(e) => setStep(Number(e.target.value))}
                className="num mt-0.5 w-full rounded border bg-white px-1 py-0.5 text-xs"
              >
                {STEPS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={!analysis}
              onClick={() => csv((a) => diagramsCsv(a, { delimiter, step }), "القص-والعزوم-والترخيم")}
              title="قيم V و M والترخيم والميل على طول الكمرة"
            >
              جدول المنحنيات
            </Btn>
            <Btn disabled={!analysis} onClick={() => csv((a) => reactionsCsv(a, { delimiter }), "ردود-الأفعال")}>
              ردود الأفعال
            </Btn>
            <Btn
              disabled={!analysis}
              onClick={() => csv((a) => serviceabilityCsv(a, view.deflectionLimit, { delimiter }), "الترخيم")}
            >
              قابلية الخدمة
            </Btn>
            <Btn disabled={!analysis} onClick={() => csv((a) => summaryCsv(a, { delimiter }), "الملخص")}>
              الملخص والفحوص
            </Btn>
            <Btn
              onClick={() =>
                downloadText(modelCsv(model, { delimiter }), safeFileName(`${base}-النموذج`, "csv"), "text/csv")
              }
            >
              وصف النموذج
            </Btn>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            الملفات بترميز UTF-8 مع علامة BOM ليقرأها Excel عربياً. عند الأحمال المركزة والعزوم
            والمفاصل يظهر صفّان بالموضع نفسه مُميَّزان بعمود «الجهة» — الانفصال حقيقي لا خطأ.
          </p>
        </fieldset>

        <fieldset className="rounded border p-2">
          <legend className="px-1 text-xs font-semibold">الرسوم</legend>
          <label className="mb-2 block text-xs">
            دقة PNG
            <select
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="num mt-0.5 w-full rounded border bg-white px-1 py-0.5 text-xs"
            >
              <option value={1}>عادية (×1)</option>
              <option value={2}>مرتفعة (×2)</option>
              <option value={3}>للطباعة (×3)</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => void exportPng("beam", "الكمرة")}>PNG — الكمرة</Btn>
            <Btn onClick={() => void exportPng("sfd", "القص")}>PNG — القص</Btn>
            <Btn onClick={() => void exportPng("bmd", "العزوم")}>PNG — العزوم</Btn>
            <Btn onClick={() => void exportPng("deflection", "الترخيم")}>PNG — الترخيم</Btn>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn onClick={() => exportSvg("bmd", "العزوم")}>SVG — العزوم</Btn>
            <Btn onClick={exportAllSvg} title="الكمرة والمخططات الثلاثة في ملف واحد">
              SVG — كل الرسوم
            </Btn>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            SVG متجهي بلا فقدان جودة وهو الأنسب للتقارير. المؤشر ودليل الالتقاط لا يظهران في
            التصدير.
          </p>
        </fieldset>

        <fieldset className="rounded border p-2">
          <legend className="px-1 text-xs font-semibold">تقرير PDF</legend>
          <Btn disabled={!analysis} onClick={() => window.print()}>
            طباعة التقرير / حفظ PDF
          </Btn>
          <p className="mt-1 text-xs text-slate-500">
            يفتح حوار الطباعة — اختر «حفظ إلى PDF». نستخدم محرّك نصوص المتصفح لأنه يُشكّل
            العربية صحيحاً ويُنتج نصاً متجهياً قابلاً للبحث، بخلاف مكتبات توليد PDF التي تفصل
            الحروف العربية.
          </p>
        </fieldset>
      </div>
    </details>
  );
}
