import { STRATEGIES, type RunResult, runStrategy } from '../src/training/sim/strategies';

// Usage: npx vite-node scripts/sim-strategies.ts [athletes=40] [weeks=12] [strategies=comma list]
const n = Number(process.argv[2] ?? 40);
const weeks = Number(process.argv[3] ?? 12);
const names = (process.argv[4] ?? Object.keys(STRATEGIES).join(',')).split(',');
const t0 = Date.now();
const rows: RunResult[] = [];
for (let seed = 1; seed <= n; seed += 1) for (const s of names) rows.push(runStrategy(seed, STRATEGIES[s], { weeks, objective: 'ftp' }));
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor(p * (v.length - 1))];
const base = new Map(rows.filter((r) => r.strategy === names[0]).map((r) => [r.seed, r]));
console.log(`${n} athletes, ${weeks}-week FTP plans. Graded on TRUE FTP on test day.`);
console.log('strategy'.padEnd(22), 'gain mean  median    p10      p90   | win vs', names[0].padEnd(8), '| ill d  strain  fails  h/wk  adj');
for (const s of names) {
  const r = rows.filter((x) => x.strategy === s);
  const g = r.map((x) => x.gain);
  const wins = r.filter((x) => x.gain > (base.get(x.seed)?.gain ?? 0) + 1e-9).length;
  const avg = (f: (x: RunResult) => number) => r.reduce((a, x) => a + f(x), 0) / r.length;
  console.log(
    s.padEnd(22),
    pct(avg((x) => x.gain)).padStart(7), pct(q(g, 0.5)).padStart(7), pct(q(g, 0.1)).padStart(8), pct(q(g, 0.9)).padStart(8),
    '  |', `${wins}/${r.length}`.padStart(8), ' '.repeat(10), '|',
    avg((x) => x.illDays).toFixed(1).padStart(5), avg((x) => x.maxStrain).toFixed(2).padStart(7), avg((x) => x.failed).toFixed(1).padStart(6), avg((x) => x.hours).toFixed(1).padStart(5), avg((x) => x.adjustments).toFixed(0).padStart(4),
  );
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
