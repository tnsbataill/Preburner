import type { WorkoutStep } from '../engine/types';
import { cx } from '../ui/primitives';

// A structured workout at a glance: each step as a block, width = time,
// height = %FTP, coloured by zone with the app's intensity colours. Ramps
// (warm-ups, cool-downs) slope from their start to their end power.

const ZONES: Array<[maxFtp: number, color: string]> = [
  [0.56, 'rgb(var(--i-recovery))'],
  [0.76, 'rgb(var(--i-endurance))'],
  [0.91, 'rgb(var(--i-tempo))'],
  [1.05, 'rgb(var(--i-threshold))'],
  [1.2, 'rgb(var(--i-vo2))'],
  [Infinity, 'rgb(var(--i-race))'],
];
const zoneColor = (ftp: number) => ZONES.find(([max]) => ftp < max)![1];

const H = 100;

export function WorkoutProfile({ steps, className, ftpLine = true }: { steps?: WorkoutStep[]; className?: string; ftpLine?: boolean }) {
  if (!steps?.length) return null;
  const total = steps.reduce((s, x) => s + x.durationS, 0);
  if (total <= 0) return null;
  const top = Math.max(1.25, ...steps.map((s) => Math.max(s.lo, s.hi)));
  const y = (ftp: number) => H - (Math.max(0, ftp) / top) * H;
  const peak = Math.round(Math.max(...steps.map((s) => Math.max(s.lo, s.hi))) * 100);
  const efforts = steps.filter((s) => (s.lo + s.hi) / 2 >= 0.88).length;
  let t = 0;
  return (
    <svg
      viewBox={`0 0 ${total} ${H}`}
      preserveAspectRatio="none"
      className={cx('block', className)}
      role="img"
      aria-label={`Workout profile: ${Math.round(total / 60)} min${efforts ? `, ${efforts} hard ${efforts === 1 ? 'effort' : 'efforts'}` : ''}, peak ${peak}% FTP`}
      data-testid="workout-profile"
    >
      {steps.map((s, i) => {
        const x0 = t;
        t += s.durationS;
        const color = zoneColor((s.lo + s.hi) / 2);
        return <polygon key={i} points={`${x0},${H} ${x0},${y(s.lo)} ${t},${y(s.hi)} ${t},${H}`} fill={color} fillOpacity={0.85} />;
      })}
      {ftpLine && <line x1={0} x2={total} y1={y(1)} y2={y(1)} stroke="rgb(var(--ink))" strokeOpacity={0.25} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" strokeWidth={1} />}
    </svg>
  );
}
