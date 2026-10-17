import { projectFitness, rampRate } from '../engine/fitness';
import { observedRate, weightTrend } from '../engine/goals';
import { buildPlan } from '../engine/plan';
import { addDays, diffDays, weekStartOf, weekdayShort } from '../engine/time';
import type { DateKey, Settings, WeightEntry, WellnessDay, Workout } from '../engine/types';
import { makeWorkout } from '../engine/workout';
import type { TrainingState } from '../state/training';
import { planEnd } from '../training/generator';
import type { ProposalChange, ProposedSession } from './types';

// Pure tool implementations for the coach agent. Everything the model sees is
// computed by the same engine the app uses, so its proposals are grounded.

export interface CoachWorld {
  settings: Settings;
  workouts: Workout[];
  wellness: WellnessDay[];
  weights: WeightEntry[];
  today: DateKey;
  /** Preburner training plan state, when one exists */
  training?: TrainingState;
}

const intensities = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2', 'Race'];

const sessionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    durationMin: { type: 'number', description: 'Session length in minutes' },
    intensity: { type: 'string', enum: intensities },
    ifactor: { type: 'number', description: 'Planned intensity factor (NP/FTP), e.g. 0.68 endurance, 0.88 sweet spot' },
    structure: {
      type: 'string',
      description: 'Optional Intervals.icu workout-builder text, one step per line, e.g. "- 15m 55-65%\\n3x\\n- 10m 90-94%\\n- 5m 55%\\n- 10m 55%"',
    },
  },
  required: ['title', 'durationMin', 'intensity'],
};

const changeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['add', 'remove', 'move', 'replace', 'note'] },
    date: { type: 'string', description: 'YYYY-MM-DD the change applies to' },
    targetWorkoutId: { type: 'string', description: 'id of an existing session (remove / move / replace)' },
    newDate: { type: 'string', description: 'for move: the new date' },
    session: sessionSchema,
    note: { type: 'string', description: 'for note: text to put on the calendar' },
    reason: { type: 'string', description: 'one sentence on why' },
  },
  required: ['action', 'date', 'reason'],
};

export const COACH_TOOLS = [
  {
    name: 'get_athlete_context',
    description: 'Athlete profile, goals (weight, target event, CTL/TSB targets, weekly availability), current fitness/form, weight trend and recovery markers. Call this first.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'get_calendar',
    description: 'Sessions between two dates (inclusive), completed and planned, with id, title, duration, intensity, IF, load and source. Sessions with source "intervals" come from TrainerRoad/Intervals; "preburner" were created by this app.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { start: { type: 'string' }, end: { type: 'string' } },
      required: ['start', 'end'],
    },
  },
  {
    name: 'get_fueling_plan',
    description: 'Per-day nutrition plan between two dates: day type, kcal target vs burn, deficit, carbs g/kg, and warnings (e.g. low energy availability).',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { start: { type: 'string' }, end: { type: 'string' } },
      required: ['start', 'end'],
    },
  },
  {
    name: 'get_training_plan',
    description:
      "The athlete's Preburner training plan, if any: goal, dates, weekly phases and load, projected FTP range, today's readiness (HRV/RHR/form/feel), recent automatic adjustments, and the next 7 days of sessions. Plan sessions have source \"preburner\" in the calendar. Call this before changing training.",
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'simulate_changes',
    description:
      'Apply a set of candidate changes in a sandbox and return the resulting weekly load/hours, CTL ramp, projected CTL and TSB on the event day, availability violations and how much of the weight-loss deficit fits. The unchanged baseline comes with the first call only. Use this to compare options before proposing.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { changes: { type: 'array', items: changeSchema } },
      required: ['changes'],
    },
  },
  {
    name: 'propose_plan',
    description: 'Submit the final recommended changes to the athlete for approval. Call exactly once at the end. Nothing is applied until the athlete approves each change.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Short headline, e.g. "Two-week build to 78 CTL"' },
        summary: { type: 'string', description: '2–4 sentences: what changes and the expected outcome' },
        changes: { type: 'array', items: changeSchema },
      },
      required: ['title', 'summary', 'changes'],
    },
  },
] as const;

export type CoachToolName = (typeof COACH_TOOLS)[number]['name'];

const r1 = (n: number) => Math.round(n * 10) / 10;

export function applyChanges(workouts: Workout[], changes: Array<Omit<ProposalChange, 'id' | 'status'>>, ftp: number): { workouts: Workout[]; errors: string[] } {
  let out = [...workouts];
  const errors: string[] = [];
  const build = (date: DateKey, s: ProposedSession, id?: string) =>
    makeWorkout({ id, date, title: s.title, durationMin: s.durationMin, intensity: s.intensity, ifactor: s.ifactor, startMin: s.startMin ?? null, ftp, source: 'preburner', description: s.structure });
  for (const c of changes) {
    const target = c.targetWorkoutId ? out.find((w) => w.id === c.targetWorkoutId) : undefined;
    if ((c.action === 'remove' || c.action === 'move' || c.action === 'replace') && !target) {
      errors.push(`${c.action}: no session with id ${c.targetWorkoutId}`);
      continue;
    }
    if (target?.completed) {
      errors.push(`${c.action}: ${target.title} is already completed`);
      continue;
    }
    switch (c.action) {
      case 'add':
        if (!c.session) errors.push('add: missing session');
        else out.push(build(c.date, c.session));
        break;
      case 'remove':
        out = out.filter((w) => w !== target);
        break;
      case 'move':
        if (!c.newDate) errors.push('move: missing newDate');
        else out = out.map((w) => (w === target ? { ...w, date: c.newDate!, startMin: null } : w));
        break;
      case 'replace':
        if (!c.session) errors.push('replace: missing session');
        else out = [...out.filter((w) => w !== target), build(target!.date, c.session)];
        break;
      case 'note':
        break;
    }
  }
  return { workouts: out, errors };
}

function weeklySummary(world: CoachWorld, workouts: Workout[], weeks = 6) {
  const start = weekStartOf(addDays(world.today, -7));
  return Array.from({ length: weeks }, (_, i) => {
    const wk = addDays(start, i * 7);
    const inWk = workouts.filter((w) => w.date >= wk && w.date <= addDays(wk, 6));
    const byDay = new Map<DateKey, number>();
    for (const w of inWk) byDay.set(w.date, (byDay.get(w.date) ?? 0) + w.durationMin / 60);
    const overAvailability = [...byDay.entries()]
      .filter(([d, h]) => h > (world.settings.goals.availabilityHours[new Date(`${d}T12:00:00Z`).getUTCDay() as 0] ?? 24) + 0.01)
      .map(([d, h]) => `${d} ${weekdayShort(d)} ${r1(h)}h`);
    return {
      weekStart: wk,
      hours: r1(inWk.reduce((s, w) => s + w.durationMin, 0) / 60),
      load: Math.round(inWk.reduce((s, w) => s + w.load, 0)),
      hardSessions: inWk.filter((w) => ['Threshold', 'VO2', 'Race'].includes(w.intensity)).length,
      overAvailability,
    };
  });
}

function outcome(world: CoachWorld, workouts: Workout[]) {
  const goals = world.settings.goals;
  const end = goals.eventDate && goals.eventDate > addDays(world.today, 42) ? goals.eventDate : addDays(world.today, 42);
  const fit = projectFitness({ wellness: world.wellness, workouts, from: addDays(world.today, -14), to: end, today: world.today });
  const at = (d: DateKey) => fit.find((p) => p.date === d);
  const weekly = weeklySummary(world, workouts);
  const maxRamp = Math.max(...[7, 14, 21, 28, 35].map((o) => rampRate(fit, addDays(world.today, o)) ?? 0));
  const plan = buildPlan({ settings: world.settings, workouts, start: world.today, days: 21, today: world.today, currentWeightKg: weightTrend(world.weights).at(-1)?.trend });
  const target = plan.weeks.reduce((s, w) => s + w.targetDeficit, 0);
  const placed = plan.weeks.reduce((s, w) => s + Math.max(0, w.placedDeficit), 0);
  return {
    event: goals.eventDate
      ? { date: goals.eventDate, daysAway: diffDays(world.today, goals.eventDate), ctl: r1(at(goals.eventDate)?.ctl ?? 0), tsb: r1(at(goals.eventDate)?.tsb ?? 0), targetCtl: goals.targetCtl, targetTsb: goals.targetTsb }
      : null,
    ctlIn4Weeks: r1(at(addDays(world.today, 28))?.ctl ?? 0),
    maxWeeklyRampNext5Weeks: r1(maxRamp),
    rampLimit: goals.maxRampPerWeek,
    weekly,
    nutrition: { next3WeeksDeficitTarget: target, placed, lowEnergyAvailabilityDays: plan.days.filter((d) => d.flags.some((f) => f.code === 'low-ea')).map((d) => d.date) },
  };
}

/** Per-run tool state: lets repeated simulations skip what the model already has. */
export interface ToolContext {
  baselineSent?: boolean;
}

export function runTool(world: CoachWorld, name: string, input: Record<string, unknown>, ctx: ToolContext = {}): unknown {
  switch (name) {
    case 'get_athlete_context': {
      const { profile, goals, schedule } = world.settings;
      const trend = weightTrend(world.weights);
      const fit = projectFitness({ wellness: world.wellness, workouts: world.workouts, from: addDays(world.today, -28), to: world.today, today: world.today });
      const now = fit.at(-1);
      const recent = world.wellness.filter((w) => w.date >= addDays(world.today, -7));
      const avg = (k: 'hrv' | 'hrvSdnn' | 'restingHR' | 'sleepHours') => {
        const v = recent.map((w) => w[k]).filter((x): x is number => typeof x === 'number');
        return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null;
      };
      return {
        today: world.today,
        weekday: weekdayShort(world.today),
        athlete: { sex: profile.sex, age: profile.ageYears, weightKg: r1(trend.at(-1)?.trend ?? profile.weightKg), ftp: profile.ftp, wPerKg: r1(profile.ftp / (trend.at(-1)?.trend ?? profile.weightKg)) },
        goals: {
          targetWeightKg: goals.targetWeightKg,
          targetWeightDate: goals.targetWeightDate,
          weeklyRateKg: goals.weeklyRateKg,
          event: goals.eventDate ? { name: goals.eventName, date: goals.eventDate, targetCtl: goals.targetCtl, targetTsb: goals.targetTsb } : null,
          targetFtp: goals.targetFtp,
          maxRampPerWeek: goals.maxRampPerWeek,
          availabilityHoursByWeekday: { Mon: goals.availabilityHours[1], Tue: goals.availabilityHours[2], Wed: goals.availabilityHours[3], Thu: goals.availabilityHours[4], Fri: goals.availabilityHours[5], Sat: goals.availabilityHours[6], Sun: goals.availabilityHours[0] },
        },
        fitnessToday: now ? { ctl: r1(now.ctl), atl: r1(now.atl), tsb: r1(now.tsb), rampLast7d: r1(rampRate(fit, world.today) ?? 0) } : null,
        weight: { trendKg: r1(trend.at(-1)?.trend ?? profile.weightKg), observedRateKgPerWeek: observedRate(world.weights) ?? null },
        recoveryLast7d: { hrvRmssd: avg('hrv'), hrvSdnnAppleWatch: avg('hrvSdnn'), restingHR: avg('restingHR'), sleepHours: avg('sleepHours') },
        usualTrainingStart: schedule.defaultTrainingMin,
      };
    }
    case 'get_calendar': {
      const { start, end } = input as { start: string; end: string };
      return world.workouts
        .filter((w) => w.date >= start && w.date <= end)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((w) => ({ id: w.id, date: w.date, weekday: weekdayShort(w.date), title: w.title, durationMin: w.durationMin, intensity: w.intensity, if: r1(w.ifactor * 100) / 100, load: w.load, kj: w.kj, completed: !!w.completed, source: w.source, category: w.category }));
    }
    case 'get_fueling_plan': {
      const { start, end } = input as { start: string; end: string };
      const days = Math.max(1, Math.min(42, diffDays(start, end) + 1));
      const plan = buildPlan({ settings: world.settings, workouts: world.workouts, start, days, today: world.today, currentWeightKg: weightTrend(world.weights).at(-1)?.trend });
      return plan.days.map((d) => ({
        date: d.date,
        dayType: d.loadClass,
        keyDay: d.protectedDay,
        targetKcal: d.energy.target,
        burnKcal: d.energy.tdee,
        deficit: d.energy.deficit,
        carbGPerKg: d.carbGPerKg,
        energyAvailability: d.energy.energyAvailability,
        warnings: d.flags.filter((f) => f.level !== 'info').map((f) => f.message),
      }));
    }
    case 'get_training_plan': {
      const t = world.training;
      const plan = t?.plan;
      if (!plan) return { plan: null, note: 'No Preburner training plan. The athlete can generate one on the Plan page.' };
      return {
        goal: plan.request.objective,
        start: plan.request.start,
        end: planEnd(plan),
        workingFtp: t.ftp ?? plan.request.ftp,
        projectedFtp: plan.projection ? { p10: Math.round(plan.projection.finalFtp.p10), p50: Math.round(plan.projection.finalFtp.p50), p90: Math.round(plan.projection.finalFtp.p90) } : null,
        shape: plan.genome,
        weeks: plan.weeks.map((w) => ({ start: w.start, phase: w.phase, tss: w.plannedTss, hours: w.hours, hardSessions: w.hardSessions })),
        onIntervals: !!t.appliedAt,
        readiness: t.readiness ? { level: t.readiness.level, reasons: t.readiness.reasons } : null,
        recentAdjustments: t.adjustments.slice(0, 8).map((a) => `${a.date} ${a.action}: ${a.reason}`),
        next7Days: plan.sessions.filter((x) => x.date >= world.today && x.date <= addDays(world.today, 6)).map((x) => ({ date: x.date, title: x.title, durationMin: x.durationMin, tss: x.tss, purpose: x.purpose })),
      };
    }
    case 'simulate_changes': {
      const changes = (input.changes ?? []) as Array<Omit<ProposalChange, 'id' | 'status'>>;
      const { workouts, errors } = applyChanges(world.workouts, changes, world.settings.profile.ftp);
      const withChanges = outcome(world, workouts);
      if (ctx.baselineSent) return { baseline: 'unchanged: see the first simulate_changes result', withChanges, errors };
      ctx.baselineSent = true;
      return { baseline: outcome(world, world.workouts), withChanges, errors };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}
