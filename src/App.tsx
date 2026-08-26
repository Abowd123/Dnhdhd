// App.tsx — المرحلة 8: سحب تفاعلي كامل + اختصارات لوحة المفاتيح.
//
// إعادة الحساب أثناء السحب تجري على كل حركة مؤشر مع عينات مخفَّفة (12 لكل عنصر
// بدل 40). القيم القصوى تُحسب تحليلياً من جذور متعددات الحدود لا بمسح الشبكة،
// فالتخفيف يمسّ نعومة الخط ولا يمسّ أي رقم معروض.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BeamCanvas from "./components/BeamCanvas";
import DiagramPlot from "./components/DiagramPlot";
import InputPanel from "./components/InputPanel";
import ExportPanel from "./components/ExportPanel";
import PrintReport from "./components/PrintReport";
import {
  CursorReadout,
  Glossary,
  Maxima,
  ReactionsTable,
  ServiceabilityTable,
  StatusBar,
  fmt,
} from "./components/ResultsPanels";
import { tryAnalyzeBeam } from "./engine/analyze";
import { totalLength } from "./engine/validate";
import { defaultView } from "./export/project";
import { readAutosave, saveAutosave } from "./export/storage";
import { ar } from "./i18n/ar";
import { DragSubject } from "./interaction/snap";
import { NUDGE_STEP, Selection, useBeamStore } from "./store/beamStore";

const LIMITS = [200, 250, 360, 500];

/** التركيز داخل حقل نصي أو رقمي: نترك المفاتيح لسلوكها الأصلي */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

export default function App() {
  const model = useBeamStore((s) => s.model);
  const interacting = useBeamStore((s) => s.interacting);
  const cursorX = useBeamStore((s) => s.cursorX);
  const selection = useBeamStore((s) => s.selection);
  const tensionSide = useBeamStore((s) => s.tensionSide);
  const deflectionLimit = useBeamStore((s) => s.deflectionLimit);
  const notice = useBeamStore((s) => s.notice);

  const [projectName, setProjectName] = useState("");
  const replaceProject = useBeamStore((s) => s.replaceProject);
  const setNotice = useBeamStore((s) => s.setNotice);
  const restored = useRef(false);

  const setCursorX = useBeamStore((s) => s.setCursorX);
  const setSelection = useBeamStore((s) => s.setSelection);
  const nudge = useBeamStore((s) => s.nudge);
  const undo = useBeamStore((s) => s.undo);
  const redo = useBeamStore((s) => s.redo);
  const resetModel = useBeamStore((s) => s.resetModel);
  const toggleTensionSide = useBeamStore((s) => s.toggleTensionSide);
  const setDeflectionLimit = useBeamStore((s) => s.setDeflectionLimit);
  const dismissNotice = useBeamStore((s) => s.dismissNotice);

  const beginInteraction = useBeamStore((s) => s.beginInteraction);
  const endInteraction = useBeamStore((s) => s.endInteraction);
  const cancelInteraction = useBeamStore((s) => s.cancelInteraction);
  const moveEntity = useBeamStore((s) => s.moveEntity);
  const resizeDistributedLoad = useBeamStore((s) => s.resizeDistributedLoad);
  const removeSupport = useBeamStore((s) => s.removeSupport);
  const removeHinge = useBeamStore((s) => s.removeHinge);
  const removeLoad = useBeamStore((s) => s.removeLoad);
  const removeSpan = useBeamStore((s) => s.removeSpan);

  const hasPast = useBeamStore((s) => s.past.length > 0);
  const hasFuture = useBeamStore((s) => s.future.length > 0);

  const result = useMemo(
    () => tryAnalyzeBeam(model, { interactive: interacting }),
    [model, interacting]
  );

  const L = totalLength(model);

  // استعادة آخر جلسة — مُعلَنة لا صامتة
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = readAutosave();
    if (!saved) return;
    replaceProject(
      saved.model,
      saved.view ?? defaultView,
      `استُعيدت آخر جلسة محفوظة تلقائياً (${new Date(saved.savedAt).toLocaleString(
        "ar-u-nu-latn"
      )}). اضغط «إعادة تعيين» للبدء من النموذج الافتراضي.`
    );
  }, [replaceProject]);

  // حفظ تلقائي مؤجَّل — لا يُكتب أثناء السحب ولا عند كل ضغطة مفتاح
  useEffect(() => {
    if (interacting) return;
    const id = window.setTimeout(() => {
      saveAutosave(model, { tensionSide, deflectionLimit });
    }, 700);
    return () => window.clearTimeout(id);
  }, [model, tensionSide, deflectionLimit, interacting]);

  /** أثناء السحب لا نُسجّل في السجل — الصورة الملتقطة عند البداية تُدفع عند النهاية */
  const handleDragMove = useCallback(
    (subject: DragSubject, x: number) => {
      if (subject.sel.kind === "load" && subject.edge) {
        resizeDistributedLoad(subject.sel.index, subject.edge, x, false);
      } else {
        moveEntity(subject.sel, x, false);
      }
    },
    [moveEntity, resizeDistributedLoad]
  );

  const removeSelected = useCallback(
    (sel: Selection) => {
      if (sel.kind === "support") removeSupport(sel.index);
      else if (sel.kind === "hinge") removeHinge(sel.index);
      else if (sel.kind === "load") removeLoad(sel.index);
      else removeSpan(sel.index);
    },
    [removeSupport, removeHinge, removeLoad, removeSpan]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "z") {
        // داخل حقل نصي نترك التراجع الأصلي للمتصفح
        if (isEditable(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        if (isEditable(e.target)) return;
        e.preventDefault();
        redo();
        return;
      }

      if (isEditable(e.target)) return;

      if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        e.preventDefault();
        removeSelected(selection);
        return;
      }
      if (e.key === "Escape") {
        // إلغاء السحب يعالجه useDrag؛ هنا نُلغي التحديد فقط
        if (!useBeamStore.getState().interacting) setSelection(null);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selection, removeSelected, setSelection]);

  return (
    <div className="print-root">
      <div className="no-print min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="no-print border-b bg-white px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">{ar.app.title}</h1>
            <p className="text-xs text-slate-600">
              المرحلة 8: سحب تفاعلي مع التقاط مغناطيسي وإعادة حساب لحظية
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={undo}
              disabled={!hasPast}
              title="Ctrl/⌘ + Z"
              className="rounded border px-3 py-1 disabled:opacity-40 enabled:hover:bg-slate-50"
            >
              ↶ {ar.actions.undo}
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!hasFuture}
              title="Ctrl/⌘ + Shift + Z"
              className="rounded border px-3 py-1 disabled:opacity-40 enabled:hover:bg-slate-50"
            >
              ↷ {ar.actions.redo}
            </button>
            <button
              type="button"
              onClick={resetModel}
              className="rounded border px-3 py-1 hover:bg-slate-50"
            >
              {ar.actions.reset}
            </button>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={tensionSide}
                onChange={toggleTensionSide}
                className="h-4 w-4"
              />
              {ar.actions.tensionSide}
            </label>
            <label className="flex items-center gap-1.5">
              <span>{ar.actions.deflectionLimit}:</span>
              <select
                value={deflectionLimit}
                onChange={(e) => setDeflectionLimit(Number(e.target.value))}
                className="rounded border bg-white px-2 py-1"
              >
                {LIMITS.map((v) => (
                  <option key={v} value={v}>
                    L/{v}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      <main className="grid gap-6 p-6 xl:grid-cols-[23rem_1fr]">
        <section aria-label="لوحة الإدخال">
          <InputPanel />
          <Shortcuts />
          <ExportPanel
            model={model}
            analysis={result.ok ? result.analysis : null}
            view={{ tensionSide, deflectionLimit }}
            projectName={projectName}
            onProjectNameChange={setProjectName}
            onLoad={(m, v, msg) => replaceProject(m, v, msg)}
            onError={(msg) => setNotice(msg)}
          />
        </section>

        <section className="space-y-4">
          {notice && (
            <div
              role="status"
              className="flex items-start justify-between gap-3 rounded border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900"
            >
              <span>{notice}</span>
              <button
                type="button"
                onClick={dismissNotice}
                aria-label={ar.actions.dismiss}
                className="rounded border border-sky-400 px-2 text-xs"
              >
                ✕
              </button>
            </div>
          )}

          <BeamCanvas
            model={model}
            totalLength={L}
            cursorX={cursorX}
            onCursorChange={setCursorX}
            selection={selection}
            onSelect={setSelection}
            onNudge={nudge}
            nudgeStep={NUDGE_STEP}
            onDragBegin={beginInteraction}
            onDragMove={handleDragMove}
            onDragEnd={endInteraction}
            onDragCancel={cancelInteraction}
          />

          {!result.ok ? (
            <div role="alert" className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
              <strong className="block">تعذّر حل النموذج</strong>
              <span className="text-sm">
                <span className="num">[{result.code}]</span> {result.message}
              </span>
              <p className="mt-2 text-xs">
                الرسم أعلاه يعرض النموذج كما أدخلته. صحّح القيمة المذكورة ثم ستظهر المخططات.
              </p>
            </div>
          ) : (
            <>
              <StatusBar analysis={result.analysis} />
              <CursorReadout analysis={result.analysis} cursorX={cursorX} />

              <DiagramPlot
                title={ar.results.sfd}
                exportId="sfd"
                unit={ar.units.force}
                color="#0284c7"
                points={result.analysis.diagrams.points.map((p) => ({ x: p.x, y: p.V }))}
                totalLength={result.analysis.diagrams.totalLength}
                cursorX={cursorX}
                onCursorChange={setCursorX}
                markers={result.analysis.solution.supportReactions.map((r) => ({
                  x: r.at,
                  label: fmt(r.at),
                }))}
              />

              <DiagramPlot
                title={ar.results.bmd}
                exportId="bmd"
                unit={ar.units.moment}
                color="#b91c1c"
                invertY={tensionSide}
                points={result.analysis.diagrams.points.map((p) => ({ x: p.x, y: p.M }))}
                totalLength={result.analysis.diagrams.totalLength}
                cursorX={cursorX}
                onCursorChange={setCursorX}
                height={190}
                markers={result.analysis.diagrams.momentZeros.map((z) => ({
                  x: z,
                  label: fmt(z, 2),
                }))}
              />

              <DiagramPlot
                title={ar.results.deflection}
                exportId="deflection"
                unit={ar.units.mm}
                color="#7c3aed"
                points={result.analysis.deflection.points.map((p) => ({ x: p.x, y: p.v * 1000 }))}
                totalLength={result.analysis.deflection.totalLength}
                cursorX={cursorX}
                onCursorChange={setCursorX}
                height={170}
                markers={result.analysis.solution.supportReactions.map((r) => ({
                  x: r.at,
                  label: fmt(r.at),
                }))}
              />

              <div className="grid gap-4 lg:grid-cols-2">
                <Maxima analysis={result.analysis} />
                <Glossary />
              </div>

              <ServiceabilityTable analysis={result.analysis} limit={deflectionLimit} />
              <ReactionsTable analysis={result.analysis} />
            </>
          )}

          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {ar.app.disclaimer}
          </p>
        </section>
      </main>
      </div>
      {result.ok && (
        <PrintReport
          model={model}
          analysis={result.analysis}
          projectName={projectName}
          tensionSide={tensionSide}
          deflectionLimit={deflectionLimit}
        />
      )}
    </div>
  );
}

function Shortcuts() {
  return (
    <details className="mt-3 rounded border bg-white p-3 text-sm">
      <summary className="cursor-pointer font-semibold">{ar.shortcuts.title}</summary>
      <table className="mt-2 w-full text-xs">
        <tbody>
          {ar.shortcuts.rows.map(([key, desc]) => (
            <tr key={key} className="border-b last:border-0">
              <td className="py-1 pl-2 text-slate-600">{desc}</td>
              <td className="py-1" dir="ltr">
                <kbd className="rounded border bg-slate-50 px-1.5 py-0.5 font-mono">{key}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
