import { gzipSync, strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { addDays } from '../../engine/time';
import { DEFAULT_SETTINGS } from '../../engine/defaults';
import { perfObservations } from '../fit';
import { decodeFit, encodeFit } from '../history/fit-file';
import { readArchive, toRideRecords } from '../history/strava';
import { readZipStream } from '../history/zip';
import { analyzeHistory, planFromHistory } from '../planner';

// Archive -> streaming unzip -> FIT/TCX decode -> FTP-independent summaries ->
// per-date FTP estimate -> RideRecords -> model fit -> optimised plan.
// The archive is built here the way Strava builds it: activities.csv with
// repeated header names, gzipped FIT files, a TCX, media we must skip.

const FTP = 265;
const START = '2026-03-01';

type Seg = [seconds: number, watts: number];
const WORKOUTS: Record<string, Seg[]> = {
  z2: [[600, 150], [4800, 175], [300, 120]],
  ss: [[900, 160], [900, 240], [300, 140], [900, 240], [300, 140], [900, 240], [600, 130]],
  vo2: [[900, 160], ...Array.from({ length: 5 }, () => [[240, 305], [240, 120]] as Seg[]).flat(), [900, 150]],
  test: [[1200, 170], [300, 300], [600, 130], [1200, 280], [600, 120]],
};

function samples(day: string, segs: Seg[], step = 5) {
  const t0 = Date.parse(`${day}T16:00:00Z`) / 1000;
  const out: Array<{ t: number; power: number; hr: number }> = [];
  let t = t0;
  for (const [sec, w] of segs) for (let s = 0; s < sec; s += step, t += step) out.push({ t, power: w + ((t * 7) % 11) - 5, hr: Math.round(100 + w / 4) });
  return out;
}

function buildArchive() {
  // Strava's real header repeats several names (e.g. Elapsed Time, Distance).
  const header =
    'Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Max Heart Rate,Relative Effort,Commute,Activity Private Note,Activity Gear,Filename,Athlete Weight,Bike Weight,Elapsed Time,Moving Time,Distance,Max Speed,Average Speed,Elevation Gain,Average Heart Rate,Average Watts,Weighted Average Power,Perceived Exertion';
  const lines = [header];
  const files: Record<string, Uint8Array> = { 'media/photo.jpg': new Uint8Array(5000).fill(7) };
  let id = 1000;
  for (let d = 0; d < 120; d += 1) {
    const day = addDays(START, d);
    const wd = d % 7;
    let kind: keyof typeof WORKOUTS | undefined = wd === 1 ? 'ss' : wd === 3 ? 'vo2' : wd === 5 || wd === 6 ? 'z2' : undefined;
    if (d === 30 || d === 100) kind = 'test';
    if (!kind) continue;
    id += 1;
    const s = samples(day, WORKOUTS[kind]);
    const secs = s.length * 5;
    const name = kind === 'test' ? 'FTP test' : kind === 'ss' ? 'Sweet spot 3x15' : kind === 'vo2' ? 'VO2 5x4' : 'Endurance';
    const rpe = kind === 'test' ? 10 : kind === 'vo2' ? 8 : kind === 'ss' ? 6 : 3;
    let filename = `activities/${id}.fit.gz`;
    if (d === 8) {
      // one TCX
      filename = `activities/${id}.tcx`;
      const pts = s.map((x) => `<Trackpoint><Time>${new Date(x.t * 1000).toISOString()}</Time><HeartRateBpm><Value>${x.hr}</Value></HeartRateBpm><Extensions><ns3:TPX><ns3:Watts>${x.power}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`);
      files[filename] = strToU8(`<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity><Lap><Track>${pts.join('')}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`);
    } else if (d === 15) filename = ''; // manual entry, no file
    else files[filename] = gzipSync(encodeFit(s, { utcOffsetS: -7 * 3600 }));
    const date = new Date(Date.parse(`${day}T16:00:00Z`)).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
    lines.push([id, `"${date}"`, `"${name}"`, d === 50 ? 'Virtual Ride' : 'Ride', '', secs, '30.1', '175', '50', 'false', '', 'Bike', filename, '72', '8', secs, secs, '30100', '12', '8', '200', '140', '200', d === 15 ? '210' : '', rpe].join(','));
  }
  lines.push(['9999', '"Mar 2, 2026, 1:00:00 PM"', '"Easy run"', 'Run', '', 1800, '5', '160', '20', 'false', '', '', 'activities/9999.fit.gz', '', '', 1800, 1800, '5000', '3', '2.7', '20', '140', '', '', ''].join(','));
  files['activities.csv'] = strToU8(lines.join('\n'));
  return zipSync(files, { level: 1 });
}

describe('Strava archive import', () => {
  it('FIT encoder/decoder round-trip keeps power, HR and the local-time offset', () => {
    const s = samples('2026-03-02', WORKOUTS.ss);
    const fit = decodeFit(encodeFit(s, { utcOffsetS: -25200 }));
    expect(fit.samples).toHaveLength(s.length);
    expect(fit.samples[100]).toMatchObject({ t: s[100].t, power: s[100].power, hr: s[100].hr });
    expect(fit.utcOffsetS).toBe(-25200);
  });

  it('imports an archive end to end and plans from it', async () => {
    const zip = buildArchive();
    const reader = await readZipStream(new Blob([new Uint8Array(zip)]).stream());
    const { activities, report } = readArchive(reader, 'America/Denver');

    // Run skipped; every ride kept, including the TCX and the file-less one.
    expect(report.skipped.Run).toBe(1);
    expect(report.rides).toBe(activities.length);
    expect(report.withFile).toBe(activities.length - 1);
    expect(report.withRpe).toBe(activities.length);
    // Local date comes from the FIT offset: 16:00Z at UTC-7 is 09:00 the same day.
    expect(activities[0]).toMatchObject({ date: '2026-03-02', startMin: 9 * 60 });

    const rides = toRideRecords(activities, 250);
    const test = rides.find((r) => r.isTest)!;
    // 20-min test at ~280 W -> FTP ~266
    expect(0.95 * test.best20!).toBeGreaterThan(260);
    expect(0.95 * test.best20!).toBeLessThan(272);
    // FTP history is estimated from efforts, so sweet spot lands in the mid domain.
    const ss = rides.find((r) => r.date === addDays(START, 1))!;
    expect(ss.ftpSet).toBeGreaterThan(240);
    expect(ss.domain.mid).toBeGreaterThan(ss.domain.low);
    const vo2 = rides.find((r) => r.date === addDays(START, 3))!;
    expect(vo2.domain.high).toBeGreaterThan(10);
    // The manual entry falls back to Strava's weighted power.
    expect(rides.find((r) => r.date === addDays(START, 15))!.tss).toBeGreaterThan(0);

    const obs = perfObservations(rides);
    expect(obs.filter((o) => o.kind === 'test')).toHaveLength(2);

    const today = addDays(START, 119);
    const snap = { rides, wellness: [], ftpSet: 265, availabilityHours: DEFAULT_SETTINGS.goals.availabilityHours, maxRampPerWeek: 6, today };
    const analysis = analyzeHistory(snap, 'core', 8);
    expect(Math.abs(analysis.ftpEstimate - FTP)).toBeLessThan(15);
    const { plan } = planFromHistory(snap, { objective: 'ftp', weeks: 8, optimize: true }, analysis);
    expect(plan.weeks).toHaveLength(8);
    expect(plan.sessions.at(-1)!.kind).toBe('ftptest');
    expect(plan.projection!.finalFtp.p50).toBeGreaterThan(analysis.ftpEstimate - 10);
  }, 60_000);
});
