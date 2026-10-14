import { describe, expect, it } from 'vitest';
import { describePlannerNote } from '../noteFormatting.js';
import {
  DEFICIT_APPLIED_NOTE_PREFIX,
  DEFICIT_MAXED_NOTE_PREFIX,
  WINDOW_EMPTY_FLAG,
  WINDOW_UNDER_RECOVERY_FLAG,
} from '../weekly.js';

const formatNumber = (value: number, fractionDigits = 0) => value.toFixed(fractionDigits);

describe('describePlannerNote', () => {
  it('formats under recovery payloads with context', () => {
    const note = `${WINDOW_UNDER_RECOVERY_FLAG}:0.450:0.140:0.590`;
    expect(describePlannerNote(note, formatNumber)).toBe(
      'Recent weight change 0.59 kg vs target 0.14 kg (extra 0.45 kg). Deficit paused this window to prioritise recovery.',
    );
  });

  it('falls back for recovery notes without payload', () => {
    expect(describePlannerNote(WINDOW_UNDER_RECOVERY_FLAG, formatNumber)).toContain('Weight loss exceeding target');
  });

  it('handles deficit notes', () => {
    expect(describePlannerNote(`${DEFICIT_APPLIED_NOTE_PREFIX}345`, formatNumber)).toBe(
      'Planned deficit in this window: 345 kcal.',
    );
    expect(describePlannerNote(`${DEFICIT_MAXED_NOTE_PREFIX}600:1200`, formatNumber)).toContain('Weekly target still short');
  });

  it('returns other notes unchanged', () => {
    expect(describePlannerNote(WINDOW_EMPTY_FLAG, formatNumber)).toContain('>1 kg overnight');
    expect(describePlannerNote('Custom note', formatNumber)).toBe('Custom note');
  });
});
