import { formatClock, formatDuration } from '../time';
import type { DayPlan } from '../types';

/** Human-readable rendering used for golden files — diffs read like a meal plan. */
export function renderDay(d: DayPlan): string {
  const lines: string[] = [];
  lines.push(`${d.date} [${d.loadClass} → tomorrow ${d.nextLoadClass}]${d.protectedDay ? ' PROTECTED' : ''}`);
  lines.push(
    `  energy: tdee ${d.energy.tdee} (bmr ${d.energy.bmr} + neat ${d.energy.neat} + ex ${d.energy.exercise}) target ${d.energy.target} deficit ${d.energy.deficit} EA ${d.energy.energyAvailability}`,
  );
  lines.push(`  macros: C ${d.macros.carbG}g (${d.carbGPerKg} g/kg)  P ${d.macros.proteinG}g  F ${d.macros.fatG}g`);
  for (const w of d.workouts) {
    lines.push(
      `  workout: ${formatClock(w.resolvedStartMin)}${w.timeAssumed ? '?' : ''} ${w.title} ${formatDuration(w.durationMin)} ${w.intensity} IF ${w.ifactor.toFixed(2)} ${w.kj}kJ load ${w.load}`,
    );
  }
  for (const s of d.slots) {
    const t = s.endMin ? `${formatClock(s.startMin)}–${formatClock(s.endMin)}` : formatClock(s.startMin);
    const f = s.fueling ? `  [${s.fueling.carbPerHour} g/h, ${s.fueling.fluidMlPerHour} ml/h, ${s.fueling.sodiumMgPerHour} mg Na/h]` : '';
    lines.push(`    ${t.padEnd(16)} ${s.label.padEnd(34)} C${String(s.macros.carbG).padStart(4)} P${String(s.macros.proteinG).padStart(4)} F${String(s.macros.fatG).padStart(4)} ${String(s.kcal).padStart(5)}kcal${f}`);
  }
  for (const f of d.flags) lines.push(`  ! ${f.level}: ${f.code}`);
  return lines.join('\n');
}
