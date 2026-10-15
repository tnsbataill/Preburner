import { addDays } from '../engine/time';
import type { AthleteProfile, DateKey, WeightEntry, WellnessDay, Workout } from '../engine/types';
import { IntervalsClient } from './client';
import { activityToRide, wellnessToRecords } from '../training/history/intervals';
import type { RideRecord, WellnessRecord } from '../training/history/types';
import { athleteToProfile, mergePlannedAndDone, wellnessToDays } from './mapping';

export interface SyncResult {
  athleteId: string;
  profile: Partial<AthleteProfile>;
  workouts: Workout[];
  wellness: WellnessDay[];
  weights: WeightEntry[];
  log: string[];
}

export const SYNC_WINDOW = { pastDays: 21, futureDays: 56, wellnessDays: 120, historyDays: 400 };

/**
 * Longer history for the training model: a year+ of activities (with RPE,
 * feel, zone times and modelled FTP) and wellness (HRV, resting HR, sleep).
 * Strava-sourced activities don't come through the API; those come from the
 * Strava archive import instead.
 */
export async function syncTrainingHistory(client: IntervalsClient, today: DateKey, ftpFallback: number): Promise<{ rides: RideRecord[]; wellness: WellnessRecord[] }> {
  const oldest = addDays(today, -SYNC_WINDOW.historyDays);
  const [acts, well] = await Promise.all([client.activities(oldest, today), client.wellness(oldest, today)]);
  const rides = acts.map((a) => activityToRide(a, ftpFallback)).filter((r): r is RideRecord => !!r);
  return { rides, wellness: wellnessToRecords(well) };
}

export async function syncIntervals(client: IntervalsClient, today: DateKey, ftpFallback: number): Promise<SyncResult> {
  const log: string[] = [];
  const athlete = await client.athlete();
  log.push(`Athlete ${athlete.id}${athlete.firstname ? ` (${athlete.firstname})` : ''}`);
  const profile = athleteToProfile(athlete, today);
  const ftp = profile.ftp ?? ftpFallback;

  const oldest = addDays(today, -SYNC_WINDOW.pastDays);
  const newest = addDays(today, SYNC_WINDOW.futureDays);
  const [events, activities, wellnessRows] = await Promise.all([
    client.events(oldest, newest),
    client.activities(oldest, today),
    client.wellness(addDays(today, -SYNC_WINDOW.wellnessDays), today),
  ]);
  log.push(`${events.length} calendar events, ${activities.length} activities, ${wellnessRows.length} wellness days`);

  const workouts = mergePlannedAndDone(events, activities, ftp);
  const untimed = workouts.filter((w) => w.startMin === null && !w.completed).length;
  if (untimed) log.push(`${untimed} planned sessions have no start time — using your default training slots`);
  const { wellness, weights } = wellnessToDays(wellnessRows);
  if (weights.length) profile.weightKg = weights[weights.length - 1].kg;
  return { athleteId: client.athleteId, profile, workouts, wellness, weights, log };
}
