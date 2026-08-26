// PrintReport.tsx — تقرير الطباعة. مخفي على الشاشة ويظهر عند الطباعة وحده.
// يُعاد استخدام مكوّن DiagramPlot نفسه لضمان تطابق الرسم بين الشاشة والورق.

import DiagramPlot from "./DiagramPlot";
import { BeamAnalysis } from "../engine/analyze";
import { BeamModel } from "../engine/types";
import { ar } from "../i18n/ar";
import { fmt } from "./ResultsPanels";

interface Props {
  model: BeamModel;
  analysis: BeamAnalysis;
  projectName: string;
  tensionSide: boolean;
  deflectionLimit: number;
}

const stamp = (): string =>
  new Date().toLocaleString("ar-u-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function T({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} className="border border-slate-400 bg-slate-100 p-1 text-right font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={`border border-slate-300 p-1 ${typeof c === "number" ? "num" : ""}`}>
                {typeof c === "number" ? fmt(c) : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PrintReport({
  model,
  analysis,
  projectName,
  tensionSide,
  deflectionLimit,
}: Props) {
  const { diagrams, deflection, solution, health } = analysis;
  const L = diagrams.totalLength;

  return (
    <div className="print-report hidden" aria-hidden="true">
      <header className="mb-3 border-b-2 border-slate-800 pb-2">
        <h1 className="text-base font-bold">
          تقرير تحليل كمرة{projectName.trim() ? ` — ${projectName.trim()}` : ""}
        </h1>
        <p className="text-[11px] text-slate-600">
          {ar.app.title} — أُنشئ في {stamp()} — الطول الكلي{" "}
          <span className="num">{fmt(L)}</span> م، عدد البحور{" "}
          <span className="num">{model.spans.length}</span>، درجات الحرية{" "}
          <span className="num">{solution.beam.dofMap.nDof}</span>
        </p>
      </header>

      <section className="mb-3">
        <h2 className="mb-1 text-sm font-bold">1 — النموذج</h2>
        <div className="mb-2">
          <T
            head={["البحر", "الطول (م)", "E (GPa)", "I (m⁴)", "EI (kN·m²)"]}
            rows={model.spans.map((s) => [s.id, s.length, s.E, s.I, s.E * 1e6 * s.I])}
          />
        </div>
        <div className="mb-2">
          <T
            head={["المسند", "الموضع (م)", "الجساءة (kN/m)", "الهبوط (مم)"]}
            rows={model.supports.map((s) => [
              ar.support[s.type],
              s.at,
              s.springStiffness === undefined ? "—" : s.springStiffness,
              s.settlement === undefined ? "—" : s.settlement * 1000,
            ])}
          />
        </div>
        <T
          head={["الحمل", "من/عند (م)", "إلى (م)", "القيمة"]}
          rows={model.loads.map((l) =>
            l.type === "point" || l.type === "moment"
              ? [ar.load[l.type], l.at, "—", `${fmt(l.magnitude)} ${l.type === "point" ? "kN" : "kN·m"}`]
              : [
                  ar.load[l.type],
                  l.from,
                  l.to,
                  l.type === "udl"
                    ? `${fmt(l.w)} kN/m`
                    : `${fmt(l.w1)} → ${fmt(l.w2)} kN/m`,
                ]
          )}
        />
        {(model.hinges ?? []).length > 0 && (
          <p className="mt-1 text-[11px]">
            مفاصل داخلية عند:{" "}
            <span className="num">{(model.hinges ?? []).map((h) => fmt(h.at)).join(" ، ")}</span> م
          </p>
        )}
      </section>

      <section className="mb-3">
        <h2 className="mb-1 text-sm font-bold">2 — ردود الأفعال</h2>
        <T
          head={["الموضع (م)", "النوع", "القوة الرأسية (kN)", "العزم (kN·m)", "الإزاحة (مم)"]}
          rows={[
            ...solution.supportReactions.map((r) => [
              r.at,
              ar.support[r.type],
              r.Fy,
              r.Mz === null ? "—" : r.Mz,
              r.displacement * 1000,
            ]),
            [
              "المجموع",
              "",
              solution.supportReactions.reduce((a, r) => a + r.Fy, 0),
              "—",
              "—",
            ],
          ]}
        />
      </section>

      <section className="mb-3">
        <h2 className="mb-1 text-sm font-bold">3 — القيم القصوى</h2>
        <T
          head={["الكمية", "القيمة", "الوحدة", "الموضع (م)"]}
          rows={[
            ["أقصى قص (مطلقاً)", diagrams.extrema.maxAbsV.value, "kN", diagrams.extrema.maxAbsV.x],
            ["أقصى عزم موجب", diagrams.extrema.maxM.value, "kN·m", diagrams.extrema.maxM.x],
            ["أقصى عزم سالب", diagrams.extrema.minM.value, "kN·m", diagrams.extrema.minM.x],
            [
              "أقصى ترخيم",
              deflection.maxAbsDeflection.value * 1000,
              "مم",
              deflection.maxAbsDeflection.x,
            ],
            [
              "أقصى ميل",
              deflection.maxAbsRotation.value * 1000,
              "مِلّي‑راديان",
              deflection.maxAbsRotation.x,
            ],
            [
              "نقاط انعدام العزم",
              diagrams.momentZeros.map((z) => fmt(z, 3)).join(" ، ") || "—",
              "م",
              "",
            ],
          ]}
        />
      </section>

      <section className="mb-3 break-inside-avoid">
        <h2 className="mb-1 text-sm font-bold">4 — المخططات</h2>
        <div className="space-y-2">
          <DiagramPlot
            title={ar.results.sfd}
            unit={ar.units.force}
            color="#0284c7"
            points={diagrams.points.map((p) => ({ x: p.x, y: p.V }))}
            totalLength={L}
            cursorX={null}
            onCursorChange={() => {}}
            height={140}
            markers={solution.supportReactions.map((r) => ({ x: r.at, label: fmt(r.at) }))}
          />
          <DiagramPlot
            title={ar.results.bmd}
            unit={ar.units.moment}
            color="#b91c1c"
            invertY={tensionSide}
            points={diagrams.points.map((p) => ({ x: p.x, y: p.M }))}
            totalLength={L}
            cursorX={null}
            onCursorChange={() => {}}
            height={160}
            markers={diagrams.momentZeros.map((z) => ({ x: z, label: fmt(z, 2) }))}
          />
          <DiagramPlot
            title={ar.results.deflection}
            unit={ar.units.mm}
            color="#7c3aed"
            points={deflection.points.map((p) => ({ x: p.x, y: p.v * 1000 }))}
            totalLength={L}
            cursorX={null}
            onCursorChange={() => {}}
            height={140}
            markers={solution.supportReactions.map((r) => ({ x: r.at, label: fmt(r.at) }))}
          />
        </div>
        <p className="mt-1 text-[10px] text-slate-600">
          {tensionSide
            ? "العزوم مرسومة على جهة الشد (الموجب لأسفل)."
            : "العزوم مرسومة بالاصطلاح الرياضي (الموجب لأعلى)."}{" "}
          القص موجب حين تكون محصلة الجزء الأيسر لأعلى، والعزم موجب عند الشد بالألياف السفلية.
        </p>
      </section>

      <section className="mb-3">
        <h2 className="mb-1 text-sm font-bold">5 — قابلية الخدمة</h2>
        <T
          head={[
            "القطاع (م)",
            "النوع",
            "الطول المرجعي (م)",
            "أقصى ترخيم نسبي (مم)",
            "موضعه (م)",
            "L/δ",
            `مقابل L/${deflectionLimit}`,
          ]}
          rows={deflection.segments.map((s) => [
            `${fmt(s.fromX)} → ${fmt(s.toX)}`,
            s.kind === "cantilever" ? "كابولي" : "بين مسندين",
            s.effectiveLength,
            s.maxRelative.value * 1000,
            s.maxRelative.x,
            Number.isFinite(s.ratio) ? fmt(s.ratio, 1) : "∞",
            s.ratio >= deflectionLimit ? "داخل الحد" : "يتجاوز الحد",
          ])}
        />
        <p className="mt-1 text-[10px] text-slate-600">
          الترخيم النسبي يُقاس إلى وتر المسندين، فالهبوط الجسمي الصلب لا يُحسب ضمنه. الطول
          المرجعي للكابولي = ضِعف طوله البارز.
        </p>
      </section>

      <section className="mb-3">
        <h2 className="mb-1 text-sm font-bold">6 — فحوص السلامة العددية</h2>
        <T
          head={["الفحص", "الخطأ النسبي"]}
          rows={[
            ["توازن القوى الرأسية", health.equilibriumFy.toExponential(2)],
            ["توازن العزوم حول x=0", health.equilibriumMz.toExponential(2)],
            ["استمرارية وثبات V و M عند العقد", health.continuity.toExponential(2)],
            ["تناسق تكامل M/EI مع درجات الحرية", health.deflectionConsistency.toExponential(2)],
            ["متبقي حل النظام ‖Kd−F‖", health.solveResidual.toExponential(2)],
            ["تقدير سوء التكييف", health.conditionHint.toExponential(2)],
            ["الحصيلة", health.ok ? "كل الفحوص مُجتازة" : "تحذير — راجع القيم أعلاه"],
          ]}
        />
      </section>

      <footer className="border-t border-slate-400 pt-2 text-[10px] text-slate-700">
        <p className="font-semibold">تنبيه</p>
        <p>{ar.app.disclaimer}</p>
        <p className="mt-1">
          الحدود المعروفة: نموذج أويلر‑برنولي مستوٍ وخطي — تشوّه القص مُغفَل، ولا قوى محورية ولا
          لدونة ولا هندسة لاخطية.
        </p>
      </footer>
    </div>
  );
}
