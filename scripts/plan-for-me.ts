import { DEFAULT_SETTINGS } from '../src/engine/defaults';
import { generatePlan } from '../src/training/generator';
import { scorePlan } from '../src/training/optimize';
import { analyzeHistory, planFromHistory } from '../src/training/planner';
import { renderPlan } from '../src/training/__tests__/render';
import type { Genome } from '../src/training/types';
import { buildHistory } from './strava-mcp-history';

const today = process.argv[2] ?? '2026-10-15';
const weeks = Number(process.argv[3] ?? 16);
const rides = buildHistory().filter((r) => r.date <= today && r.durationMin > 0 || (r.isTest && r.date <= today));
// Availability matching the weeks that built both 330+ peaks: ~4 sessions, 5.5-6 h.
const availability = { 0: 2, 1: 1.25, 2: 0, 3: 1.25, 4: 1, 5: 0, 6: 2.5 } as const;
const snap = { rides, wellness: [], ftpSet: 305, availabilityHours: availability as any, maxRampPerWeek: 5, today };
const a = analyzeHistory(snap, 'core', 16);
console.log(`today ${today}: model FTP ${a.ftpEstimate} W | CTL ${a.ctl.toFixed(1)} ATL ${a.atl.toFixed(1)} | fit k1 ${a.fit.params.k1.toFixed(2)} k2 ${a.fit.params.k2.toFixed(2)} tau1 ${a.fit.params.tau1.toFixed(0)}`);
const free = planFromHistory(snap, { objective: 'ftp', weeks, start: '2026-10-19', optimize: true, baselineTest: true }, a);
const req = free.plan.request;
// Shape of the 2022-23 and 2023-24 builds: long sweet-spot base, VO2 only late.
const personal: Genome = { cadence: 3, recoveryDepth: 0.6, rampPerWeek: 4, hardPerWeek: 3, vo2Share: 0.25, baseFrac: 0.7, baseThresholdShare: 0.33 };
const mine = generatePlan(req, personal);
const sp = scorePlan(mine, a.members, req.ctl, req.atl);
const q = (xs: number[], p: number) => [...xs].sort((x, y) => x - y)[Math.round(p * (xs.length - 1))];
console.log(`FREE optimiser genome ${JSON.stringify(free.plan.genome)} -> FTP ${free.plan.projection!.finalFtp.p10.toFixed(0)}-${free.plan.projection!.finalFtp.p90.toFixed(0)} (p50 ${free.plan.projection!.finalFtp.p50.toFixed(0)})`);
console.log(`YOUR-PEAK shape genome ${JSON.stringify(personal)} -> FTP ${q(sp.perfAtTarget, 0.1).toFixed(0)}-${q(sp.perfAtTarget, 0.9).toFixed(0)} (p50 ${q(sp.perfAtTarget, 0.5).toFixed(0)})`);
console.log('\n' + renderPlan(mine));
