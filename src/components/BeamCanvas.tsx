// BeamCanvas.tsx — رسم الكمرة بالمساند والأحمال، قابل للسحب بالفأرة واللمس.
//
// منطقة الرسم LTR داخل واجهة RTL: المخططات الإنشائية تُقرأ من اليسار لليمين
// عالمياً، والانعكاس يقتصر على النصوص والقوائم.
//
// إمكانية الوصول: كل ما يُمكن فعله بالسحب يُمكن فعله بلوحة المفاتيح (تركيز ثم
// أسهم بخطوة 0.25 م) وبالأرقام في لوحة الإدخال. لا إجراء متاح بالفأرة وحدها.

import { scaleLinear } from "d3-scale";
import { useCallback, useMemo, useRef } from "react";
import { BeamModel } from "../engine/types";
import { spanBoundaries } from "../engine/validate";
import { ar } from "../i18n/ar";
import {
  DragSubject,
  GRID_STEP,
  SNAP_PIXELS,
  SnapResult,
  collectSnapTargets,
  dragBounds,
  snapPosition,
} from "../interaction/snap";
import { useDrag } from "../interaction/useDrag";
import { Selection, sameSelection } from "../store/beamStore";

interface Props {
  model: BeamModel;
  totalLength: number;
  cursorX: number | null;
  onCursorChange(x: number | null): void;
  selection: Selection | null;
  onSelect(sel: Selection | null): void;
  onNudge(sel: Selection, delta: number): void;
  nudgeStep: number;
  onDragBegin(): void;
  onDragMove(subject: DragSubject, x: number): void;
  onDragEnd(): void;
  onDragCancel(): void;
}

const W = 900;
const H = 244;
const PAD_L = 46;
const PAD_R = 46;
const BEAM_Y = 142;
const DIM_Y = 214;

const COLOR = {
  beam: "#1e293b",
  support: "#0f172a",
  hinge: "#0f172a",
  point: "#b91c1c",
  moment: "#7c3aed",
  dist: "#0284c7",
  dim: "#64748b",
  halo: "#0284c7",
  cursor: "#dc2626",
  snap: "#059669",
};

const fmt = (v: number, d = 3): string => {
  const r = Number(v.toFixed(d));
  return Object.is(r, -0) ? "0" : String(r);
};

function VArrow({
  x,
  from,
  to,
  color,
  width = 1.6,
}: {
  x: number;
  from: number;
  to: number;
  color: string;
  width?: number;
}) {
  const dir = to >= from ? 1 : -1;
  const base = to - dir * 7;
  return (
    <g pointerEvents="none">
      <line x1={x} y1={from} x2={x} y2={base} stroke={color} strokeWidth={width} />
      <polygon points={`${x},${to} ${x - 4},${base} ${x + 4},${base}`} fill={color} />
    </g>
  );
}

function Ground({ x, y, half = 12 }: { x: number; y: number; half?: number }) {
  const ticks: number[] = [];
  for (let i = -half; i <= half; i += 6) ticks.push(i);
  return (
    <g pointerEvents="none" stroke={COLOR.support} strokeWidth={1}>
      <line x1={x - half} y1={y} x2={x + half} y2={y} strokeWidth={1.4} />
      {ticks.map((t) => (
        <line key={t} x1={x + t} y1={y} x2={x + t - 5} y2={y + 6} />
      ))}
    </g>
  );
}

function Halo({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <rect
      x={Math.min(x1, x2)}
      y={Math.min(y1, y2)}
      width={Math.abs(x2 - x1)}
      height={Math.abs(y2 - y1)}
      rx={5}
      fill="none"
      stroke={COLOR.halo}
      strokeWidth={1.6}
      strokeDasharray="5 3"
      pointerEvents="none"
    />
  );
}

export default function BeamCanvas({
  model,
  totalLength,
  cursorX,
  onCursorChange,
  selection,
  onSelect,
  onNudge,
  nudgeStep,
  onDragBegin,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: Props) {
  const L = totalLength > 0 ? totalLength : 1;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const snapRef = useRef<SnapResult | null>(null);

  const { xs, maxP, maxM, maxW, bounds } = useMemo(() => {
    let p = 0;
    let m = 0;
    let w = 0;
    for (const l of model.loads) {
      if (l.type === "point") p = Math.max(p, Math.abs(l.magnitude));
      else if (l.type === "moment") m = Math.max(m, Math.abs(l.magnitude));
      else if (l.type === "udl") w = Math.max(w, Math.abs(l.w));
      else w = Math.max(w, Math.abs(l.w1), Math.abs(l.w2));
    }
    return {
      xs: scaleLinear().domain([0, L]).range([PAD_L, W - PAD_R]),
      maxP: p,
      maxM: m,
      maxW: w,
      bounds: spanBoundaries(model),
    };
  }, [model, L]);

  /** أمتار لكل بكسل شاشة — يلزم لتحويل نطاق الالتقاط من بكسل إلى وحدات النموذج */
  const metersPerPixel = useCallback((): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    const drawWidth = W - PAD_L - PAD_R;
    const cssPerViewBox = rect && rect.width > 0 ? rect.width / W : 1;
    return L / (drawWidth * cssPerViewBox);
  }, [L]);

  /** clientX → موضع على الكمرة بوحدات النموذج */
  const toModelX = useCallback(
    (clientX: number): number => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      const vb = ((clientX - rect.left) / rect.width) * W;
      return xs.invert(vb);
    },
    [xs]
  );

  const drag = useDrag<DragSubject>({
    onBegin: () => {
      snapRef.current = null;
      onDragBegin();
    },
    onMove: (subject, clientX, mods) => {
      const raw = toModelX(clientX);
      const bounds = dragBounds(model, subject);
      const targets = collectSnapTargets(model, subject);
      const result = snapPosition(raw, targets, SNAP_PIXELS * metersPerPixel(), {
        ...bounds,
        grid: GRID_STEP,
        enabled: !mods.free,
      });
      snapRef.current = result;
      onDragMove(subject, result.x);
    },
    onEnd: () => {
      snapRef.current = null;
      onDragEnd();
    },
    onCancel: () => {
      snapRef.current = null;
      onDragCancel();
    },
  });

  const dragging = drag.payload;
  const snap = dragging ? snapRef.current : null;

  const hPoint = (v: number) => (maxP > 0 ? 46 + (34 * Math.abs(v)) / maxP : 46);
  const hDist = (v: number) => (maxW > 0 ? 8 + (32 * Math.abs(v)) / maxW : 8);
  const rMoment = (v: number) => (maxM > 0 ? 12 + (8 * Math.abs(v)) / maxM : 14);

  const isDragged = (sel: Selection, edge?: "from" | "to") =>
    dragging !== null && sameSelection(dragging.sel, sel) && dragging.edge === edge;

  /**
   * مغلّف تفاعلي موحَّد: نقر للتحديد، سحب للإزاحة، أسهم للإزاحة الدقيقة.
   * `movable = false` لحدود البحور: تُحدَّد ولا تُسحب (طولها يُحرَّر رقمياً).
   */
  const handle = (
    sel: Selection,
    label: string,
    children: React.ReactNode,
    opts: { movable?: boolean; edge?: "from" | "to" } = {}
  ) => {
    const movable = opts.movable ?? true;
    const being = isDragged(sel, opts.edge);
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-grabbed={being ? true : undefined}
        className={`outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 ${
          movable ? (being ? "cursor-grabbing" : "cursor-grab") : "cursor-pointer"
        }`}
        onPointerDown={(e) => {
          onSelect(sel);
          if (movable) drag.start(e, { sel, edge: opts.edge });
        }}
        onClick={(e) => {
          e.stopPropagation();
          // نقرة الإفلات بعد سحب مفعَّل لا تُلغي التحديد
          if (drag.consumedClick()) return;
          onSelect(sameSelection(selection, sel) ? null : sel);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(sel);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            onSelect(sel);
            onNudge(sel, -nudgeStep);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onSelect(sel);
            onNudge(sel, nudgeStep);
          }
        }}
      >
        {children}
      </g>
    );
  };

  return (
    <figure className="rounded border bg-white">
      <figcaption className="flex items-baseline justify-between border-b px-3 py-1.5 text-sm">
        <span className="font-semibold">{ar.canvas.title}</span>
        <span className="text-xs text-slate-500">
          {snap ? (
            <span className="text-emerald-700">
              {snap.target ? `التُقط إلى ${snap.target.label}` : `حر عند ${fmt(snap.x)} م`}
            </span>
          ) : (
            <>
              الطول الكلي <span className="num">{fmt(totalLength)}</span> {ar.units.length}
            </>
          )}
        </span>
      </figcaption>

      <svg
        ref={svgRef}
        data-export="beam"
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`${ar.canvas.title}: ${model.spans.length} بحر، ${model.supports.length} مسند، ${model.loads.length} حمل`}
        onPointerMove={(e) => {
          if (!drag.active) onCursorChange(Math.min(Math.max(toModelX(e.clientX), 0), L));
        }}
        onPointerLeave={() => {
          if (!drag.active) onCursorChange(null);
        }}
        onClick={() => {
          if (!drag.consumedClick()) onSelect(null);
        }}
      >
        {/* شبكة الالتقاط — تظهر أثناء السحب فقط لتفادي ضجيج بصري دائم */}
        {dragging && (
          <g pointerEvents="none" aria-hidden="true">
            {Array.from({ length: Math.floor(L / GRID_STEP) + 1 }, (_, i) => i * GRID_STEP)
              .filter((g) => g <= L)
              .map((g) => (
                <line
                  key={g}
                  x1={xs(g)}
                  y1={BEAM_Y - 4}
                  x2={xs(g)}
                  y2={BEAM_Y + 4}
                  stroke="#cbd5e1"
                  strokeWidth={0.6}
                />
              ))}
          </g>
        )}

        {/* ————— الأحمال الموزعة ————— */}
        {model.loads.map((l, i) => {
          if (l.type !== "udl" && l.type !== "linear") return null;
          const sel: Selection = { kind: "load", index: i };
          const x1 = xs(Math.min(Math.max(l.from, 0), L));
          const x2 = xs(Math.min(Math.max(l.to, 0), L));
          const w1 = l.type === "udl" ? l.w : l.w1;
          const w2 = l.type === "udl" ? l.w : l.w2;
          const h1 = hDist(w1);
          const h2 = hDist(w2);
          const topY = BEAM_Y - Math.max(h1, h2);

          const n = Math.max(2, Math.min(9, Math.round((x2 - x1) / 26)));
          const arrows: React.ReactNode[] = [];
          for (let k = 0; k <= n; k++) {
            const t = k / n;
            const ax = x1 + (x2 - x1) * t;
            const wv = w1 + (w2 - w1) * t;
            const ah = h1 + (h2 - h1) * t;
            if (ah < 6) continue;
            arrows.push(
              wv < 0 ? (
                <VArrow key={k} x={ax} from={BEAM_Y - ah} to={BEAM_Y} color={COLOR.dist} width={1} />
              ) : (
                <VArrow key={k} x={ax} from={BEAM_Y} to={BEAM_Y - ah} color={COLOR.dist} width={1} />
              )
            );
          }

          const label =
            l.type === "udl"
              ? `${ar.load.udl} ${fmt(l.w)} ${ar.units.distributed} من ${fmt(l.from)} إلى ${fmt(l.to)} ${ar.units.length}`
              : `${ar.load.linear} من ${fmt(l.w1)} إلى ${fmt(l.w2)} ${ar.units.distributed} بين ${fmt(l.from)} و ${fmt(l.to)} ${ar.units.length}`;

          return (
            <g key={`d${i}`}>
              {handle(
                sel,
                `${label} — اسحب لنقل الحمل كله`,
                <>
                  <polygon
                    points={`${x1},${BEAM_Y} ${x1},${BEAM_Y - h1} ${x2},${BEAM_Y - h2} ${x2},${BEAM_Y}`}
                    fill={COLOR.dist}
                    fillOpacity={0.14}
                    stroke={COLOR.dist}
                    strokeWidth={1.2}
                  />
                  {arrows}
                  <text
                    x={(x1 + x2) / 2}
                    y={topY - 5}
                    textAnchor="middle"
                    fontSize={10}
                    fill={COLOR.dist}
                    direction="ltr"
                    pointerEvents="none"
                  >
                    {l.type === "udl" ? fmt(l.w) : `${fmt(l.w1)} → ${fmt(l.w2)}`}
                  </text>
                </>
              )}

              {/* مقبضا الطرفين — تحرير المدى بلا تحريك الحمل كله */}
              {(["from", "to"] as const).map((edge) => {
                const hx = edge === "from" ? x1 : x2;
                const hh = edge === "from" ? h1 : h2;
                return (
                  <g key={edge}>
                    {handle(
                      sel,
                      `${edge === "from" ? "بداية" : "نهاية"} ${ar.load[l.type]} عند ${fmt(
                        edge === "from" ? l.from : l.to
                      )} ${ar.units.length} — اسحب لتغيير المدى`,
                      <>
                        <line
                          x1={hx}
                          y1={BEAM_Y - Math.max(hh, 10) - 4}
                          x2={hx}
                          y2={BEAM_Y + 4}
                          stroke={COLOR.dist}
                          strokeWidth={isDragged(sel, edge) ? 3 : 2}
                        />
                        <rect
                          x={hx - 3.5}
                          y={BEAM_Y - Math.max(hh, 10) - 9}
                          width={7}
                          height={7}
                          fill="#ffffff"
                          stroke={COLOR.dist}
                          strokeWidth={1.4}
                        />
                        <rect
                          x={hx - 7}
                          y={BEAM_Y - Math.max(hh, 10) - 12}
                          width={14}
                          height={Math.max(hh, 10) + 18}
                          fill="transparent"
                        />
                      </>,
                      { edge }
                    )}
                  </g>
                );
              })}

              {sameSelection(selection, sel) && (
                <Halo x1={x1 - 6} y1={topY - 18} x2={x2 + 6} y2={BEAM_Y + 6} />
              )}
            </g>
          );
        })}

        {/* ————— محور الكمرة ————— */}
        <line
          x1={xs(0)}
          y1={BEAM_Y}
          x2={xs(L)}
          y2={BEAM_Y}
          stroke={COLOR.beam}
          strokeWidth={4}
          strokeLinecap="round"
          pointerEvents="none"
        />

        {/* حدود البحور — تُحدَّد ولا تُسحب: طول البحر يُحرَّر رقمياً */}
        {bounds.slice(1, -1).map((b, i) => {
          const sel: Selection = { kind: "span", index: i };
          return (
            <g key={`b${b}`}>
              {handle(
                sel,
                `حد البحر ${i + 1} عند ${fmt(b)} ${ar.units.length} — الطول يُحرَّر في لوحة الإدخال`,
                <>
                  <line
                    x1={xs(b)}
                    y1={BEAM_Y - 8}
                    x2={xs(b)}
                    y2={BEAM_Y + 8}
                    stroke={COLOR.beam}
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                  <rect x={xs(b) - 6} y={BEAM_Y - 10} width={12} height={20} fill="transparent" />
                </>,
                { movable: false }
              )}
            </g>
          );
        })}

        {/* ————— الأحمال المركزة والعزوم ————— */}
        {model.loads.map((l, i) => {
          if (l.type !== "point" && l.type !== "moment") return null;
          const sel: Selection = { kind: "load", index: i };
          const x = xs(Math.min(Math.max(l.at, 0), L));

          if (l.type === "point") {
            const h = hPoint(l.magnitude);
            const down = l.magnitude < 0;
            const top = BEAM_Y - h;
            return (
              <g key={`p${i}`}>
                {handle(
                  sel,
                  `${ar.load.point} ${fmt(l.magnitude)} ${ar.units.force} عند ${fmt(l.at)} ${ar.units.length}`,
                  <>
                    {down ? (
                      <VArrow x={x} from={top} to={BEAM_Y} color={COLOR.point} width={2} />
                    ) : (
                      <VArrow x={x} from={BEAM_Y} to={top} color={COLOR.point} width={2} />
                    )}
                    <circle
                      cx={x}
                      cy={top - 2}
                      r={isDragged(sel) ? 4.5 : 3.5}
                      fill="#ffffff"
                      stroke={COLOR.point}
                      strokeWidth={1.4}
                    />
                    <text
                      x={x}
                      y={top - 10}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill={COLOR.point}
                      direction="ltr"
                      pointerEvents="none"
                    >
                      {fmt(Math.abs(l.magnitude))}
                    </text>
                    <rect x={x - 10} y={top - 20} width={20} height={h + 22} fill="transparent" />
                  </>
                )}
                {sameSelection(selection, sel) && (
                  <Halo x1={x - 14} y1={top - 24} x2={x + 14} y2={BEAM_Y + 6} />
                )}
              </g>
            );
          }

          // قوس العزم: عكس عقارب الساعة رياضياً = من اليمين فوق القمة إلى اليسار
          // في إحداثيات SVG (المحور y لأسفل)، فيكون sweep-flag = 0.
          // رأس السهم عند نهاية القوس، ومماس القوس هناك رأسي فيتجه الرأس لأسفل.
          const r = rMoment(l.magnitude);
          const ccw = l.magnitude > 0;
          const arc = ccw
            ? `M ${x + r},${BEAM_Y} A ${r},${r} 0 0 0 ${x - r},${BEAM_Y}`
            : `M ${x - r},${BEAM_Y} A ${r},${r} 0 0 1 ${x + r},${BEAM_Y}`;
          const tipX = ccw ? x - r : x + r;
          const head = `${tipX},${BEAM_Y + 7} ${tipX - 4.5},${BEAM_Y - 2} ${tipX + 4.5},${BEAM_Y - 2}`;
          return (
            <g key={`m${i}`}>
              {handle(
                sel,
                `${ar.load.moment} ${fmt(l.magnitude)} ${ar.units.moment} عند ${fmt(l.at)} ${ar.units.length}` +
                  ` (${ccw ? "عكس عقارب الساعة" : "مع عقارب الساعة"})`,
                <>
                  <path
                    d={arc}
                    fill="none"
                    stroke={COLOR.moment}
                    strokeWidth={isDragged(sel) ? 2.6 : 2}
                  />
                  <polygon points={head} fill={COLOR.moment} />
                  <text
                    x={x}
                    y={BEAM_Y - r - 6}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill={COLOR.moment}
                    direction="ltr"
                    pointerEvents="none"
                  >
                    {fmt(Math.abs(l.magnitude))}
                  </text>
                  <rect
                    x={x - r - 5}
                    y={BEAM_Y - r - 16}
                    width={2 * r + 10}
                    height={r + 26}
                    fill="transparent"
                  />
                </>
              )}
              {sameSelection(selection, sel) && (
                <Halo x1={x - r - 8} y1={BEAM_Y - r - 20} x2={x + r + 8} y2={BEAM_Y + 12} />
              )}
            </g>
          );
        })}

        {/* ————— المساند ————— */}
        {model.supports.map((s, i) => {
          const sel: Selection = { kind: "support", index: i };
          const x = xs(Math.min(Math.max(s.at, 0), L));
          const atStart = s.at <= 1e-6;
          const atEnd = Math.abs(s.at - L) <= 1e-6;
          const being = isDragged(sel);

          let symbol: React.ReactNode;
          let bottom = BEAM_Y + 30;

          if (s.type === "fixed") {
            if (atStart || atEnd) {
              const dir = atStart ? -1 : 1;
              const wx = x + dir * 3;
              const hatch: number[] = [];
              for (let k = -14; k <= 14; k += 6) hatch.push(k);
              symbol = (
                <g stroke={COLOR.support} strokeWidth={1}>
                  <line x1={wx} y1={BEAM_Y - 18} x2={wx} y2={BEAM_Y + 18} strokeWidth={2} />
                  {hatch.map((k) => (
                    <line key={k} x1={wx} y1={BEAM_Y + k} x2={wx + dir * 7} y2={BEAM_Y + k + 6} />
                  ))}
                </g>
              );
              bottom = BEAM_Y + 24;
            } else {
              symbol = (
                <g>
                  <rect
                    x={x - 12}
                    y={BEAM_Y}
                    width={24}
                    height={12}
                    fill="none"
                    stroke={COLOR.support}
                    strokeWidth={1.6}
                  />
                  <Ground x={x} y={BEAM_Y + 12} half={14} />
                </g>
              );
              bottom = BEAM_Y + 20;
            }
          } else if (s.type === "spring") {
            const zig: string[] = [`${x},${BEAM_Y}`];
            for (let k = 0; k < 4; k++) {
              zig.push(`${x + (k % 2 === 0 ? 7 : -7)},${BEAM_Y + 4 + k * 4}`);
            }
            zig.push(`${x},${BEAM_Y + 20}`);
            symbol = (
              <g>
                <polyline points={zig.join(" ")} fill="none" stroke={COLOR.support} strokeWidth={1.4} />
                <Ground x={x} y={BEAM_Y + 20} half={12} />
              </g>
            );
            bottom = BEAM_Y + 28;
          } else {
            const tri = `${x},${BEAM_Y} ${x - 9},${BEAM_Y + 15} ${x + 9},${BEAM_Y + 15}`;
            symbol = (
              <g>
                <polygon points={tri} fill="none" stroke={COLOR.support} strokeWidth={1.6} />
                {s.type === "roller" ? (
                  <>
                    <circle cx={x - 5} cy={BEAM_Y + 19} r={3.4} fill="none" stroke={COLOR.support} />
                    <circle cx={x + 5} cy={BEAM_Y + 19} r={3.4} fill="none" stroke={COLOR.support} />
                    <Ground x={x} y={BEAM_Y + 23} />
                  </>
                ) : (
                  <Ground x={x} y={BEAM_Y + 15} />
                )}
              </g>
            );
            bottom = s.type === "roller" ? BEAM_Y + 31 : BEAM_Y + 23;
          }

          const extras: string[] = [];
          if (s.type === "spring" && s.springStiffness !== undefined) {
            extras.push(`جساءة ${fmt(s.springStiffness)} ${ar.units.springStiffness}`);
          }
          if (s.settlement) extras.push(`هبوط ${fmt(s.settlement * 1000, 4)} ${ar.units.mm}`);

          return (
            <g key={`s${i}`} opacity={being ? 0.75 : 1}>
              {handle(
                sel,
                `${ar.support[s.type]} عند ${fmt(s.at)} ${ar.units.length}` +
                  (extras.length > 0 ? ` — ${extras.join("، ")}` : ""),
                <>
                  {symbol}
                  <rect
                    x={x - 15}
                    y={BEAM_Y - 4}
                    width={30}
                    height={bottom - BEAM_Y + 6}
                    fill="transparent"
                  />
                </>
              )}
              {sameSelection(selection, sel) && (
                <Halo x1={x - 18} y1={BEAM_Y - 8} x2={x + 18} y2={bottom + 4} />
              )}
            </g>
          );
        })}

        {/* ————— المفاصل الداخلية ————— */}
        {(model.hinges ?? []).map((h, i) => {
          const sel: Selection = { kind: "hinge", index: i };
          const x = xs(Math.min(Math.max(h.at, 0), L));
          return (
            <g key={`h${i}`}>
              {handle(
                sel,
                `مفصل داخلي عند ${fmt(h.at)} ${ar.units.length}`,
                <>
                  <circle
                    cx={x}
                    cy={BEAM_Y}
                    r={isDragged(sel) ? 6 : 5}
                    fill="#ffffff"
                    stroke={COLOR.hinge}
                    strokeWidth={2}
                  />
                  <rect x={x - 10} y={BEAM_Y - 10} width={20} height={20} fill="transparent" />
                </>
              )}
              {sameSelection(selection, sel) && (
                <Halo x1={x - 12} y1={BEAM_Y - 12} x2={x + 12} y2={BEAM_Y + 12} />
              )}
            </g>
          );
        })}

        {/* ————— دليل الالتقاط ————— */}
        {snap && (
          <g pointerEvents="none" data-transient>
            <line
              x1={xs(snap.x)}
              y1={16}
              x2={xs(snap.x)}
              y2={DIM_Y - 6}
              stroke={snap.target ? COLOR.snap : COLOR.dim}
              strokeWidth={snap.target ? 1.4 : 1}
              strokeDasharray={snap.target ? undefined : "3 3"}
            />
            <rect
              x={xs(snap.x) - 26}
              y={16}
              width={52}
              height={15}
              rx={3}
              fill={snap.target ? COLOR.snap : COLOR.dim}
            />
            <text
              x={xs(snap.x)}
              y={27}
              textAnchor="middle"
              fontSize={10}
              fill="#ffffff"
              direction="ltr"
            >
              {fmt(snap.x)} m
            </text>
          </g>
        )}

        {/* ————— خط الأبعاد ————— */}
        <g pointerEvents="none" aria-hidden="true">
          {bounds.slice(0, -1).map((b, i) => {
            const x1 = xs(b);
            const x2 = xs(bounds[i + 1]);
            return (
              <g key={`dim${i}`} stroke={COLOR.dim} strokeWidth={1}>
                <line x1={x1} y1={DIM_Y} x2={x2} y2={DIM_Y} />
                <line x1={x1} y1={DIM_Y - 4} x2={x1} y2={DIM_Y + 4} />
                <line x1={x2} y1={DIM_Y - 4} x2={x2} y2={DIM_Y + 4} />
                <text
                  x={(x1 + x2) / 2}
                  y={DIM_Y - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill={COLOR.dim}
                  stroke="none"
                  direction="ltr"
                >
                  {fmt(model.spans[i].length)}
                </text>
              </g>
            );
          })}
          {model.supports.map((s, i) => (
            <text
              key={`sl${i}`}
              x={xs(Math.min(Math.max(s.at, 0), L))}
              y={DIM_Y + 18}
              textAnchor="middle"
              fontSize={9}
              fill={COLOR.dim}
              direction="ltr"
            >
              {fmt(s.at)}
            </text>
          ))}
        </g>

        {/* ————— المؤشر المتزامن ————— */}
        {cursorX !== null && !dragging && (
          <line
            data-transient
            x1={xs(cursorX)}
            y1={16}
            x2={xs(cursorX)}
            y2={DIM_Y - 12}
            stroke={COLOR.cursor}
            strokeWidth={1}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
      </svg>

      <p className="border-t px-3 py-1.5 text-xs text-slate-500">{ar.canvas.hint}</p>
    </figure>
  );
}
