import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { addDays } from '../../engine/time';
import { readiness } from '../../training/adapt';
import type { WellnessRecord } from '../../training/history/types';
import { HealthAccumulator, readHealthExport } from '../appleHealth';
import { recentBodyFat, withHealthDays, withHealthRecords, withHealthWeights } from '../merge';

// Synthetic Apple Health export: the record shapes the Health app writes,
// including the cases that trip naive parsing (pounds, several weigh-ins a day,
// the same night logged by watch and phone, in-bed vs asleep, child elements,
// escaped source names, and heart-rate samples that must be skipped).

const rec = (type: string, start: string, end: string, value: string, extra = '') =>
  `<Record type="${type}" sourceName="Pat&apos;s Apple Watch" sourceVersion="10.1" ${extra}creationDate="${end}" startDate="${start}" endDate="${end}" value="${value}"/>`;

const XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE HealthData [ <!ATTLIST Record type CDATA #REQUIRED> ]>',
  '<HealthData locale="en_US">',
  '<ExportDate value="2026-10-16 08:00:00 -0400"/>',
  // Two weigh-ins: the morning one counts. Pounds are converted.
  rec('HKQuantityTypeIdentifierBodyMass', '2026-10-15 18:30:00 -0400', '2026-10-15 18:30:00 -0400', '172.0', 'unit="lb" '),
  rec('HKQuantityTypeIdentifierBodyMass', '2026-10-15 06:45:00 -0400', '2026-10-15 06:45:00 -0400', '170.0', 'unit="lb" '),
  rec('HKQuantityTypeIdentifierBodyMass', '2026-10-14 06:40:00 -0400', '2026-10-14 06:40:00 -0400', '77.4', 'unit="kg" '),
  rec('HKQuantityTypeIdentifierBodyFatPercentage', '2026-10-15 06:45:00 -0400', '2026-10-15 06:45:00 -0400', '0.18', 'unit="%" '),
  rec('HKQuantityTypeIdentifierRestingHeartRate', '2026-10-15 00:00:00 -0400', '2026-10-15 23:59:00 -0400', '52', 'unit="count/min" '),
  // HRV with child elements, twice in a day: daily mean.
  `<Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Apple Watch" unit="ms" startDate="2026-10-15 02:10:00 -0400" endDate="2026-10-15 02:11:00 -0400" value="60">`,
  ' <HeartRateVariabilityMetadataList><InstantaneousBeatsPerMinute bpm="55" time="2:10:01.00 AM"/></HeartRateVariabilityMetadataList>',
  '</Record>',
  rec('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', '2026-10-15 05:10:00 -0400', '2026-10-15 05:11:00 -0400', '40', 'unit="ms" '),
  // Night ending Oct 15: watch says 7 h asleep (core + deep + REM), the phone
  // says 6 h; in bed and awake don't count. Keep the larger source, don't add.
  rec('HKCategoryTypeIdentifierSleepAnalysis', '2026-10-14 22:30:00 -0400', '2026-10-15 06:30:00 -0400', 'HKCategoryValueSleepAnalysisInBed'),
  rec('HKCategoryTypeIdentifierSleepAnalysis', '2026-10-14 23:00:00 -0400', '2026-10-15 03:00:00 -0400', 'HKCategoryValueSleepAnalysisAsleepCore'),
  rec('HKCategoryTypeIdentifierSleepAnalysis', '2026-10-15 03:00:00 -0400', '2026-10-15 04:00:00 -0400', 'HKCategoryValueSleepAnalysisAwake'),
  rec('HKCategoryTypeIdentifierSleepAnalysis', '2026-10-15 04:00:00 -0400', '2026-10-15 05:00:00 -0400', 'HKCategoryValueSleepAnalysisAsleepDeep'),
  rec('HKCategoryTypeIdentifierSleepAnalysis', '2026-10-15 05:00:00 -0400', '2026-10-15 07:00:00 -0400', 'HKCategoryValueSleepAnalysisAsleepREM'),
  `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="iPhone" startDate="2026-10-15 00:00:00 -0400" endDate="2026-10-15 06:00:00 -0400" value="HKCategoryValueSleepAnalysisAsleepUnspecified"/>`,
  // Skipped: heart rate samples, steps, and anything before the window.
  rec('HKQuantityTypeIdentifierHeartRate', '2026-10-15 07:00:00 -0400', '2026-10-15 07:00:00 -0400', '61', 'unit="count/min" '),
  rec('HKQuantityTypeIdentifierStepCount', '2026-10-15 07:00:00 -0400', '2026-10-15 07:10:00 -0400', '900', 'unit="count" '),
  rec('HKQuantityTypeIdentifierBodyMass', '2020-01-01 07:00:00 -0500', '2020-01-01 07:00:00 -0500', '80', 'unit="kg" '),
  '<Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="60"/>',
  '</HealthData>',
].join('\n');

const SINCE = '2025-01-01';

function expectParsed(res: ReturnType<HealthAccumulator['finish']>) {
  expect(res.days.map((d) => d.date)).toEqual(['2026-10-14', '2026-10-15']);
  const d = res.days[1];
  expect(d.weightKg).toBe(77.1); // 170 lb, the morning weigh-in
  expect(res.days[0].weightKg).toBe(77.4);
  expect(d.bodyFatPct).toBe(18);
  expect(d.restingHR).toBe(52);
  expect(d.hrvSdnn).toBe(50);
  expect(d.sleepHours).toBe(7);
  expect(res.report.counts).toEqual({ weight: 2, bodyFat: 1, restingHR: 1, hrv: 1, sleep: 1 });
  expect(res.report.sources.sleep).toEqual(["Pat's Apple Watch", 'iPhone']);
}

describe('Apple Health export', () => {
  it('reads the values the app uses, whatever the chunk boundaries', () => {
    for (const size of [7, 64, XML.length]) {
      const acc = new HealthAccumulator(SINCE);
      for (let i = 0; i < XML.length; i += size) acc.push(XML.slice(i, i + size));
      expectParsed(acc.finish());
    }
  });

  it('streams the zip the Health app makes, and export.xml on its own', async () => {
    const zip = zipSync({ 'apple_health_export/export.xml': strToU8(XML), 'apple_health_export/export_cda.xml': strToU8('<ClinicalDocument/>') });
    const progress: number[] = [];
    expectParsed(await readHealthExport(Object.assign(new Blob([zip as Uint8Array<ArrayBuffer>]), { name: 'export.zip' }), { since: SINCE, onProgress: (p) => progress.push(p) }));
    expect(progress.at(-1)).toBe(1);
    expectParsed(await readHealthExport(Object.assign(new Blob([XML]), { name: 'export.xml' }), { since: SINCE }));
  });

  it('says so when the file is not a Health export', async () => {
    const zip = zipSync({ 'activities.csv': strToU8('a,b') });
    await expect(readHealthExport(Object.assign(new Blob([zip as Uint8Array<ArrayBuffer>]), { name: 'x.zip' }))).rejects.toThrow(/No export.xml/);
    await expect(readHealthExport(Object.assign(new Blob(['<html/>']), { name: 'x.xml' }))).rejects.toThrow(/doesn't look like/);
  });
});

describe('merging Apple Health with synced data', () => {
  const acc = new HealthAccumulator(SINCE);
  acc.push(XML);
  const health = { ...acc.finish(), importedAt: '2026-10-16T08:00:00Z' };

  it('one weight per day: manual, then Apple Health, then Intervals; survives a sync replacing Intervals data', () => {
    // What a sync leaves: manual weigh-ins plus fresh Intervals ones.
    const afterSync = [
      { date: '2026-10-13', kg: 78, source: 'intervals' as const },
      { date: '2026-10-14', kg: 77.9, source: 'intervals' as const },
      { date: '2026-10-15', kg: 76.5, source: 'manual' as const },
    ];
    expect(withHealthWeights(afterSync, health)).toEqual([
      { date: '2026-10-13', kg: 78, source: 'intervals' },
      { date: '2026-10-14', kg: 77.4, source: 'apple-health' },
      { date: '2026-10-15', kg: 76.5, source: 'manual' },
    ]);
  });

  it('Intervals values win; Apple fills gaps and adds SDNN alongside, never in place of, rMSSD', () => {
    const days = withHealthDays([{ date: '2026-10-15', restingHR: 50, hrv: 70 }], health);
    expect(days.find((d) => d.date === '2026-10-15')).toMatchObject({ restingHR: 50, hrv: 70, hrvSdnn: 50, sleepHours: 7, weight: 77.1 });
    const recs = withHealthRecords([{ date: '2026-10-15', lnRmssd: Math.log(70) }], health);
    expect(recs.find((d) => d.date === '2026-10-15')).toMatchObject({ lnRmssd: Math.log(70), rhr: 52, sleepHours: 7, lnSdnn: Math.log(50) });
  });

  it('body fat from the last 60 days sets the profile; older readings do not', () => {
    expect(recentBodyFat(health, '2026-10-20')).toEqual({ pct: 18, date: '2026-10-15' });
    expect(recentBodyFat(health, '2027-01-20')).toBeUndefined();
  });
});

describe('readiness with Apple Watch HRV', () => {
  const today = '2026-10-16';
  // 60 days of steady SDNN, then a week well below it.
  const sdnnOnly: WellnessRecord[] = Array.from({ length: 67 }, (_, i) => ({ date: addDays(today, i - 66), lnSdnn: Math.log(i < 60 ? 60 + (i % 5) : 35) }));

  it('uses SDNN for the whole baseline when there is no rMSSD', () => {
    const r = readiness(sdnnOnly, today, 0);
    expect(r.hrvKind).toBe('sdnn');
    expect(r.reasons).toContain('7-day HRV is below your normal range');
  });

  it('a few stray rMSSD days do not switch HRV off: SDNN carries the baseline', () => {
    const stray = sdnnOnly.map((w, i) => (i % 10 === 0 ? { ...w, lnRmssd: Math.log(80) } : w));
    const r = readiness(stray, today, 0);
    expect(r.hrvKind).toBe('sdnn');
    expect(r.reasons).toContain('7-day HRV is below your normal range');
  });

  it('never mixes measures: with enough rMSSD, SDNN is ignored', () => {
    const mixed = sdnnOnly.map((w, i) => (i % 2 ? { ...w, lnRmssd: Math.log(80) } : w));
    const r = readiness(mixed, today, 0);
    expect(r.hrvKind).toBe('rmssd');
    expect(r.hrv7).toBeCloseTo(Math.log(80));
  });
});
