import { type RunResult, type Strategy, runStrategy } from '../src/training/sim/strategies';

// Does asking "what happened?" after skipped or failed sessions help? Paired
// against the same optimised, adapting plan where every miss is caught up and
// every failure counts against the intensity.
// Usage: npx vite-node scripts/sim-debrief.ts [athletes=60]
const n = Number(process.argv[2] ?? 60);
const base: Strategy = { name: 'adapt', build: 'optimize', mode: 'core', adapt: {} };
const variants: Record<string, Strategy> = {
  'adapt (no questionnaire)': base,
  'questionnaire, truthful': { ...base, debrief: { misreport: 0 } },
  'questionnaire, 20% of tired skips said "no time"': { ...base, debrief: { misreport: 0.2 } },
  'questionnaire, 50% misreported': { ...base, debrief: { misreport: 0.5 } },
};
const rows: Record<string, RunResult[]> = {};
for (const [name, strat] of Object.entries(variants)) {
  rows[name] = [];
  for (let seed = 1; seed <= n; seed += 1) rows[name].push(runStrategy(seed, { ...strat, name }, { weeks: 12, objective: 'ftp' }));
}
const ref = rows['adapt (no questionnaire)'];
console.log(`${n} athletes, 12-week FTP plans, paired vs adaptation without the questionnaire`);
for (const [name, r] of Object.entries(rows)) {
  const d = r.map((x, i) => (x.gain - ref[i].gain) * 100);
  const m = d.reduce((a, b) => a + b, 0) / n;
  const se = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1) / n);
  const mean = (f: (x: RunResult) => number) => (r.reduce((a, x) => a + f(x), 0) / n).toFixed(2);
  console.log(
    name.padEnd(50),
    `gain ${(r.reduce((a, x) => a + x.gain, 0) / n * 100).toFixed(2)}%  Δ ${m >= 0 ? '+' : ''}${m.toFixed(2)} ± ${se.toFixed(2)} pp  worst ${Math.min(...d).toFixed(2)}  best ${Math.max(...d).toFixed(2)}  ill ${mean((x) => x.illDays)} d  maxStrain ${mean((x) => x.maxStrain)}  h/wk ${mean((x) => x.hours)}`,
  );
}
