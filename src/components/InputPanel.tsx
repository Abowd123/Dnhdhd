// InputPanel.tsx — لوحة الإدخال العربية: المكافئ الرقمي الكامل للرسم التفاعلي.
//
// كل ما يظهر في BeamCanvas له صف هنا، والتحديد متزامن في الاتجاهين: اختيار صف
// يُبرز العنصر في الرسم، والنقر على الرسم يُبرز الصف.

import { useState } from "react";
import NumberField from "./NumberField";
import { tryAnalyzeBeam } from "../engine/analyze";
import { LoadDef, SupportType } from "../engine/types";
import { totalLength } from "../engine/validate";
import { ar } from "../i18n/ar";
import { Selection, sameSelection, useBeamStore } from "../store/beamStore";

const SUPPORT_TYPES: SupportType[] = ["fixed", "pinned", "roller", "spring"];
const LOAD_KINDS: LoadDef["type"][] = ["point", "moment", "udl", "linear"];

function Section({
  title,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  onAdd?(): void;
  addLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded border bg-white p-3">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="space-y-2">{children}</div>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-2 w-full rounded border border-dashed border-slate-400 py-1 text-sm text-slate-700 hover:bg-slate-50"
        >
          + {addLabel ?? ar.actions.add}
        </button>
      )}
    </fieldset>
  );
}

function Row({
  sel,
  onSelect,
  selection,
  onRemove,
  removeLabel,
  children,
}: {
  sel: Selection;
  onSelect(s: Selection | null): void;
  selection: Selection | null;
  onRemove(): void;
  removeLabel: string;
  children: React.ReactNode;
}) {
  const active = sameSelection(selection, sel);
  return (
    <div
      onFocusCapture={() => onSelect(sel)}
      className={`rounded border p-2 ${
        active ? "border-sky-500 bg-sky-50" : "border-slate-200"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2">{children}</div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="mt-4 rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function InputPanel() {
  const model = useBeamStore((s) => s.model);
  const selection = useBeamStore((s) => s.selection);
  const setSelection = useBeamStore((s) => s.setSelection);
  const store = useBeamStore();
  const L = totalLength(model);

  return (
    <div className="space-y-3">
      <Section title={ar.sections.spans} onAdd={store.addSpan} addLabel="إضافة بحر">
        <p className="text-xs text-slate-500">
          البحر منطقة جساءة ثابتة. المساند حرة الموضع ولا يلزم أن تقع على حدود البحور.
        </p>
        {model.spans.map((sp, i) => (
          <Row
            key={sp.id}
            sel={{ kind: "span", index: i }}
            selection={selection}
            onSelect={setSelection}
            onRemove={() => store.removeSpan(i)}
            removeLabel={`حذف البحر ${sp.id}`}
          >
            <NumberField
              label={`${ar.fields.length} — ${sp.id}`}
              unit={ar.units.length}
              value={sp.length}
              min={0}
              onChange={(v) => store.updateSpan(i, { length: v })}
            />
            <NumberField
              label={ar.fields.modulus}
              unit={ar.units.modulus}
              step={5}
              min={0}
              value={sp.E}
              onChange={(v) => store.updateSpan(i, { E: v })}
            />
            <NumberField
              label={ar.fields.inertia}
              unit={ar.units.inertia}
              step={1e-5}
              min={0}
              value={sp.I}
              onChange={(v) => store.updateSpan(i, { I: v })}
              className="col-span-2"
            />
          </Row>
        ))}
      </Section>

      <Section title={ar.sections.supports} onAdd={store.addSupport} addLabel="إضافة مسند">
        {model.supports.map((s, i) => (
          <Row
            key={`sup${i}`}
            sel={{ kind: "support", index: i }}
            selection={selection}
            onSelect={setSelection}
            onRemove={() => store.removeSupport(i)}
            removeLabel={`حذف المسند عند ${s.at} م`}
          >
            <NumberField
              label={ar.fields.position}
              unit={ar.units.length}
              value={s.at}
              min={0}
              max={L}
              onChange={(v) => store.updateSupport(i, { at: v })}
            />
            <div>
              <label className="block text-xs text-slate-600" htmlFor={`sup-type-${i}`}>
                {ar.fields.supportType}
              </label>
              <select
                id={`sup-type-${i}`}
                value={s.type}
                onChange={(e) => store.setSupportType(i, e.target.value as SupportType)}
                className="w-full rounded border bg-white px-2 py-1 text-sm"
              >
                {SUPPORT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ar.supportShort[t]}
                  </option>
                ))}
              </select>
            </div>
            {s.type === "spring" ? (
              <NumberField
                label={ar.fields.springStiffness}
                unit={ar.units.springStiffness}
                step={500}
                min={0}
                value={s.springStiffness ?? 5000}
                onChange={(v) => store.updateSupport(i, { springStiffness: v })}
                className="col-span-2"
              />
            ) : (
              <NumberField
                label={`${ar.fields.settlement} (لأسفل سالب)`}
                unit={ar.units.mm}
                step={1}
                value={(s.settlement ?? 0) * 1000}
                onChange={(v) => store.updateSupport(i, { settlement: v / 1000 })}
                className="col-span-2"
              />
            )}
          </Row>
        ))}
      </Section>

      <Section title={ar.sections.hinges} onAdd={store.addHinge} addLabel="إضافة مفصل">
        {(model.hinges ?? []).length === 0 && (
          <p className="text-xs text-slate-500">لا مفاصل. المفصل يجعل العزم صفراً عند موضعه.</p>
        )}
        {(model.hinges ?? []).map((h, i) => (
          <Row
            key={`h${i}`}
            sel={{ kind: "hinge", index: i }}
            selection={selection}
            onSelect={setSelection}
            onRemove={() => store.removeHinge(i)}
            removeLabel={`حذف المفصل عند ${h.at} م`}
          >
            <NumberField
              label={ar.fields.position}
              unit={ar.units.length}
              value={h.at}
              min={0}
              max={L}
              onChange={(v) => store.updateHinge(i, { at: v })}
              className="col-span-2"
            />
          </Row>
        ))}
      </Section>

      <Section title={ar.sections.loads}>
        <p className="text-xs text-slate-500">لأسفل سالب. العزم موجب عكس عقارب الساعة.</p>
        {model.loads.map((l, i) => (
          <Row
            key={`l${i}`}
            sel={{ kind: "load", index: i }}
            selection={selection}
            onSelect={setSelection}
            onRemove={() => store.removeLoad(i)}
            removeLabel={`حذف ${ar.load[l.type]}`}
          >
            <div className="col-span-2">
              <label className="block text-xs text-slate-600" htmlFor={`load-kind-${i}`}>
                {ar.fields.loadKind}
              </label>
              <select
                id={`load-kind-${i}`}
                value={l.type}
                onChange={(e) => store.changeLoadKind(i, e.target.value as LoadDef["type"])}
                className="w-full rounded border bg-white px-2 py-1 text-sm"
              >
                {LOAD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ar.load[k]}
                  </option>
                ))}
              </select>
            </div>

            {(l.type === "point" || l.type === "moment") && (
              <>
                <NumberField
                  label={ar.fields.position}
                  unit={ar.units.length}
                  value={l.at}
                  min={0}
                  max={L}
                  onChange={(v) => store.updateLoad(i, { at: v })}
                />
                <NumberField
                  label={ar.fields.magnitude}
                  unit={l.type === "point" ? ar.units.force : ar.units.moment}
                  step={5}
                  value={l.magnitude}
                  onChange={(v) => store.updateLoad(i, { magnitude: v })}
                />
              </>
            )}

            {(l.type === "udl" || l.type === "linear") && (
              <>
                <NumberField
                  label={ar.fields.from}
                  unit={ar.units.length}
                  value={l.from}
                  min={0}
                  max={L}
                  onChange={(v) => store.updateLoad(i, { from: v })}
                />
                <NumberField
                  label={ar.fields.to}
                  unit={ar.units.length}
                  value={l.to}
                  min={0}
                  max={L}
                  onChange={(v) => store.updateLoad(i, { to: v })}
                />
              </>
            )}

            {l.type === "udl" && (
              <NumberField
                label={ar.fields.intensity}
                unit={ar.units.distributed}
                step={2.5}
                value={l.w}
                onChange={(v) => store.updateLoad(i, { w: v })}
                className="col-span-2"
              />
            )}

            {l.type === "linear" && (
              <>
                <NumberField
                  label={ar.fields.intensityStart}
                  unit={ar.units.distributed}
                  step={2.5}
                  value={l.w1}
                  onChange={(v) => store.updateLoad(i, { w1: v })}
                />
                <NumberField
                  label={ar.fields.intensityEnd}
                  unit={ar.units.distributed}
                  step={2.5}
                  value={l.w2}
                  onChange={(v) => store.updateLoad(i, { w2: v })}
                />
              </>
            )}
          </Row>
        ))}
        <div className="grid grid-cols-2 gap-2">
          {LOAD_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => store.addLoad(k)}
              className="rounded border border-dashed border-slate-400 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              + {ar.load[k]}
            </button>
          ))}
        </div>
      </Section>

      <JsonSection />
    </div>
  );
}

/** لوحة JSON — للحفظ اليدوي والمشاركة. التصدير الكامل في المرحلة 9. */
function JsonSection() {
  const model = useBeamStore((s) => s.model);
  const setModel = useBeamStore((s) => s.setModel);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = JSON.stringify(model, null, 2);
  const value = text ?? current;

  return (
    <details className="rounded border bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold">{ar.sections.json}</summary>
      <label htmlFor="model-json" className="sr-only">
        {ar.sections.json}
      </label>
      <textarea
        id="model-json"
        dir="ltr"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        className="mt-2 h-56 w-full rounded border p-2 font-mono text-xs"
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            // نتحقق بالمحرك نفسه قبل التطبيق: لا نُدخل نموذجاً مرفوضاً إلى الحالة
            const r = tryAnalyzeBeam(value);
            if (r.ok) {
              setModel(r.analysis.model);
              setText(null);
              setError(null);
            } else {
              setError(`[${r.code}] ${r.message}`);
            }
          }}
          className="flex-1 rounded bg-slate-800 py-1 text-sm text-white hover:bg-slate-700"
        >
          {ar.actions.apply}
        </button>
        <button
          type="button"
          onClick={() => {
            setText(null);
            setError(null);
          }}
          className="rounded border px-3 py-1 text-sm hover:bg-slate-50"
        >
          استعادة الحالي
        </button>
      </div>
    </details>
  );
}
