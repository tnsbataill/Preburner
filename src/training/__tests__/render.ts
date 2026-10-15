import { formatDuration, weekdayShort } from '../../engine/time';
import type { TrainingPlan } from '../types';

/** Readable text rendering of a plan, used by golden tests. */
export function renderPlan(plan: TrainingPlan): string {
  const r = plan.request;
  const lines = [
    `${r.weeks}-week ${r.objective} plan from ${r.start} | FTP ${r.ftp} | CTL ${r.ctl} | ramp cap ${r.maxRampPerWeek}/wk`,
    `genome ${JSON.stringify(plan.genome)}`,
    '',
  ];
  for (const w of plan.weeks) {
    lines.push(`W${w.index + 1} ${w.start} ${w.phase.padEnd(8)} target ${w.targetTss} TSS, planned ${w.plannedTss} TSS, ${w.hours} h, ${w.hardSessions} hard${w.availabilityLimited ? ' (availability-limited)' : ''}`);
    for (const s of plan.sessions.filter((x) => x.date >= w.start && x.date < (plan.weeks[w.index + 1]?.start ?? '9999'))) {
      lines.push(`  ${weekdayShort(s.date)} ${s.date}  ${formatDuration(s.durationMin).padEnd(7)} TSS ${String(s.tss).padStart(3)}  IF ${s.ifactor.toFixed(2)}  ${s.hard ? '*' : ' '} ${s.title}`);
    }
  }
  return lines.join('\n');
}
