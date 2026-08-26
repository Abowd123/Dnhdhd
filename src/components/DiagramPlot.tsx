// DiagramPlot.tsx — مخطط SVG واحد (قص أو عزوم) مع مؤشر متزامن.
//
// منطقة الرسم LTR داخل واجهة RTL: المخططات الإنشائية تُقرأ من اليسار لليمين
// عالمياً، والانعكاس يقتصر على النصوص والقوائم.
//
// إمكانية الوصول: العنصر قابل للتحويم والتركيز، والأسهم تحرّك المؤشر — لا
// يُعتمد على الفأرة وحدها ولا على اللون وحده (كل مخطط له عنوانه ووحدته).

import { scaleLinear } from "d3-scale";
import { useId, useMemo } from "react";

export interface PlotSeriesPoint {
  x: number;
  y: number;
}

interface Props {
  title: string;
  unit: string;
  points: PlotSeriesPoint[];
  totalLength: number;
  color: string;
  /** رسم القيم الموجبة لأسفل — عرف رسم العزوم على جهة الشد */
  invertY?: boolean;
  cursorX: number | null;
  onCursorChange: (x: number | null) => void;
  height?: number;
  /** مواضع تُعلَّم على المحور: مساند، نقاط انعدام العزم */
  markers?: { x: number; label: string }[];
  exportId?: string;
}

const M = { top: 18, right: 16, bottom: 26, left: 56 };

export default function DiagramPlot({
  title,
  unit,
  points,
  totalLength,
  color,
  invertY = false,
  cursorX,
  onCursorChange,
  height = 160,
  markers = [],
  exportId,
}: Props) {
  const width = 900;
  const titleId = useId();

  const { path, area, yScale, xScale, yMax } = useMemo(() => {
    const xs = scaleLinear().domain([0, totalLength]).range([M.left, width - M.right]);
    let peak = 0;
    for (const p of points) peak = Math.max(peak, Math.abs(p.y));
    if (peak === 0) peak = 1;
    const pad = peak * 1.12;
    const ys = scaleLinear()
      .domain(invertY ? [-pad, pad] : [pad, -pad])
      .range([M.top, height - M.bottom]);

    const line = points.map((p) => `${xs(p.x).toFixed(2)},${ys(p.y).toFixed(2)}`).join(" ");
    const base = ys(0).toFixed(2);
    const first = points.length > 0 ? xs(points[0].x).toFixed(2) : "0";
    const last = points.length > 0 ? xs(points[points.length - 1].x).toFixed(2) : "0";

    return {
      xScale: xs,
      yScale: ys,
      yMax: peak,
      path: line,
      area: points.length > 1 ? `M ${first},${base} L ${line} L ${last},${base} Z` : "",
    };
  }, [points, totalLength, invertY, height]);

  const fromEvent = (clientX: number, rect: DOMRect): number => {
    const px = clientX - rect.left;
    const x = xScale.invert((px / rect.width) * width);
    return Math.min(Math.max(x, 0), totalLength);
  };

  const step = totalLength / 200;

  return (
    <figure className="rounded border bg-white">
      <figcaption
        id={titleId}
        className="flex items-baseline justify-between border-b px-3 py-1.5 text-sm"
      >
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-slate-500">
          الأقصى <span className="num">{Number(yMax.toFixed(3))}</span> {unit}
        </span>
      </figcaption>

      <svg
        data-export={exportId}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        role="img"
        aria-labelledby={titleId}
        tabIndex={0}
        onMouseMove={(e) => onCursorChange(fromEvent(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onMouseLeave={() => onCursorChange(null)}
        onKeyDown={(e) => {
          const base = cursorX ?? 0;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onCursorChange(Math.max(0, base - step));
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onCursorChange(Math.min(totalLength, base + step));
          } else if (e.key === "Home") {
            e.preventDefault();
            onCursorChange(0);
          } else if (e.key === "End") {
            e.preventDefault();
            onCursorChange(totalLength);
          } else if (e.key === "Escape") {
            onCursorChange(null);
          }
        }}
      >
        {/* محور القيم الصفرية = محور الكمرة */}
        <line
          x1={M.left}
          x2={width - M.right}
          y1={yScale(0)}
          y2={yScale(0)}
          stroke="#334155"
          strokeWidth={1.5}
        />

        {[yMax, -yMax].map((v) => (
          <g key={v}>
            <line
              x1={M.left}
              x2={width - M.right}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke="#e2e8f0"
              strokeDasharray="3 3"
            />
            <text
              x={M.left - 6}
              y={yScale(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill="#64748b"
              direction="ltr"
            >
              {Number(v.toFixed(2))}
            </text>
          </g>
        ))}

        {area && <path d={area} fill={color} fillOpacity={0.16} />}
        {path && <polyline points={path} fill="none" stroke={color} strokeWidth={1.8} />}

        {markers.map((mk, i) => (
          <g key={`${mk.x}-${i}`}>
            <line
              x1={xScale(mk.x)}
              x2={xScale(mk.x)}
              y1={yScale(0) - 5}
              y2={yScale(0) + 5}
              stroke="#0f172a"
              strokeWidth={1}
            />
            <text
              x={xScale(mk.x)}
              y={height - 10}
              textAnchor="middle"
              fontSize={9}
              fill="#64748b"
              direction="ltr"
            >
              {mk.label}
            </text>
          </g>
        ))}

        {cursorX !== null && (
          <line
            x1={xScale(cursorX)}
            x2={xScale(cursorX)}
            y1={M.top}
            y2={height - M.bottom}
            stroke="#dc2626"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
      </svg>
    </figure>
  );
}
