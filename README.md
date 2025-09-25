# Preburner

Preburner is a free progressive web app that pulls planned workouts from Intervals.icu and prescribes session-to-session fueling targets using the "podcast method" of protected hard days, capped deficits, and weight-change guided adjustments. The full product vision, calculations, and data contracts are outlined in [brief.md](./brief.md).

## Features

- **Intervals.icu integration** – fetch planned workouts (including structured files) with personal API keys and estimate planned kJ when not provided.
- **Session-to-session planning** – build windows between workouts, combine resting and exercise needs, and allocate deficits only to easy days.
- **Macro guidance** – suggest protein, fat minimums, and carb plans (pre/during/post) tuned to workout type and intensity.
- **Weight tracking feedback** – record morning weight, visualize a rolling average, and adjust deficit caps when trends deviate.
- **Installable PWA** – React + Vite + Tailwind frontend with IndexedDB/Dexie persistence and offline caching for UI and data.

## Tech Stack

- React, TypeScript, Vite, Tailwind CSS
- IndexedDB via Dexie plus localStorage for lightweight flags
- GitHub Pages hosting target
- Intervals.icu API v1 (browser key) with planned extensions for OAuth and Cloudflare Worker proxying

Details on integrations, algorithms, and TypeScript data contracts are provided in [brief.md](./brief.md).

## Getting Started

```bash
npm install
npm run dev
```

If npm install is blocked in your environment, manually add the required packages or run the commands from a network-enabled machine.

## Project Structure

- `src/types.ts` – domain contracts for profiles, planned workouts, windows, and weekly plans
- `src/samples/` – example profile and workout data built with the contracts
- `src/App.tsx` – lightweight UI for visualizing the sample data

See [brief.md](./brief.md) for the roadmap covering onboarding, planner, windows view, weekly summary, settings, and algorithm pseudocode.
