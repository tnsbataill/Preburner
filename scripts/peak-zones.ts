import { existsSync, readFileSync } from 'node:fs';
import { addDays } from '../src/engine/time';
import { perfObservations } from '../src/training/fit';
import { findBuildBlocks } from '../src/training/history/best-builds';
import { buildHistory, ftpAt } from './strava-mcp-history';

// What the builds that raised FTP looked like: time in power zones over every
// ride with power, and the week-by-week run of hard and VO2 sessions. Blocks
// are found from the history (rising tests), not written in here. Personal
// data: reads snapshots/ only. Usage: npx vite-node scripts/peak-zones.ts

const ZONES = [
  { name: 'Easy (<76% FTP, incl. coasting)', max: 0.76 },
  { name: 'Tempo (76-88%)', max: 0.88 },
  { name: 'Sweet spot (88-95%)', max: 0.95 },
  { name: 'Threshold (95-105%)', max: 1.05 },
  { name: 'VO2 and above (>105%)', max: Infinity },
];

const dir = 'snapshots/strava-mcp';
const tsv = (f: string) => (existsSync(`${dir}/${f}`) ? readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t')) : []);
const meta = new Map(tsv('rides.tsv').map(([id, start, sport, trainer, moving, , , name]) => [id, { date: start.slice(0, 10), sport, trainer: trainer === '1', hours: Number(moving) / 3600, name }]));
// Best stream first, as in buildHistory.
const watts = new Map<string, number[]>();
for (const [id, w] of tsv('block-watts.tsv')) if (w) watts.set(id, w.split(',').map(Number));
for (const [id, , w] of tsv('streams.tsv')) watts.set(id, w.split(',').map(Number));
for (const [id, w] of tsv('hires-watts.tsv')) watts.set(id, w.split(',').map(Number));

const rides = buildHistory();
const fmt = (h: number) => `${h.toFixed(1)} h`;
for (const b of findBuildBlocks(rides, perfObservations(rides))) {
  const inBlock = [...meta.entries()].filter(([, r]) => r.date > b.start && r.date <= b.end);
  const weeks = b.weeks;
  const zoneH = ZONES.map(() => 0);
  const indoorH = ZONES.map(() => 0);
  let noPower = 0;
  let indoor = 0;
  for (const [id, r] of inBlock) {
    const w = watts.get(id);
    if (!w?.length) {
      noPower += r.hours;
      continue;
    }
    const ftp = ftpAt(r.date);
    for (const x of w) {
      const zi = ZONES.findIndex((z) => x / ftp < z.max);
      zoneH[zi] += r.hours / w.length;
      if (r.trainer) indoorH[zi] += r.hours / w.length;
    }
    if (r.trainer) indoor += r.hours;
  }
  const withPower = zoneH.reduce((a, c) => a + c, 0);
  const total = withPower + noPower;
  console.log(`\n${b.fromFtp} -> ${b.toFtp} W (${b.start} - ${b.end})`);
  console.log(`  ${inBlock.length} rides over ${weeks} weeks: ${fmt(total)} total, ${(total / weeks).toFixed(1)} h/week, ${(inBlock.length / weeks).toFixed(1)} rides/week`);
  console.log(`  ${fmt(indoor)} indoor, ${fmt(withPower - indoor)} outdoor with power, ${fmt(noPower)} without power (MTB etc.)`);
  console.log('  Time in zone (rides with power):');
  ZONES.forEach((z, i) => console.log(`    ${z.name.padEnd(34)} ${fmt(zoneH[i]).padStart(8)}  ${((zoneH[i] / withPower) * 100).toFixed(0).padStart(3)}%  ${(zoneH[i] / weeks).toFixed(1)} h/wk`));
  const indoorT = indoorH.reduce((a, c) => a + c, 0);
  console.log(`  Indoor alone: ${ZONES.map((z, i) => `${z.name.split(' ')[0]} ${((indoorH[i] / indoorT) * 100).toFixed(0)}%`).join(', ')}`);
  console.log(`  Easy share counting no-power rides as easy: ${(((zoneH[0] + noPower) / total) * 100).toFixed(0)}%`);
  // Sessions, classified as best-builds does (measured rides only, no tests).
  const recs = rides.filter((r) => r.date > b.start && r.date <= b.end && r.durationMin > 0 && !r.isTest && !r.estimated);
  const hard = recs.filter((r) => r.domain.mid + r.domain.high >= 30);
  const vo2 = hard.filter((r) => r.domain.high >= r.domain.mid);
  const perWeek = (xs: typeof recs) => Array.from({ length: weeks }, (_, w) => xs.filter((r) => r.date > addDays(b.start, 7 * w) && r.date <= addDays(b.start, 7 * w + 7)).length).join('');
  console.log(`  Hard sessions ${hard.length} (${b.hardPerWeek}/wk), VO2 ${vo2.length} (${Math.round((b.vo2DayShare ?? 0) * 100)}% of hard), VO2 regular after ${Math.round((b.baseFrac ?? 1) * 100)}% of the block`);
  console.log(`    hard per week: ${perWeek(hard)}`);
  console.log(`    VO2 per week:  ${perWeek(vo2)}`);
  console.log(`    VO2 sessions: ${vo2.map((r) => `${r.date} ${meta.get(r.id.replace('strava-', ''))?.name}`).join('; ')}`);
}
