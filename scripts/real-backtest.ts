import { addDays } from '../src/engine/time';
import { type FitMode, dayLoads, fitModel, perfObservations, predictAt } from '../src/training/fit';
import { FTP_POINTS, buildHistory } from './strava-mcp-history';

// Real-data check: fit on history up to a cutoff, predict the next known FTP
// values, compare with "your last test still holds" (persistence).

const rides = buildHistory();
const tests = FTP_POINTS.map(([d, v]) => ({ date: d, ftp: v }));
const modes: FitMode[] = ['prior', 'scale', 'core'];
const errs: Record<string, number[]> = { persistence: [], prior: [], scale: [], core: [] };

for (let i = 2; i < tests.length; i += 1) {
  const target = tests[i];
  const cutoff = addDays(target.date, -1);
  const train = rides.filter((r) => r.date <= cutoff);
  const obs = perfObservations(train);
  const last = tests.filter((t) => t.date <= cutoff).at(-1)!;
  const line = [`${target.date} actual ${target.ftp}`, `persist ${last.ftp}`];
  errs.persistence.push(Math.abs(last.ftp - target.ftp) / target.ftp);
  for (const mode of modes) {
    const fit = fitModel(dayLoads(train), obs, cutoff, mode);
    const pred = predictAt(dayLoads(rides.filter((r) => r.date <= target.date)), fit.params, [target.date])[0];
    errs[mode].push(Math.abs(pred - target.ftp) / target.ftp);
    line.push(`${mode} ${pred.toFixed(0)}`);
  }
  console.log(line.join(' | '));
}
for (const [k, v] of Object.entries(errs)) console.log(`${k.padEnd(12)} MAPE ${((v.reduce((a, b) => a + b, 0) / v.length) * 100).toFixed(1)}%  (n=${v.length})`);
