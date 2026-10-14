import {
  DEFICIT_APPLIED_NOTE_PREFIX,
  DEFICIT_MAXED_NOTE_PREFIX,
  WINDOW_EMPTY_FLAG,
  WINDOW_UNDER_RECOVERY_FLAG,
} from './weekly.js';

export type PlannerNoteNumberFormatter = (value: number, fractionDigits?: number) => string;

export function describePlannerNote(
  note: string,
  formatNumber: PlannerNoteNumberFormatter,
): string {
  if (note === WINDOW_EMPTY_FLAG) {
    return 'Safety flag: >1 kg overnight drop detected — deficit halved for this window.';
  }
  if (note.startsWith(`${WINDOW_UNDER_RECOVERY_FLAG}:`)) {
    const payload = note.slice(WINDOW_UNDER_RECOVERY_FLAG.length + 1).split(':');
    const diff = Number.parseFloat(payload[0] ?? '');
    const expected = Number.parseFloat(payload[1] ?? '');
    const actual = Number.parseFloat(payload[2] ?? '');
    if (Number.isFinite(diff) && Number.isFinite(expected) && Number.isFinite(actual)) {
      return `Recent weight change ${formatNumber(actual, 2)} kg vs target ${formatNumber(expected, 2)} kg (extra ${formatNumber(diff, 2)} kg). Deficit paused this window to prioritise recovery.`;
    }
    return 'Weight loss trend significantly exceeds target — deficit paused this window to prioritise recovery.';
  }
  if (note === WINDOW_UNDER_RECOVERY_FLAG) {
    return 'Safety flag: Weight loss exceeding target — deficit paused this window to prioritise recovery.';
  }
  if (note.startsWith(DEFICIT_APPLIED_NOTE_PREFIX)) {
    const appliedRaw = note.slice(DEFICIT_APPLIED_NOTE_PREFIX.length);
    const applied = Number.parseFloat(appliedRaw);
    if (Number.isFinite(applied) && applied > 0) {
      return `Planned deficit in this window: ${formatNumber(applied, 0)} kcal.`;
    }
    return 'Planned deficit scheduled for this window.';
  }
  if (note.startsWith(DEFICIT_MAXED_NOTE_PREFIX)) {
    const payload = note.slice(DEFICIT_MAXED_NOTE_PREFIX.length).split(':');
    const applied = Number.parseFloat(payload[0] ?? '');
    const carry = Number.parseFloat(payload[1] ?? '');
    const parts: string[] = [];
    if (Number.isFinite(applied) && applied > 0) {
      parts.push(`Max safe deficit reached here: ${formatNumber(applied, 0)} kcal.`);
    }
    if (Number.isFinite(carry) && carry > 0) {
      parts.push(`Weekly target still short by ${formatNumber(carry, 0)} kcal.`);
    }
    if (parts.length > 0) {
      return parts.join(' ');
    }
    return 'Weekly deficit target remains unmet.';
  }
  return note;
}
