import type { DayLoadClass, Intensity, SlotKind } from '../engine/types';

export const LB_PER_KG = 2.20462;

export function fmtWeight(kg: number, units: 'metric' | 'imperial', digits = 1): string {
  return units === 'imperial' ? `${(kg * LB_PER_KG).toFixed(digits)} lb` : `${kg.toFixed(digits)} kg`;
}

export function fmtRate(kgPerWeek: number, units: 'metric' | 'imperial'): string {
  const v = units === 'imperial' ? kgPerWeek * LB_PER_KG : kgPerWeek;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
  return `${sign}${Math.abs(v).toFixed(2)} ${units === 'imperial' ? 'lb' : 'kg'}/wk`;
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString();

export const INTENSITY_COLOR: Record<Intensity, string> = {
  Recovery: 'rgb(var(--i-recovery))',
  Endurance: 'rgb(var(--i-endurance))',
  Tempo: 'rgb(var(--i-tempo))',
  Threshold: 'rgb(var(--i-threshold))',
  VO2: 'rgb(var(--i-vo2))',
  Race: 'rgb(var(--i-race))',
};

export const LOAD_LABEL: Record<DayLoadClass, string> = {
  rest: 'Rest day',
  light: 'Light day',
  moderate: 'Moderate day',
  high: 'Big day',
  'very-high': 'Very big day',
};

export const SLOT_ACCENT: Record<SlotKind, string> = {
  breakfast: 'rgb(var(--muted))',
  lunch: 'rgb(var(--muted))',
  dinner: 'rgb(var(--muted))',
  snack: 'rgb(var(--faint))',
  'pre-meal': 'rgb(var(--carb))',
  'pre-snack': 'rgb(var(--carb))',
  during: 'rgb(var(--ember))',
  recovery: 'rgb(var(--protein))',
  'pre-sleep': 'rgb(var(--fat))',
};
