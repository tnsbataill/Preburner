# Training plan layer: design

Goal: Preburner generates the full training plan (replacing TrainerRoad's), tuned to the athlete's own response to training, and keeps adjusting it from what actually happens. Primary objective: **raise FTP / W/kg**. Other objectives are selectable.

## Evidence the design rests on

| Finding | Source | Design consequence |
| --- | --- | --- |
| Polarized vs non-polarized give similar VO2max / TT gains in trained cyclists; longer interventions help; volume beyond a necessary amount doesn't. | Cove et al., multilevel meta-analysis, 41 studies / 797 cyclists | Intensity distribution is a *tunable* parameter fit to the athlete, not a dogma. Volume has diminishing returns in the model. |
| POL may beat other TIDs for VO2peak, esp. short interventions & highly trained. | Sports Med 2024 TID meta-analysis | VO2 domain gets its own response gain. |
| Best taper: ~2 weeks, volume cut 41–60% exponentially, intensity and frequency kept. | Bosquet et al. 2007, MSSE | Event objective taper template; FTP objective uses a short 4–6 day freshen before the test. |
| HRV-guided training: hard sessions only when 7-day rolling lnRMSSD is inside the individual SWC; better or equal outcomes with less hard work. | Vesterinen et al.; Javaloyes et al. (cyclists) | Readiness rule in the adaptation layer. |
| Individual fitness-fatigue fits are unstable on sparse data; PerPot / variable-dose models handle overload better. | Pfeiffer 2008/2010; Busso 2003 | Fit with priors (MAP), add variable-dose fatigue, validate on a *different* ground-truth model. |
| Strava-sourced activities are not available through the Intervals API. | Intervals.icu forum, staff | History comes from the Strava bulk archive; ongoing data from Intervals. |

## Modules (`src/training/`)

1. **`history/`**: ingest.
   - `fit.ts`: minimal FIT decoder (record messages: time, power, HR, cadence).
   - `strava.ts`: archive reader (`activities.csv` + `activities/*.fit(.gz)|.tcx(.gz)`), fflate for zip/gzip.
   - `metrics.ts`: per ride NP, IF, TSS, mean-max curve, time in domain (below LT1 / LT1–FTP / above FTP).
   - `eftp.ts`: rolling eFTP from mean-max power (2-parameter CP on 3–20 min bests), with a flag for whether the ride held a near-maximal effort.
   - Output: `TrainingHistory` (daily domain loads + performance observations), merged with recent Intervals activities.
2. **`model.ts`**: athlete response model.
   - Three domain fitness traces (low / threshold / high load), shared τ1, gains k_low, k_mid, k_high.
   - Saturating stimulus (diminishing returns on volume).
   - Fatigue with τ2 and a variable-dose gain (Busso): heavy recent load makes fatigue costlier.
   - Performance is an FTP-like watts value.
3. **`fit.ts`**: MAP fit of the model to observed performance (eFTP observations).
   - Population priors on every parameter.
   - Asymmetric loss: sub-max rides are lower bounds, so only test or near-max observations count fully.
   - Returns a posterior ensemble (Laplace / bootstrap samples) for robust planning.
4. **`library.ts`**: session library with progressions.
   - Endurance, tempo, sweet spot, threshold, over-unders, VO2, anaerobic, openers, recovery, FTP test.
   - Each has levels, Intervals workout-builder text, duration and per-domain TSS.
5. **`generator.ts`**: plan from a *genome*.
   - Inputs: duration (weeks), objective, availability per weekday, current CTL/FTP.
   - Genome: load:recovery week cadence, recovery depth, weekly ramp, hard sessions per week, threshold vs VO2 share, phase split, long-ride share.
   - Weekly target TSS → day placement (hard days not back-to-back, long ride on the biggest weekend slot, easy after hard, rest on zero-availability days) → session selection with progression.
6. **`optimize.ts`**: one-shot optimizer.
   - Searches the genome: discrete grid plus coordinate/random refinement.
   - Each candidate runs through the fitted ensemble. Objective for `ftp`: expected performance on the final test day minus risk penalties (P(fatigue overload), monotony/strain, ramp > limit, availability violations).
   - Objectives: `ftp` (default), `event` (performance on date + TSB window), `ctl` (fitness for the hours).
7. **`adapt.ts`**: closed loop, run on every sync.
   - Readiness from HRV SWC, RHR, sleep and TSB.
   - Compliance from planned vs done TSS and failed or cut sessions.
   - Breakthroughs (new eFTP lifts zones); periodic refit.
   - Output: concrete adjustments (downgrade or swap today, push hard day, trim next week, re-plan remaining weeks) as coach-style proposals.
8. **`debrief.ts`**: "what happened?" after a skipped or cut-short quality session (like TrainerRoad's post-workout survey).
   - Skipped: no time / travelling / bike issue → catch the work up; too tired → no catch-up, ease the next hard day; sick → easy spins for three days, then ease back in; injured → no hard work for a week.
   - Cut short (under 80% of planned time) or flagged "didn't go to plan": only "couldn't hold the targets" counts as a failed session. Time, kit and "felt ill" rides are left out of RPE progression and the athlete's RPE norm.
   - Answers apply immediately. The daily check assumes "no time" until the athlete answers, and its catch-up move stores what it replaced so a later answer can undo it.

## Simulation (`src/training/sim/`, `scripts/simulate.ts`)

- **Synthetic athletes.** Ground truth uses a *different, richer* model so we aren't testing the fitter on itself:
  - PerPot-style overload with performance collapse when strain persists;
  - per-domain responsiveness and individual τ;
  - illness/life interruptions, compliance noise, HRV and RHR generated from hidden fatigue;
  - FTP tests with measurement noise; most rides sub-maximal.
- **Strategies compared** on a population of about 300 athletes over 8/12/16-week plans:
  1. Static template (TrainerRoad-like sweet-spot base, then build).
  2. Optimized on population priors.
  3. Optimized on the individual fit.
  4. Individual fit plus adaptation loop.
- **Metrics:** FTP gain (median and distribution), overreach events, sessions skipped.
- **Tuned hyperparameters:** prior strength, readiness thresholds, adaptation aggressiveness, risk penalty weights.
- **Real data:** backtest. Fit on the first ~70% of the athlete's history, predict held-out eFTP, report the error versus a CTL-only baseline. Then generate their actual plan.

## Integration

- **New Plan page:** duration, objective and start date in; weekly load bars, projected FTP with uncertainty band, and session list out. Generate is one shot. "Send to Intervals" bulk-upserts Preburner-tagged events, and the workout text goes in the description so Intervals builds the structure.
- **Today page:** an adaptation card with readiness and today's suggested change. A "What happened?" card asks about skipped or cut-short sessions from the last three days.
- **Coach tools:** `get_training_model`, `generate_plan`, `get_readiness`.
- **Store:** `history` (compact daily series, not raw streams) and `trainingPlan`.

## Tests (per priority)

1. **E2E (Playwright, demo provider):**
   - Generate a 12-week FTP plan, see it on Plan/Week, apply it, reload, and it persists.
   - The adaptation card reacts to a low-HRV demo day.
2. **Integration:**
   - Strava archive import on a fixture zip (FIT built by a test encoder) through to history and model fit.
   - Generator and optimizer through to Intervals upsert payloads.
3. **Golden:** rendered 12-week plan for fixed athletes as readable text.
4. **Simulation regression:** the adaptive strategy beats the static template on the synthetic population (seeded).
