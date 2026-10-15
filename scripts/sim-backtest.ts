import { backtest, summarize } from '../src/training/sim/experiments';
const n = Number(process.argv[2] ?? 40);
const t0 = Date.now();
const rows = backtest(Array.from({ length: n }, (_, i) => i + 1), ['prior', 'scale', 'core', 'full']);
const s = summarize(rows, 'mape');
const b = summarize(rows, 'bias');
for (const k of Object.keys(s)) console.log(`${k.padEnd(12)} MAPE mean ${(s[k].mean * 100).toFixed(2)}%  median ${(s[k].median * 100).toFixed(2)}%  p90 ${(s[k].p90 * 100).toFixed(2)}%   bias ${(b[k].mean * 100).toFixed(2)}%`);
console.log(`${n} athletes in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
