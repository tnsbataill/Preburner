# Preburner

Meal timing and fuelling built around your training plan. Preburner reads your calendar from Intervals.icu (including TrainerRoad-synced workouts) and lays out, for every day, **what to eat and when**: before, during and after each session, plus how much of any weight-loss deficit fits around the key work. An optional AI coach (Claude) reads the same data, simulates options against your goals, and proposes calendar changes for you to approve.

It's a PWA hosted on GitHub Pages. Everything stays in your browser; keys are only sent to Intervals.icu and Anthropic.

## What it does

- **Today** – a timeline from wake to bed: meals, pre-ride snacks, in-ride carbs/fluid/sodium per hour, recovery meals and pre-sleep protein, each with macros, the reasoning behind it and food ideas. Includes a "next up" card, tick-off for meals you've eaten, and an estimated glycogen "fuel tank" across the day.
- **Week** – a 7-day grid showing load, kcal target versus burn, carbs g/kg and where the deficit lands, plus your weight trend against the goal path.
- **Fitness** – CTL/ATL/TSB history and a projection through your planned load to your goal event, with weekly load and ramp warnings.
- **Coach** – a chat that grounds every answer in the engine's numbers and ends with a proposal of specific changes. You accept or reject each change, then apply it.
- **Settings** – profile (synced from Intervals), daily rhythm, usual training times per weekday, goals, fuelling preferences, theme, backup and import.

## The model, briefly

| Piece | Approach |
| --- | --- |
| Resting energy | Mifflin-St Jeor, or Katch-McArdle when body fat is set; × daily-life (NEAT) factor |
| Session energy | kJ ÷ gross efficiency, minus the resting energy already counted. kJ sources, in priority order: planned → description ("kJ(Cal) 811") → workout steps → IF → load |
| Daily carbs | Baseline + carbs actually burned (intensity-based CHO fraction) + a top-up when tomorrow is hard; held to the IOC/ACSM g/kg band on big days. Day before a ≥2.5 h race: ~9 g/kg carb-load |
| In-ride fuel | g/h from duration × intensity, capped at your trained-gut max; glucose:fructose split above 60 g/h; fluid and sodium from sweat rate |
| Meal timing | Main meals move out of the 2 h before a session; pre-ride meal 2–5 h out; early starts get a light breakfast or quick snack; races get a ~3 h-out breakfast; recovery within 20–45 min; two-a-days handled; long gaps bridged |
| Weight goal | Target weight and date → weekly rate, capped at 1 % body mass/week. The deficit goes on easy days only, never cuts training carbs, and stops at the energy-availability floor (25 kcal/kg FFM for men, 30 for women) |
| Fitness | Banister CTL/ATL (42/7 days), seeded from Intervals wellness |

Time handling is local wall clock throughout. TrainerRoad events arrive date-only (00:00), so Preburner treats them as "time unknown", uses your usual slot for that weekday, and lets you set the real time with one tap.

## Training plans

The **Plan** tab builds the training itself. You pick a goal (raise FTP by default, peak for an event, or build fitness), a length, and whether to optimise. The plan is generated in one shot, then adjusted every day.

- **History.**
  - Intervals.icu supplies recent rides with RPE and feel, plus HRV, resting HR and sleep.
  - Strava-sourced rides can't come through the Intervals API. Import your Strava archive instead (Strava → Settings → My Account → Download your archive) on the Plan page, or run `npx vite-node scripts/import-strava.ts <export.zip>`. The archive is read locally, and only per-ride summaries are kept.
- **Model.**
  - A fitness-fatigue model with per-intensity fitness, diminishing returns and variable-dose fatigue.
  - It's fitted to your FTP history with population priors. Most rides are sub-maximal, so their best efforts only count as lower bounds.
- **Generator.**
  - Base → build → test with progression levels.
  - Evidence-based limits the optimiser can't override:
    - at most 3 hard days a week, never back to back;
    - at most 2 VO2+ sessions a week;
    - at least 70% of riding time easy;
    - your weekly ramp cap;
    - a recovery week every 2–4 weeks.
- **Optimiser.** Searches about 150 plan shapes against an ensemble of fitted models and picks the best risk-adjusted projected FTP.
- **Daily adaptation.**
  - HRV (7-day lnRMSSD vs your normal range), resting HR and form can ease or move a hard day.
  - "How did it feel?" (RPE and feel) moves progression levels against your own RPE norm.
  - Repeated failures lower that session type's targets.
  - A test or breakthrough effort updates FTP.
  - Long gaps rebuild the remaining weeks.
- **Calendar.**
  - Plan sessions feed the fuelling engine and replace other planned (e.g. TrainerRoad) sessions inside the plan window.
  - **Send to Intervals** writes them as Preburner-tagged workouts with structure, and re-sending is idempotent.
  - Clear your TrainerRoad plan for those weeks so TR doesn't keep syncing its own sessions.

Design and evidence are in [docs/training-plan-design.md](docs/training-plan-design.md). Simulation results, including what *didn't* help, are in [docs/training-plan-results.md](docs/training-plan-results.md).

## Intervals.icu

1. Intervals.icu → Settings → Developer: copy your API key.
2. Preburner → Settings → Connections: paste it and press **Connect**.

It reads the athlete profile, events (−3 to +8 weeks), activities and wellness. Writes happen only when you ask for them:
- **Coach proposals.** New sessions are created as Preburner-tagged events (`external_id`, so re-applying is idempotent). TrainerRoad-owned events are never edited or deleted, because TrainerRoad would re-sync them. Instead Preburner hides the event locally and adds a calendar note so you can mirror the change in TrainerRoad.
- **"Send g/h to Intervals".** Sets `carbs_per_hour` on a single event, after you confirm.

## Coach

Add an Anthropic API key in Settings. The coach runs Claude (Opus 5.5 by default, Sonnet 5.5 optional) directly from the browser. It uses tool calls over the same engine: athlete context, calendar, fuelling plan, a sandbox simulator, and a final `propose_plan`. Nothing is applied until you approve it.

## Development

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # engine golden + invariant tests, Intervals integration tests, coach tool tests
npm run test:e2e       # Playwright end-to-end on the demo provider (desktop + mobile)
INTERVALS_API_KEY=… npm run test:live   # opt-in read-only test against your real account
npm run build
```

Layout:

- `src/engine/`: pure model (energy, fuelling, scheduler, goals, glycogen, fitness, plan). Golden day plans live in `src/engine/__tests__/golden/` as readable text.
- `src/intervals/`: REST client, event/activity/wellness mapping, sync.
- `src/coach/`: agent loop, tools, applying proposals.
- `src/training/`: training-plan layer: session library, generator, response model + fit, optimiser, daily adaptation, history import (`history/`), and the synthetic-athlete simulator (`sim/`, driven by `scripts/sim-*.ts`).
- `src/state/`: Zustand store (persisted to localStorage) and a one-time import from the v1 IndexedDB.
- `src/pages`, `src/components`, `src/ui`: React UI (Tailwind; dark and light themes).

> If the repo lives in an iCloud-synced folder, keep `node_modules` out of iCloud (`node_modules.nosync` plus a symlink). Otherwise evicted files make every tool run hang.

v1 is preserved at the `v1-legacy` tag.
