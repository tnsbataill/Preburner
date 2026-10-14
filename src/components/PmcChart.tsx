import { useRef, useState } from 'react';
import { diffDays, formatDate } from '../engine/time';
import type { DateKey, FitnessPoint } from '../engine/types';

/** Fitness (CTL), fatigue (ATL), form (TSB) — history solid, projection dashed. */
export function PmcChart({ points, today, event }: { points: FitnessPoint[]; today: DateKey; event?: { date: DateKey; name?: string; targetCtl?: number } }) {
  const W = 720;
  const H = 260;
  const P = { l: 34, r: 14, t: 14, b: 26 };
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<FitnessPoint | null>(null);
  if (points.length < 2) return null;

  const start = points[0].date;
  const n = diffDays(start, points.at(-1)!.date);
  const maxY = Math.ceil(Math.max(...points.map((p) => Math.max(p.ctl, p.atl)), event?.targetCtl ?? 0) / 10) * 10 + 10;
  const minY = Math.floor(Math.min(...points.map((p) => p.tsb), -10) / 10) * 10;
  const x = (d: DateKey) => P.l + (diffDays(start, d) / n) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - minY) / (maxY - minY)) * (H - P.t - P.b);
  const path = (key: 'ctl' | 'atl' | 'tsb', projected: boolean) => {
    const pts = points.filter((p) => p.projected === projected || (projected && p.date === today));
    return pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  };
  const barW = Math.max(1.5, (W - P.l - P.r) / n - 1.5);
  const maxLoad = Math.max(...points.map((p) => p.load), 1);
  const shown = hover ?? points.find((p) => p.date === today) ?? points.at(-1)!;

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const frac = (e.clientX - r.left) / r.width;
    const idx = Math.round(((frac * W - P.l) / (W - P.l - P.r)) * n);
    setHover(points[Math.max(0, Math.min(points.length - 1, idx))]);
  };

  const ticks = [minY, 0, Math.round(maxY / 2 / 10) * 10, maxY].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="text-xs text-muted">{hover ? formatDate(hover.date, { weekday: true }) : 'Today'}</div>
        <Legend color="rgb(var(--protein))" label="Fitness" value={shown.ctl} />
        <Legend color="rgb(var(--fat))" label="Fatigue" value={shown.atl} />
        <Legend color={shown.tsb >= 0 ? 'rgb(var(--good))' : 'rgb(var(--warn))'} label="Form" value={shown.tsb} signed />
        {shown.projected && <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] text-muted">projected from plan</span>}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <rect x={x(today)} y={P.t} width={W - P.r - x(today)} height={H - P.t - P.b} fill="rgb(var(--raised))" opacity={0.5} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeDasharray={t === 0 ? undefined : '2 4'} />
            <text x={P.l - 6} y={y(t) + 3} fontSize={10} textAnchor="end" fill="rgb(var(--faint))">
              {t}
            </text>
          </g>
        ))}
        {/* optimal form band for racing */}
        <rect x={P.l} y={y(25)} width={W - P.l - P.r} height={y(5) - y(25)} fill="rgb(var(--good))" opacity={0.05} />
        {points.map((p) =>
          p.load > 0 ? (
            <rect key={p.date} x={x(p.date) - barW / 2} y={H - P.b - (p.load / maxLoad) * 40} width={barW} height={(p.load / maxLoad) * 40} rx={1} fill="rgb(var(--ember))" opacity={p.projected ? 0.25 : 0.4} />
          ) : null,
        )}
        <path d={path('tsb', false)} fill="none" stroke="rgb(var(--good))" strokeWidth={1.5} opacity={0.9} />
        <path d={path('tsb', true)} fill="none" stroke="rgb(var(--good))" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.9} />
        <path d={path('atl', false)} fill="none" stroke="rgb(var(--fat))" strokeWidth={1.5} opacity={0.8} />
        <path d={path('atl', true)} fill="none" stroke="rgb(var(--fat))" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.8} />
        <path d={path('ctl', false)} fill="none" stroke="rgb(var(--protein))" strokeWidth={2.5} />
        <path d={path('ctl', true)} fill="none" stroke="rgb(var(--protein))" strokeWidth={2.5} strokeDasharray="6 4" />
        {event && event.date >= start && (
          <g>
            <line x1={x(event.date)} x2={x(event.date)} y1={P.t} y2={H - P.b} stroke="rgb(var(--i-race))" strokeWidth={1.5} />
            <text x={x(event.date) - 4} y={P.t + 10} fontSize={10} textAnchor="end" fill="rgb(var(--i-race))">
              {event.name ?? 'Event'}
            </text>
            {event.targetCtl && <circle cx={x(event.date)} cy={y(event.targetCtl)} r={5} fill="none" stroke="rgb(var(--i-race))" strokeWidth={2} />}
          </g>
        )}
        {hover && <line x1={x(hover.date)} x2={x(hover.date)} y1={P.t} y2={H - P.b} stroke="rgb(var(--ink))" strokeOpacity={0.35} />}
        <text x={P.l} y={H - 8} fontSize={10} fill="rgb(var(--faint))">
          {formatDate(start)}
        </text>
        <text x={x(today)} y={H - 8} fontSize={10} textAnchor="middle" fill="rgb(var(--faint))">
          today
        </text>
        <text x={W - P.r} y={H - 8} fontSize={10} textAnchor="end" fill="rgb(var(--faint))">
          {formatDate(points.at(-1)!.date)}
        </text>
      </svg>
    </div>
  );
}

function Legend({ color, label, value, signed }: { color: string; label: string; value: number; signed?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="num text-xl font-semibold" style={{ color }}>
        {signed && value > 0 ? '+' : ''}
        {Math.round(value)}
      </div>
    </div>
  );
}
