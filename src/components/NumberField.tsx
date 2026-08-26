// NumberField.tsx — حقل رقمي يحتفظ بنص المستخدم أثناء الكتابة.
//
// المشكلة التي يحلها: حقل مربوط مباشرة بـ Number(value) يمنع كتابة "-" أو "1."
// أو محو الحقل لإعادة الكتابة، لأن كل ضغطة تُعاد فوراً من الحالة. الحل الاحتفاظ
// بنص محلي أثناء التركيز، والمزامنة مع القيمة الخارجية عند الخروج فقط.

import { useEffect, useId, useState } from "react";

interface Props {
  label: string;
  value: number;
  onChange(v: number): void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  /** التسمية للقارئات الشاشية فقط — للجداول المكتنزة */
  labelHidden?: boolean;
  className?: string;
}

const format = (v: number): string => {
  if (!Number.isFinite(v)) return "";
  const r = Number(v.toPrecision(12));
  return Object.is(r, -0) ? "0" : String(r);
};

export default function NumberField({
  label,
  value,
  onChange,
  unit,
  step = 0.25,
  min,
  max,
  labelHidden = false,
  className = "",
}: Props) {
  const id = useId();
  const [text, setText] = useState(() => format(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(format(value));
  }, [value, focused]);

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={labelHidden ? "sr-only" : "block text-xs text-slate-600"}
      >
        {label}
        {unit ? ` (${unit})` : ""}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        dir="ltr"
        step={step}
        min={min}
        max={max}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(format(value));
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === "") return;
          const v = Number(raw);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="num w-full rounded border bg-white px-2 py-1 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
      />
    </div>
  );
}
