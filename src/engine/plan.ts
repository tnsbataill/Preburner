import { fatFreeMassKg, grossExerciseKcal, isHard, netExerciseKcal, restingKcal } from './energy';
import { CARB_BANDS, dailyCarbGrams, loadClassFor, maxClass } from './fueling';
import { allocateDeficit, resolveWeeklyRate, weeklyEnergyDelta } from './goals';
import { simulateGlycogen } from './glycogen';
import { planDaySlots, resolveWorkoutTimes } from './scheduler';
import { addDays, dateRange, diffDays, weekStartOf, weekdayOf } from './time';
import type { DateKey, DayLoadClass, DayPlan, Plan, PlanFlag, Settings, WeekSummary, Workout } from './types';

// Energy availability floors (kcal per kg fat-free mass). 30 is the classic
// female threshold (Loucks 2011). No male threshold is established: Koehler
// 2016 saw hormonal effects at 15 vs 40, and later reviews suggest 9–25, so 25
// is the cautious end. The IOC REDs consensus (2023) treats low EA as a
// spectrum, so this is a guard rail, not a cliff edge.
const EA_FLOOR = { M: 25, F: 30 } as const;

export interface BuildPlanInput {
  settings: Settings;
  workouts: Workout[];
  start: DateKey;
  days: number;
  today: DateKey;
  /** latest trend weight, falls back to profile weight */
  currentWeightKg?: number;
}

const isRaceEvent = (w: Workout) => w.intensity === 'Race' || /^RACE_/.test(w.category ?? '');

export function buildPlan(input: BuildPlanInput): Plan {
  const { settings } = input;
  const profile = { ...settings.profile, weightKg: input.currentWeightKg ?? settings.profile.weightKg };
  const wt = profile.weightKg;
  const dates = dateRange(input.start, input.days);
  const byDate = new Map<DateKey, Workout[]>();
  for (const w of input.workouts) {
    if (!byDate.has(w.date)) byDate.set(w.date, []);
    byDate.get(w.date)!.push(w);
  }
  const workoutsOn = (d: DateKey) => byDate.get(d) ?? [];

  const rate = resolveWeeklyRate(settings.goals, wt, input.today);
  const planFlags: PlanFlag[] = [...rate.flags];
  const bmr = restingKcal(profile);
  const ffm = fatFreeMassKg(profile);
  const eaFloor = EA_FLOOR[profile.sex];

  // Pass 1 — energy need and the minimum intake each day can tolerate.
  const base = dates.map((date) => {
    const ws = workoutsOn(date);
    const tomorrow = workoutsOn(addDays(date, 1));
    let loadClass = loadClassFor(ws);
    let nextLoadClass = loadClassFor(tomorrow);
    if (tomorrow.some(isRaceEvent)) nextLoadClass = maxClass(nextLoadClass, 'very-high');
    if (ws.some(isRaceEvent)) loadClass = maxClass(loadClass, 'high');
    const neat = bmr * (profile.neatFactor - 1);
    const exercise = ws.reduce((s, w) => s + netExerciseKcal(w.kj, w.durationMin, profile), 0);
    const grossEx = ws.reduce((s, w) => s + grossExerciseKcal(w.kj, profile.efficiency), 0);
    const tdee = bmr + neat + exercise;
    const protectedDay =
      ws.some((w) => isHard(w.intensity) || isRaceEvent(w)) ||
      tomorrow.some(isRaceEvent) ||
      loadClass === 'very-high' ||
      (nextLoadClass === 'very-high' && loadClass !== 'rest');
    // Carb-load the day before a long race (>= 2.5 h).
    const carbLoad = tomorrow.some((w) => isRaceEvent(w) && w.durationMin >= 150) && !ws.some(isRaceEvent);
    const carbs = dailyCarbGrams({ workouts: ws, weightKg: wt, efficiency: profile.efficiency, prefs: settings.nutrition, loadClass, nextLoadClass, carbLoad });
    const proteinG = settings.nutrition.proteinGPerKg * wt;
    const fatMinG = settings.nutrition.fatMinGPerKg * wt;
    // In a cut, easy days may run lower-carb (periodised "fuel for the work"):
    // ~2–2.5 g/kg baseline and only part of an easy session's burn replaced.
    // Key days keep their full carbs.
    const cutting = rate.weeklyRateKg < 0;
    const easyBase = loadClass === 'rest' || loadClass === 'light' ? 2.0 : 2.5;
    const carbsMin =
      cutting && !protectedDay
        ? Math.min(carbs.grams, easyBase * wt + 0.75 * carbs.sessionCarbG + carbs.topUpG)
        : carbs.grams;
    const floorKcal = carbsMin * 4 + (proteinG + 0.2 * wt) * 4 + fatMinG * 9;
    const eaFloorKcal = eaFloor * ffm + grossEx;
    return { date, ws, carbLoad, loadClass, nextLoadClass, tdee, neat, exercise, grossEx, protectedDay, carbs, carbsMin, proteinG, fatMinG, floorKcal, eaFloorKcal };
  });

  // Pass 2 — place the weekly energy delta. Deficits go only on easy days and
  // never cut into the carbs the training needs; surpluses spread evenly.
  const weeklyDelta = weeklyEnergyDelta(rate.weeklyRateKg);
  const deficitByDate = new Map<DateKey, number>();
  const weekKeys = [...new Set(dates.map(weekStartOf))];
  for (const wk of weekKeys) {
    const inWeek = base.filter((b) => weekStartOf(b.date) === wk);
    const share = inWeek.length / 7;
    if (weeklyDelta < 0) {
      const candidates = inWeek.map((b) => {
        const room = Math.min(settings.goals.maxDailyDeficit, b.tdee * 0.25, b.tdee - Math.max(b.floorKcal, b.eaFloorKcal));
        const weight = b.protectedDay ? 0 : b.loadClass === 'rest' || b.loadClass === 'light' ? 1 : 0.6;
        return { date: b.date, weight, cap: Math.max(0, room) };
      });
      const alloc = allocateDeficit(-weeklyDelta * share, candidates);
      for (const [d, v] of alloc) deficitByDate.set(d, v);
    } else if (weeklyDelta > 0) {
      for (const b of inWeek) deficitByDate.set(b.date, -weeklyDelta / 7);
    }
  }

  // Pass 3 — macros, meal timing, flags.
  const days: DayPlan[] = base.map((b, i) => {
    const flags: PlanFlag[] = [];
    const deficit = deficitByDate.get(b.date) ?? 0;
    let target = b.tdee - deficit;
    let proteinG = b.proteinG + (deficit > 150 ? 0.2 * wt : 0);
    let carbG = b.carbs.grams;
    let fatG = (target - carbG * 4 - proteinG * 4) / 9;
    if (fatG < b.fatMinG) {
      // Trim carbs toward the day's floor first; below that, training carbs
      // win and intake rises rather than starving the session.
      fatG = b.fatMinG;
      carbG = Math.max(b.carbsMin, (target - proteinG * 4 - fatG * 9) / 4);
      target = carbG * 4 + proteinG * 4 + fatG * 9;
    }
    if (carbG < b.carbs.grams - 5) {
      flags.push({ level: 'info', code: 'lower-carb-day', message: `Lower-carb easy day (${(carbG / wt).toFixed(1)} g/kg) — this is where the deficit lives, so key sessions stay fully fuelled.` });
    }
    // On low-demand days, cap fat at a sensible ceiling and give the rest to carbs.
    const fatCeil = 1.2 * wt;
    if (fatG > fatCeil) {
      carbG += ((fatG - fatCeil) * 9) / 4;
      fatG = fatCeil;
    }
    const ea = (target - b.grossEx) / ffm;
    if (ea < eaFloor && (deficit > 50 || ea < eaFloor - 5)) {
      flags.push({ level: 'alert', code: 'low-ea', message: `Energy availability ${Math.round(ea)} kcal/kg FFM — below ${eaFloor} while cutting risks RED-S. Shrink the deficit today.` });
    }

    const resolved = resolveWorkoutTimes(b.date, b.ws, settings.schedule);
    if (resolved.some((w) => w.timeAssumed)) {
      flags.push({ level: 'info', code: 'time-assumed', message: 'Session time not set — assumed your usual slot. Tap the session to set the real time.' });
    }
    const tomorrow = base[i + 1]?.ws ?? workoutsOn(addDays(b.date, 1));
    const tomorrowResolved = resolveWorkoutTimes(addDays(b.date, 1), tomorrow, settings.schedule);
    const tomorrowHard = tomorrow.some((w) => isHard(w.intensity) || isRaceEvent(w)) || ['high', 'very-high'].includes(b.nextLoadClass);
    if (b.carbLoad) {
      flags.push({ level: 'info', code: 'carb-load', message: 'Race tomorrow — carb-load today (~10 g/kg), low fibre and fat. Expect +1 kg on the scale from glycogen and water; that is fuel, not fat.' });
    }
    const raceToday = resolved.find((w) => isRaceEvent(w));
    if (raceToday && raceToday.resolvedStartMin - settings.schedule.wakeMin < 180) {
      flags.push({ level: 'info', code: 'early-wake', message: 'Race morning: set an alarm ~3.5 h before the start so breakfast is digested.' });
    }
    if (b.protectedDay && b.ws.length) {
      flags.push({ level: 'info', code: 'protected', message: 'Key day — no deficit. Fuel the work.' });
    }

    const macros = { carbG: Math.round(carbG), proteinG: Math.round(proteinG), fatG: Math.round(fatG) };
    const slots = planDaySlots({
      date: b.date,
      workouts: resolved,
      schedule: settings.schedule,
      prefs: settings.nutrition,
      macros,
      weightKg: wt,
      topUpG: b.carbs.topUpG,
      tomorrowFirstSessionMin: tomorrowResolved[0]?.resolvedStartMin,
      tomorrowHard,
    });
    // Slot rounding can drift; report the sum actually prescribed.
    const prescribed = slots.reduce(
      (acc, s) => ({ carbG: acc.carbG + s.macros.carbG, proteinG: acc.proteinG + s.macros.proteinG, fatG: acc.fatG + s.macros.fatG }),
      { carbG: 0, proteinG: 0, fatG: 0 },
    );
    const finalTarget = prescribed.carbG * 4 + prescribed.proteinG * 4 + prescribed.fatG * 9;

    return {
      date: b.date,
      weekday: weekdayOf(b.date),
      workouts: resolved,
      loadClass: b.loadClass,
      nextLoadClass: b.nextLoadClass,
      protectedDay: b.protectedDay,
      energy: {
        bmr: Math.round(bmr),
        neat: Math.round(b.neat),
        exercise: Math.round(b.exercise),
        tdee: Math.round(b.tdee),
        deficit: Math.round(b.tdee - finalTarget),
        target: Math.round(finalTarget),
        sessionCarbG: Math.round(b.carbs.sessionCarbG),
        energyAvailability: Math.round((finalTarget - b.grossEx) / ffm),
      },
      macros: prescribed,
      carbGPerKg: Math.round((prescribed.carbG / wt) * 10) / 10,
      slots,
      flags,
    };
  });

  const weeks: WeekSummary[] = weekKeys.map((wk) => {
    const inWeek = days.filter((d) => weekStartOf(d.date) === wk);
    const placed = inWeek.reduce((s, d) => s + d.energy.deficit, 0);
    const share = inWeek.length / 7;
    return {
      weekStart: wk,
      days: inWeek.map((d) => d.date),
      load: Math.round(inWeek.reduce((s, d) => s + d.workouts.reduce((a, w) => a + w.load, 0), 0)),
      hours: Math.round(inWeek.reduce((s, d) => s + d.workouts.reduce((a, w) => a + w.durationMin, 0), 0) / 6) / 10,
      kcal: inWeek.reduce((s, d) => s + d.energy.target, 0),
      macros: inWeek.reduce(
        (acc, d) => ({ carbG: acc.carbG + d.macros.carbG, proteinG: acc.proteinG + d.macros.proteinG, fatG: acc.fatG + d.macros.fatG }),
        { carbG: 0, proteinG: 0, fatG: 0 },
      ),
      targetDeficit: Math.round(-weeklyDelta * share),
      placedDeficit: Math.round(placed),
      expectedChangeKg: Math.round((-placed / 7700) * 100) / 100,
    };
  });
  for (const w of weeks) {
    if (w.targetDeficit > 0 && w.placedDeficit < w.targetDeficit * 0.8) {
      planFlags.push({
        level: 'info',
        code: 'deficit-short',
        message: `Week of ${w.weekStart}: only ${w.placedDeficit} of ${w.targetDeficit} kcal deficit fits around key sessions. That's by design — progress will be slower this week.`,
      });
    }
  }

  const glycogen = simulateGlycogen(days, { weightKg: wt, efficiency: profile.efficiency });
  return { days, weeks, glycogen, weeklyRateKg: rate.weeklyRateKg, flags: planFlags };
}

export function bandFor(cls: DayLoadClass) {
  return CARB_BANDS[cls];
}

export function daysUntil(today: DateKey, date?: DateKey) {
  return date ? diffDays(today, date) : undefined;
}
