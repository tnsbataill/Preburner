import { addDays, diffDays, formatDate } from '../engine/time';
import type { DateKey } from '../engine/types';
import { LB_PER_KG } from '../ui/format';

/** Scale weights (dots), smoothed trend (line), and the goal path (dashed). */
export function WeightChart({
  trend,
  today,
  units,
  goal,
  rateKg,
}: {
  trend: Array<{ date: DateKey; kg: number; trend: number }>;
  today: DateKey;
  units: 'metric' | 'imperial';
  goal?: { date?: DateKey; kg?: number };
  rateKg: number;
}) {
  const W = 640;
  const H = 200;
  const P = { l: 36, r: 12, t: 12, b: 22 };
  const recent = trend.filter((t) => diffDays(t.date, today) <= 56);
  if (recent.length < 2) return <div className="py-10 text-center text-sm text-muted">Log a few morning weigh-ins to see your trend.</div>;

  const conv = (kg: number) => (units === 'imperial' ? kg * LB_PER_KG : kg);
  const start = recent[0].date;
  const horizon = goal?.date && goal.date > today ? (diffDays(today, goal.date) > 84 ? addDays(today, 84) : goal.date) : addDays(today, 28);
  const totalDays = diffDays(start, horizon);
  const last = recent.at(-1)!;
  const projEnd = last.trend + (rateKg / 7) * diffDays(last.date, horizon);
  const values = [...recent.flatMap((t) => [t.kg, t.trend]), projEnd, ...(goal?.kg ? [goal.kg] : [])].map(conv);
  const lo = Math.floor(Math.min(...values) - 0.5);
  const hi = Math.ceil(Math.max(...values) + 0.5);
  const x = (d: DateKey) => P.l + (diffDays(start, d) / totalDays) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (conv(v) - lo) / (hi - lo)) * (H - P.t - P.b);
  const line = recent.map((t, i) => `${i ? 'L' : 'M'}${x(t.date).toFixed(1)},${y(t.trend).toFixed(1)}`).join('');
  const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3);
  const unit = units === 'imperial' ? 'lb' : 'kg';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {ticks.map((t) => {
        const yy = P.t + (1 - (t - lo) / (hi - lo)) * (H - P.t - P.b);
        return (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={yy} y2={yy} stroke="rgb(var(--line))" strokeDasharray="2 4" />
            <text x={P.l - 6} y={yy + 3} fontSize={10} textAnchor="end" fill="rgb(var(--faint))" className="num">
              {t.toFixed(0)}
            </text>
          </g>
        );
      })}
      <text x={P.l - 6} y={H - P.b + 14} fontSize={9} textAnchor="end" fill="rgb(var(--faint))">
        {unit}
      </text>
      <line x1={x(today)} x2={x(today)} y1={P.t} y2={H - P.b} stroke="rgb(var(--ink))" strokeOpacity={0.25} />
      {recent.map((t) => (
        <circle key={t.date} cx={x(t.date)} cy={y(t.kg)} r={2.4} fill="rgb(var(--faint))" />
      ))}
      <path d={line} fill="none" stroke="rgb(var(--ember))" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={x(last.date)} y1={y(last.trend)} x2={x(horizon)} y2={y(projEnd)} stroke="rgb(var(--ember))" strokeWidth={1.5} strokeDasharray="5 5" opacity={0.7} />
      {goal?.kg && goal.date && goal.date <= horizon && (
        <g>
          <circle cx={x(goal.date)} cy={y(goal.kg)} r={5} fill="none" stroke="rgb(var(--good))" strokeWidth={2} />
          <text x={x(goal.date) - 8} y={y(goal.kg) - 9} fontSize={10} textAnchor="end" fill="rgb(var(--good))">
            goal
          </text>
        </g>
      )}
      {[start, today, horizon].map((d, i) => (
        <text key={d + i} x={x(d)} y={H - 6} fontSize={10} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fill="rgb(var(--faint))">
          {i === 1 ? 'today' : formatDate(d)}
        </text>
      ))}
    </svg>
  );
}
