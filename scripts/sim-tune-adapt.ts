import type { AdaptConfig } from '../src/training/adapt';
import { type RunResult, runStrategy } from '../src/training/sim/strategies';
import { setProfileVariation } from '../src/training/sim/truth';

// Paired comparison of adaptation configs against the same optimizer without
// adaptation. Usage: npx vite-node scripts/sim-tune-adapt.ts [athletes=40]
const n = Number(process.argv[2] ?? 40);
const profiles = (process.argv[3] ?? 'on') === 'on';
setProfileVariation(profiles);
const configs: Record<string, Partial<AdaptConfig> | false> = {
  none: false,
  'default (all on)': {},
  'default, no rpe/feel': { useRpe: false },
  'default, no readiness': { swc: 99, rhrDelta: 99, tsbFloor: -999 },
  'default, swc 0.5': { swc: 0.5 },
};
const rows: Record<string, RunResult[]> = {};
for (const [name, adapt] of Object.entries(configs)) {
  rows[name] = [];
  for (let seed = 1; seed <= n; seed += 1) rows[name].push(runStrategy(seed, { name, build: 'optimize', mode: 'core', adapt }, { weeks: 12, objective: 'ftp' }));
}
const base = rows.none;
console.log(`${n} athletes, power profiles ${profiles ? 'individual' : 'uniform'}, paired vs no adaptation (difference in true FTP gain, percentage points)`);
for (const [name, r] of Object.entries(rows)) {
  const d = r.map((x, i) => (x.gain - base[i].gain) * 100);
  const m = d.reduce((a, b) => a + b, 0) / n;
  const se = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1) / n);
  const ill = r.reduce((a, x) => a + x.illDays, 0) / n;
  const worst = Math.min(...d);
  console.log(name.padEnd(26), `Δgain ${m >= 0 ? '+' : ''}${m.toFixed(2)} ± ${se.toFixed(2)} pp   worst ${worst.toFixed(2)}   ill ${ill.toFixed(2)} d   adj ${(r.reduce((a, x) => a + x.adjustments, 0) / n).toFixed(1)}`);
}
