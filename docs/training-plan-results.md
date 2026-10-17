# Training plan layer: simulation results

These results come from a **simulated world** I built (`src/training/sim/`). They show the algorithm behaves as designed and catch regressions. They are not evidence that it works on real riders. The external check is a backtest on real history, which runs once a Strava archive is imported.

## Setup

- **Athletes.** A population of synthetic riders with hidden physiology (`sim/truth.ts`). The truth model is deliberately different from the planning model:
  - per-domain fitness time constants;
  - a genetic ceiling;
  - stress-weighted fatigue;
  - a strain compartment that drives non-functional overreaching and illness;
  - life-stress episodes;
  - individual power-duration profiles;
  - sessions that fail when targets exceed what the rider can hold.
- **History.** Each rider lives 6 unrecorded months, then 12 recorded months of self-directed training: rides, tests, group rides, HRV/RHR, RPE and feel.
- **Planning.** The planner only sees what real data would show.
- **Grading.** Every strategy is graded on the rider's **true** FTP on the final test day.
- **Pairing.** Strategies run on identical riders with common random numbers: the same illnesses, life stress and noise. Only decisions differ.

Reproduce:

```bash
npx vite-node scripts/sim-backtest.ts 80        # model fit vs persistence
npx vite-node scripts/sim-strategies.ts 60 12   # closed-loop plan comparison
npx vite-node scripts/sim-tune-adapt.ts 60 on   # adaptation ablations
npx vite-node scripts/sim-debrief.ts 60         # "what happened?" questionnaire
```

## 1. Can the model learn a rider from their history?

Fit on the first 9 months, then predict true FTP over the next 3 (80 riders):

| Model | MAPE mean | median | p90 |
| --- | --- | --- | --- |
| Persistence (best recent test / max effort) | 3.17% | 1.64% | 7.82% |
| Population prior, level fitted only | 2.96% | 2.16% | 5.54% |
| `core`: fitness gain, fatigue gain, fitness τ | **2.80%** | 1.95% | **5.59%** |
| `full`: adds per-domain weights and saturation | 2.99% | 1.99% | 6.77% |

- Individualising three parameters helps, mostly in the tail: riders with stale or untested FTP.
- Per-domain weights (which intensity a rider responds to) are **not identifiable** from typical data. They made predictions worse, so the planner fits `core` and keeps domain weights at the prior.
- Persistence still has the best median. When a rider tests regularly, their last test is hard to beat.

## 2. Do optimised plans raise FTP more?

12-week FTP plans, 60 riders, gain in true FTP. Current generator:

- at most 2 VO2+ sessions a week;
- at least 60% easy time;
- a return-to-training cap while CTL is low.

| Strategy | Mean | Median | p10 | p90 | Beats static |
| --- | --- | --- | --- | --- | --- |
| Static template (TrainerRoad-style, week-1 test) | 3.46% | 2.93% | 0.96% | 6.06% | — |
| Optimised on population priors | 3.79% | 3.69% | 0.31% | 7.05% | 31/60 |
| **Optimised on the individual fit** | **4.24%** | **4.21%** | 1.09% | 7.04% | 44/60 |
| Individual fit + daily adaptation | 4.23% | 4.05% | 1.30% | 6.90% | **46/60** |

- Optimising on **your fit** beats the template for most riders. Optimising on population priors barely does.
- **History of the guards.**
  - With a 70% easy-time floor, the individual fit beat the template by only about 0.3 points (3.73% vs 3.46%).
  - Before any guards, the optimiser won by stacking VO2 work. That reflected an assumption built into the simulator.
  - **Conventional limits on the intensity mix** (`CONVENTIONAL_BOUNDS`): at most half the build's hard days VO2, at least 40% of the plan as base, and sweet spot as well as threshold in the base. Without them, an athlete with no usable history got an all-VO2, no-base plan from CTL 0, purely from the population prior's slightly higher weight on high intensity. With them, 12-week results improved (4.09% → 4.24%). On 8-week plans they cost a little (3.40% → 3.23%, 40 riders), still ahead of the template (2.78%). An athlete's own best builds tighten these further.
  - The VO2 cap is the main protection. The easy-time floor was lowered to 60%, because the real rider's FTP-raising builds ran about 55–65% easy.

## 4. Real data

The model was fitted to one rider's Strava history (Oct 2022 → Jul 2026), then asked to predict each of 9 later known FTP values (ramp tests and TrainerRoad-implied FTP) from data up to the day before:

| Method | MAPE |
| --- | --- |
| Persistence (last test) | 6.9% |
| Population prior | 5.0% |
| `scale` | 3.7% |
| **`core`** | **3.1%** |

This is the first external check, and the individual fit helps. The caveats:

- Only n = 9.
- Load is computed with an FTP timeline that includes the test values.
- Rides without power data use calorie-based estimates.

The about 4% error SD is now added to every projection range (`MODEL_ERROR_SD`). Adherence is still not modelled, so ranges remain optimistic.

## 3. Does daily adaptation (readiness + RPE) help?

Paired against the same optimised plan without adaptation (60 riders):

| Config | Δ gain | Sick days |
| --- | --- | --- |
| All on (default) | −0.04 ± 0.09 pp | 2.20 vs 2.32 |
| Readiness only | +0.02 ± 0.08 pp | 2.27 |
| RPE/feel only | +0.01 ± 0.09 pp | 2.28 |
| Readiness with narrow SWC (0.5 SD) | −0.17 ± 0.08 pp | 2.30 |

- Adaptation is **neutral on FTP gain** in this world, within noise. It modestly cuts sick days.
- Its job is a safety net, not a gain engine. That matches the HRV-guided training literature: similar average gains, fewer bad outcomes.
- **Bugs the simulation caught and fixed:**
  - A single failed VO2 session lowered FTP twice (−6%). This cost one rider 4 points.
  - Readiness kept cancelling sessions through a 6-week life-stress stretch. Now it makes at most 2 swaps a week, then eases sessions instead.
  - Repeated VO2 failures stepped levels down without fixing the real problem, which was the intensity. Now the session type's targets drop 3% at a time (down to −12%) and come back when sessions feel easy.
- **Known limitation:** the simulator treats a failed interval as ridden at 95% of the rider's limit. That makes failing nearly free stimulus, so the sim probably understates the value of personalising intensity.

## 5. Does asking "what happened?" help?

After a skipped or under-target quality session, the athlete says why (`src/training/debrief.ts`). A ride counts as under target at under 80% of the planned time, or full length at under 80% of the planned TSS (rescaled to the plan's FTP). Any recent quality ride also has a "Didn't go to plan?" link:

| Answer | What the plan does |
| --- | --- |
| No time, travelling, bike issue | Catches the session up on an easy day in the next three |
| Too tired or stressed | No catch-up; the next hard day is one level easier |
| Sick | No catch-up; easy spins for three days, then the first hard day back is eased |
| Injured | No hard sessions for a week; the long-gap replan rebuilds on return |
| Skipped FTP test, no time | Moved to the next free day, even past the plan's end |
| Ride: ran out of time, kit issue | Nothing; its RPE is ignored |
| Ride: couldn't hold the targets | Counts as a failed session (step back, then lower that kind's targets) |
| Ride: felt ill or wrecked | Not a failure; RPE ignored; next hard day eased |

Paired against adaptation without the questionnaire (60 riders, 12 weeks): **−0.05 ± 0.02 pp**, worst −0.75, no change in sick days, and the same result with 20% or 50% of "tired" skips misreported as "no time".

- The sim world rarely produces the cases the questionnaire is for: 164 "no time" skips, 36 sick, 7 tired, and 1 failure while unwell across all riders.
- The cost is the sick path, tested by ablation. Answering "sick" as "no time" gives +0.00 ± 0.01 pp; answering it as "tired" gives −0.02 ± 0.01 pp.
- In the truth model, illness only lowers performance and blocks riding while it lasts. Training hard straight afterwards has no extra cost or relapse risk. So the sim can see the training lost to easy days, but not any benefit from a graded return. The app keeps the graded return because return-to-exercise guidance favours it; this sim can't test that choice.
- **The real reason for the feature:** in the app, nothing set the "failed" flag before this. Repeated failures were supposed to lower a session type's targets, but only the simulator could trigger it. Now "couldn't hold the targets" does.
- **Bug found while testing:** catching up a missed session treated the missed session itself as a hard day, so the day after a miss could never take the make-up.

## What runs in the app

| Default | Value |
| --- | --- |
| Fit | `core` |
| Ensemble | 16 members |
| Optimiser | about 150 genomes evaluated (random + coordinate descent), risk aversion 0.5 SD |
| Readiness | SWC 1.0 SD on 7-day lnRMSSD; RHR +3 bpm; TSB −35 |
| Red days | need 2 physiological markers |
| Feel | can only make a day amber |
| RPE | personal baseline per session type after 3 reports |
| Progression | ±1 level per report, within ±2 of plan |
| FTP from RPE | needs 4 sessions averaging ≥ 2 points off |
