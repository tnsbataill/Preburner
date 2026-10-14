import { useMemo, useRef, useState } from 'react';
import { formatClock } from '../engine/time';
import type { DayPlan, GlycogenPoint } from '../engine/types';
import { INTENSITY_COLOR } from '../ui/format';

/** Estimated fuel tank (muscle + liver glycogen) across one day. */
export function GlycogenChart({ points, day, nowMin }: { points: GlycogenPoint[]; day: DayPlan; nowMin?: number }) {
  const W = 340;
  const H = 120;
  const PAD = { l: 4, r: 4, t: 10, b: 18 };
  const data = useMemo(() => points.filter((p) => p.date === day.date), [points, day.date]);
  const [hover, setHover] = useState<GlycogenPoint | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (data.length < 2) return null;

  const x = (min: number) => PAD.l + (min / 1440) * (W - PAD.l - PAD.r);
  const y = (pct: number) => PAD.t + (1 - pct) * (H - PAD.t - PAD.b);
  const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(p.min).toFixed(1)},${y(p.pct).toFixed(1)}`).join('');
  const area = `${line}L${x(data.at(-1)!.min)},${y(0)}L${x(data[0].min)},${y(0)}Z`;
  const low = data.reduce((m, p) => (p.pct < m.pct ? p : m), data[0]);
  const shown = hover ?? (nowMin !== undefined ? [...data].reverse().find((p) => p.min <= nowMin) ?? data[0] : low);

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const min = ((e.clientX - r.left) / r.width) * 1440;
    setHover(data.reduce((best, p) => (Math.abs(p.min - min) < Math.abs(best.min - min) ? p : best), data[0]));
  };

  const tone = (pct: number) => (pct < 0.35 ? 'text-bad' : pct < 0.55 ? 'text-warn' : 'text-good');

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <span className={`num text-2xl font-semibold ${tone(shown.pct)}`}>{Math.round(shown.pct * 100)}%</span>
          <span className="ml-2 text-xs text-muted">
            {hover ? `at ${formatClock(hover.min)}` : nowMin !== undefined ? 'now' : `low at ${formatClock(low.min)}`}
          </span>
        </div>
        <div className="num text-right text-[11px] text-muted">
          muscle {shown.muscle} g · liver {shown.liver} g
        </div>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="tankFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--amber))" stopOpacity="0.45" />
            <stop offset="100%" stopColor="rgb(var(--ember))" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="rgb(var(--line))" strokeDasharray="2 4" />
        ))}
        {day.workouts.map((w) => (
          <rect
            key={w.id}
            x={x(w.resolvedStartMin)}
            y={PAD.t}
            width={Math.max(2, x(w.resolvedStartMin + w.durationMin) - x(w.resolvedStartMin))}
            height={H - PAD.t - PAD.b}
            fill={INTENSITY_COLOR[w.intensity]}
            opacity={0.12}
            rx={3}
          />
        ))}
        <path d={area} fill="url(#tankFill)" />
        <path d={line} fill="none" stroke="rgb(var(--ember))" strokeWidth={2} strokeLinejoin="round" />
        {day.slots
          .filter((s) => s.kind !== 'during')
          .map((s) => (
            <circle key={s.id} cx={x(s.startMin)} cy={H - PAD.b + 6} r={2.5} fill="rgb(var(--carb))" />
          ))}
        {nowMin !== undefined && <line x1={x(nowMin)} x2={x(nowMin)} y1={PAD.t - 4} y2={H - PAD.b} stroke="rgb(var(--ink))" strokeOpacity={0.5} strokeDasharray="3 3" />}
        {hover && <circle cx={x(hover.min)} cy={y(hover.pct)} r={4} fill="rgb(var(--surface))" stroke="rgb(var(--ember))" strokeWidth={2} />}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} x={x(h * 60) + 2} y={H - 1} fontSize={9} fill="rgb(var(--faint))">
            {formatClock(h * 60)}
          </text>
        ))}
      </svg>
      <p className="mt-1 text-[11px] leading-snug text-faint">Modelled estimate from planned work and meals — a readiness guide, not a measurement.</p>
    </div>
  );
}
