# Preburner

Preburner is a progressive web app that pulls upcoming workouts from Intervals.icu and turns them into day-by-day fueling guidance. It combines resting energy, planned work, macro floors, and deficit caps so you always know how much to eat before/during/after each session.

The original vision, long-term UX ideas, and nutrition math are captured in [brief.md](./brief.md), but the summary below reflects the current implementation.

## What the app does today

- **Live Intervals.icu sync** – Use a personal API key to fetch workouts, structured steps, and weight history for the current athlete (`/athlete/0`). Planned kilojoules are estimated when the API doesnt provide them.
- **Planner windows** – Build fueling windows between workouts, merge resting needs with exercise cost, and cap deficits to easier days.
- **Macro guidance** – Recommend protein, fat minimums, and carb split (pre/during/post) tailored to the session type and intensity.
- **Weight + trend tracking** – Merge Intervals.icu wellness weights with manual entries, surface a rolling average, and compare against the weekly target.
- **Offline-ready UI** – React + Vite + Tailwind frontend with IndexedDB persistence. Cached workouts include the synced athlete profile so sex/height/FTP are restored instantly on reload.
- **Debug-first tooling** – The settings panel shows the detailed sync log (with a copy button) so you can share runs when something goes wrong.

## Requirements

1. **Intervals.icu personal API key** – Generate one in *Intervals.icu → Settings → API*. Keep it private.
2. **Planned workout access** – In the same settings screen enable “Allow access to planned workouts (API)”. Without it youll see a 403 during sync.
3. **Browser clipboard permission** – Optional, but needed if you want the Sync Log Copy button to work.

## Getting started locally

```bash
npm install
npm run dev
```

Open the printed localhost URL, paste your Intervals.icu API key in Settings, and hit **Refresh from Intervals.icu**.

### Useful scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production bundle |
| `npm test` | Vitest unit tests (provider + calc coverage) |

## Data + caching notes

- **IndexedDB (Dexie)** stores overrides, connection settings, cached workouts, cached weights, and the most recent Intervals profile snapshot.
- On app load we instantly render from cache, then kick off a background refresh so the view flips to the latest Intervals data when it arrives.
- Cached workouts are keyed by the selected date window. If you change the range, a new cache entry is created.

## Repo structure highlights

- `src/adapters/intervals.ts` – Intervals.icu integration: authentication, workout parsing, kilojoule estimation, profile extraction.
- `src/state/plannerStore.ts` – Zustand store orchestrating sync, caching, overrides, and derived fueling plans.
- `src/calc/` – Nutrition math (windows, macros, deficit allocation).
- `src/components/SettingsPanel.tsx` – Settings UI with sync controls and log.
- `src/pages/` – Planner views (profile, windows, weekly, onboarding).

## Troubleshooting syncs

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Sync log shows 403 on `/athlete/0` | Planned workout access disabled or wrong API key | Re-check API key, ensure “Allow access to planned workouts (API)” is enabled. |
| Planner still shows sample profile | Sync failed or cached window never refreshed | Check Sync Log, re-run refresh, or clear IndexedDB `PreburnerPlanner` data. |
| Clipboard copy fails | Browser blocked clipboard API | Grant clipboard permission or copy the log manually. |

If you open an issue / share a log, make sure to remove your API key and any personal info first.

Happy fueling!
