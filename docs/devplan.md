# 🚀 Development Steps for Nutrition Prescription App

This document outlines the recommended sequence for building the app, broken into small, testable increments.

---

## 0) Prep (5–10 min)
**Goal:** Lock core types & sample data so every later step can be tested without APIs.

- Create a tiny repo with `/docs/brief.md` (the full plan).
- Add `/data/samples`:
  - Two sample workouts (ZWO or JSON) covering: Endurance and VO2.
  - One sample profile (imperial in UI → SI internal).

**Accept when:** you have 2–3 realistic sample workouts and a sample profile committed.

---

## 1) Core Calc Engine (pure functions, no UI)
**Goal:** Deterministic, unit-tested nutrition math from inputs → windows/weekly outputs.

- `calc/prescribe.ts`: session-to-session windows, RMR, efficiency presets, deficits, macros.
- `calc/weekly.ts`: weekly deficit allocator.
- `calc/carb.ts`: g/hr & pre/during/post splits + over-fuel guard.
- Unit tests (Vitest) for:
  - Hard-day protection.
  - Deficit caps.
  - Weight flags.
  - Carb splits.

**Accept when:** all tests pass with the sample workouts; outputs look sensible.

---

## 2) Fake Data Adapter (no network)
**Goal:** Run the app end-to-end with local samples through the same interface future APIs will use.

- `adapters/provider.ts` interface with `getPlannedWorkouts(start,end)`.
- `adapters/fake.ts` returns the sample workouts; include a flag to toggle “planned_kJ missing”.
- Wire engine + fake adapter in a small CLI or script to dump JSON.

**Accept when:** `npm run demo` prints windows + weekly summary JSON using fake data.

---

## 3) Skeleton UI (no styling fuss)
**Goal:** See the plan.

- Pages: **Onboarding**, **Planner**, **Windows**, **Weekly**.
- Zustand for state; Dexie (IndexedDB) for persistence.
- Load from **fake adapter**; render:
  - List of sessions.
  - Window cards.
  - Weekly bar with deficit placed vs target.
- Settings panel with sliders:
  - Efficiency preset & advanced %.
  - Activity factor.
  - Weekly weight change.
  - Deficit cap.
  - Macro defaults.
  - Carb bands & splits.
  - Glu:fru.

**Accept when:** changing sliders recomputes numbers instantly.

---

## 4) Intervals.icu Integration (API key mode)
**Goal:** Replace fake data with real planned workouts.

- Settings: “Enter Intervals.icu API key” + date range selector (7–14 days).
- API calls: list events with `category=WORKOUT`.
- For each: download structured file (`ext=zwo` + `resolve=true`) when needed.
- Compute planned kJ if missing.
- Add kJ source badge:
  - “ICU Structured”.
  - “Estimated (steps)”.
  - “Estimated (IF/TSS)”.
- Cache locally in IndexedDB.
- Manual “Refresh week” button (no polling).

**Accept when:** your next 7–14 days appear with types, planned kJ, and the engine runs.

---

## 5) Weight Tracking & Safety Nudges
**Goal:** Close the feedback loop.

- Weight entry widget (lb or kg) + 7-day rolling chart.
- EMPTY/UNDER_RECOVERY flags feed next-window deficit controls.
- Weekly expected vs actual weight delta banner.

**Accept when:** entering weight affects next window’s allowed deficit per rules.

---

## 6) PWA & GitHub Pages Deploy
**Goal:** Installable, offline-friendly app.

- Service worker via Vite plugin, cache shell + last plan.
- App manifest; icons; install prompt.
- GitHub Actions workflow to deploy `dist/` on push to `main`.

**Accept when:** you can “Install App” on desktop/mobile and see last data offline.

---

## 7) Fit & Finish
**Goal:** Polish the MVP.

- Accessibility on sliders/labels.
- Sensible rounding & unit conversions (lb/ft in UI, SI inside).
- CSV/JSON export of weekly plan.
- Printable day sheet.
- Quick session-type override.

**Accept when:** you can export, print, and navigate all sliders with keyboard.

---

## 8) Insights v2 (rule-based “AI lite”)
**Goal:** Actionable feedback without ML.

- Heuristics:
  - Actuals consistently > planned kJ → suggest lowering efficiency preset.
  - Weight loss < 60% of target 2 weeks straight → suggest adjusting efficiency or deficits.
  - GI discomfort logged → suggest reducing g/hr or changing glu:fru.
- “Apply suggestion” writes through to sliders with undo.

**Accept when:** Insights card surfaces 1–3 suggestions with clear justification and one-click apply.

---

## 🔑 Pro Tips
- Keep all math pure (no UI inside calc functions).
- Lock contracts early (`types.ts`).
- Feature flags: keep ICU connector behind a flag so you can dev offline.
- Small pull requests: one step per PR; keep tests green.

---
