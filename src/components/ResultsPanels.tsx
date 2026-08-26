// ResultsPanels.tsx — لوحات النتائج، مفصولة عن App لتبقى الشاشة الرئيسية تركيباً
// لا منطقاً. كلها مكوّنات عرض خالصة تأخذ BeamAnalysis وتعرضه.

import { BeamAnalysis, queryAt } from "../engine/analyze";
import { ar } from "../i18n/ar";

export const fmt = (v: number, digits = 3): string => {
  if (!Number.isFinite(v)) return "—";
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? "0" : String(r);
};

export function StatusBar({ analysis }: { analysis: BeamAnalysis }) {
  const h = analysis.health;
  return (
    <div
      className={`rounded border p-3 text-sm ${
        h.ok
          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
          : "border-amber-400 bg-amber-50 text-amber-900"
      }`}
    >
      <strong>{h.ok ? ar.results.healthOk : ar.results.healthWarn}</strong> — أسوأ خطأ نسبي{" "}
      <span className="num">{h.worst.toExponential(1)}</span> (توازن القوى{" "}
      <span className="num">{h.equilibriumFy.toExponential(1)}</span>، توازن العزوم{" "}
      <span className="num">{h.equilibriumMz.toExponential(1)}</span>، استمرارية{" "}
      <span className="num">{h.continuity.toExponential(1)}</span>، تناسق الترخيم{" "}
      <span className="num">{h.deflectionConsistency.toExponential(1)}</span>) — تكييف المصفوفة{" "}
      <span className="num">{h.conditionHint.toExponential(1)}</span>
    </div>
  );
}

export function Maxima({ analysis }: { analysis: BeamAnalysis }) {
  const { diagrams, deflection } = analysis;
  return (
    <div className="rounded border bg-white p-3 text-sm">
      <h3 className="mb-1 font-semibold">{ar.results.maxima}</h3>
      <ul className="space-y-0.5">
        <li>
          أقصى قص: <span className="num">{fmt(diagrams.extrema.maxAbsV.value)}</span>{" "}
          {ar.units.force} عند <span className="num">{fmt(diagrams.extrema.maxAbsV.x)}</span>{" "}
          {ar.units.length}
        </li>
        <li>
          أقصى عزم موجب: <span className="num">{fmt(diagrams.extrema.maxM.value)}</span>{" "}
          {ar.units.moment} عند <span className="num">{fmt(diagrams.extrema.maxM.x)}</span>{" "}
          {ar.units.length}
        </li>
        <li>
          أقصى عزم سالب: <span className="num">{fmt(diagrams.extrema.minM.value)}</span>{" "}
          {ar.units.moment} عند <span className="num">{fmt(diagrams.extrema.minM.x)}</span>{" "}
          {ar.units.length}
        </li>
        <li>
          أقصى ترخيم:{" "}
          <span className="num">{fmt(deflection.maxAbsDeflection.value * 1000, 4)}</span>{" "}
          {ar.units.mm} عند <span className="num">{fmt(deflection.maxAbsDeflection.x)}</span>{" "}
          {ar.units.length}
        </li>
        <li>
          أقصى ميل: <span className="num">{fmt(deflection.maxAbsRotation.value * 1000, 4)}</span>{" "}
          {ar.units.mrad}
        </li>
        <li>
          نقاط انعدام العزم:{" "}
          <span className="num">
            {diagrams.momentZeros.map((z) => fmt(z, 3)).join(" ، ") || "—"}
          </span>
        </li>
      </ul>
    </div>
  );
}

export function CursorReadout({
  analysis,
  cursorX,
}: {
  analysis: BeamAnalysis;
  cursorX: number | null;
}) {
  if (cursorX === null) {
    return (
      <p className="rounded border border-dashed bg-white p-3 text-sm text-slate-500">
        حرّك المؤشر على الكمرة أو على أي مخطط لقراءة القيم، أو ركّز على مخطط واستخدم الأسهم.
      </p>
    );
  }
  const q = queryAt(analysis, cursorX);
  return (
    <div className="rounded border bg-white p-3 text-sm" aria-live="polite">
      عند <strong className="num">x = {fmt(q.x)}</strong> {ar.units.length} —{" "}
      {q.forceJump ? (
        <>
          قص <span className="num">{fmt(q.V.left)}</span> ←|→{" "}
          <span className="num">{fmt(q.V.right)}</span> {ar.units.force} ، عزم{" "}
          <span className="num">{fmt(q.M.left)}</span> ←|→{" "}
          <span className="num">{fmt(q.M.right)}</span> {ar.units.moment}
        </>
      ) : (
        <>
          قص <span className="num">{fmt(q.V.left)}</span> {ar.units.force} ، عزم{" "}
          <span className="num">{fmt(q.M.left)}</span> {ar.units.moment}
        </>
      )}{" "}
      ، ترخيم <span className="num">{fmt(q.v * 1000, 4)}</span> {ar.units.mm} ، ميل{" "}
      {q.thetaJump ? (
        <>
          <span className="num">{fmt(q.theta.left * 1000, 4)}</span> ←|→{" "}
          <span className="num">{fmt(q.theta.right * 1000, 4)}</span> {ar.units.mrad}{" "}
          <span className="text-xs text-slate-500">(مفصل داخلي)</span>
        </>
      ) : (
        <>
          <span className="num">{fmt(q.theta.left * 1000, 4)}</span> {ar.units.mrad}
        </>
      )}
    </div>
  );
}

export function ReactionsTable({ analysis }: { analysis: BeamAnalysis }) {
  const rows = analysis.solution.supportReactions;
  const total = rows.reduce((a, r) => a + r.Fy, 0);
  return (
    <div>
      <h2 className="mb-2 font-semibold">{ar.results.reactions}</h2>
      <table className="w-full border bg-white text-sm">
        <caption className="sr-only">{ar.results.reactions}</caption>
        <thead className="bg-slate-100 text-right">
          <tr>
            <th className="border p-2">الموضع ({ar.units.length})</th>
            <th className="border p-2">النوع</th>
            <th className="border p-2">القوة الرأسية ({ar.units.force})</th>
            <th className="border p-2">العزم ({ar.units.moment})</th>
            <th className="border p-2">الإزاحة ({ar.units.mm})</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.nodeIndex}>
              <td className="border p-2 num">{fmt(r.at)}</td>
              <td className="border p-2">{ar.support[r.type]}</td>
              <td className="border p-2 num">{fmt(r.Fy)}</td>
              <td className="border p-2 num">{r.Mz === null ? "—" : fmt(r.Mz)}</td>
              <td className="border p-2 num">{fmt(r.displacement * 1000, 4)}</td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-semibold">
            <td className="border p-2" colSpan={2}>
              المجموع
            </td>
            <td className="border p-2 num">{fmt(total)}</td>
            <td className="border p-2">—</td>
            <td className="border p-2">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ServiceabilityTable({
  analysis,
  limit,
}: {
  analysis: BeamAnalysis;
  limit: number;
}) {
  return (
    <div>
      <h2 className="mb-2 font-semibold">{ar.results.serviceability}</h2>
      <p className="mb-2 text-xs text-slate-600">
        الترخيم النسبي يُقاس إلى وتر المسندين، فالهبوط الجسمي الصلب لا يُحسب ضمنه. الطول المرجعي
        للكابولي = ضِعف طوله البارز.
      </p>
      <table className="w-full border bg-white text-sm">
        <caption className="sr-only">{ar.results.serviceability}</caption>
        <thead className="bg-slate-100 text-right">
          <tr>
            <th className="border p-2">القطاع ({ar.units.length})</th>
            <th className="border p-2">النوع</th>
            <th className="border p-2">الطول المرجعي</th>
            <th className="border p-2">أقصى ترخيم نسبي ({ar.units.mm})</th>
            <th className="border p-2">موضعه</th>
            <th className="border p-2">L/δ</th>
            <th className="border p-2">مقابل L/{limit}</th>
          </tr>
        </thead>
        <tbody>
          {analysis.deflection.segments.map((s) => {
            const pass = s.ratio >= limit;
            return (
              <tr key={`${s.fromX}-${s.toX}`}>
                <td className="border p-2 num">
                  {fmt(s.fromX)} → {fmt(s.toX)}
                </td>
                <td className="border p-2">{s.kind === "cantilever" ? "كابولي" : "بين مسندين"}</td>
                <td className="border p-2 num">{fmt(s.effectiveLength)}</td>
                <td className="border p-2 num">{fmt(s.maxRelative.value * 1000, 4)}</td>
                <td className="border p-2 num">{fmt(s.maxRelative.x)}</td>
                <td className="border p-2 num">
                  {Number.isFinite(s.ratio) ? fmt(s.ratio, 1) : "∞"}
                </td>
                <td className={`border p-2 ${pass ? "text-emerald-700" : "text-amber-800"}`}>
                  {pass ? "داخل الحد" : "يتجاوز الحد"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Glossary() {
  return (
    <details className="rounded border bg-white p-3 text-sm">
      <summary className="cursor-pointer font-semibold">{ar.sections.glossary}</summary>
      <table className="mt-2 w-full border text-sm">
        <thead className="bg-slate-100 text-right">
          <tr>
            <th className="border p-2">عربي</th>
            <th className="border p-2">English</th>
          </tr>
        </thead>
        <tbody>
          {ar.glossary.map(([a, e]) => (
            <tr key={e}>
              <td className="border p-2">{a}</td>
              <td className="border p-2" dir="ltr">
                {e}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
