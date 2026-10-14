import { Flag, Target, TrendingUp } from 'lucide-react';
import { navigate } from '../App';
import { PmcChart } from '../components/PmcChart';
import { constantLoadFor, rampRate } from '../engine/fitness';
import { addDays, diffDays, formatDate, weekStartOf } from '../engine/time';
import { useApp } from '../state/store';
import { usePlan } from '../state/usePlan';
import { fmtWeight } from '../ui/format';
import { Button, Card, Chip, SectionTitle, Stat } from '../ui/primitives';

export function FitnessPage() {
  const { fitness, today, currentWeightKg } = usePlan();
  const goals = useApp((s) => s.settings.goals);
  const profile = useApp((s) => s.settings.profile);
  const wellness = useApp((s) => s.wellness);
  const now = fitness.find((p) => p.date === today) ?? fitness.at(-1)!;
  const ramp = rampRate(fitness, today);
  const eventPt = goals.eventDate ? fitness.find((p) => p.date === goals.eventDate) : undefined;
  const daysToEvent = goals.eventDate ? diffDays(today, goals.eventDate) : undefined;
  const lastPlanned = [...fitness].reverse().find((p) => p.load > 0)?.date;
  const planCoversEvent = goals.eventDate && lastPlanned ? lastPlanned >= addDays(goals.eventDate, -7) : false;
  const neededLoad = goals.targetCtl && daysToEvent && daysToEvent > 7 ? constantLoadFor(now.ctl, goals.targetCtl, daysToEvent - 7) : undefined;

  // Weekly load totals for the bar strip.
  const weeks = new Map<string, { load: number; projected: boolean }>();
  for (const p of fitness) {
    const wk = weekStartOf(p.date);
    const cur = weeks.get(wk) ?? { load: 0, projected: false };
    cur.load += p.load;
    cur.projected = cur.projected || p.projected;
    weeks.set(wk, cur);
  }
  const weekList = [...weeks.entries()].slice(-12);
  const maxWeek = Math.max(...weekList.map(([, w]) => w.load), 1);
  const latest = [...wellness].reverse().find((w) => w.hrv || w.restingHR);
  const wPerKg = profile.ftp / currentWeightKg;

  return (
    <div className="space-y-6">
      <div>
        <div className="label mb-1">Training load</div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Fitness</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <Stat label="Fitness (CTL)" value={Math.round(now.ctl)} sub={ramp !== undefined ? `${ramp >= 0 ? '+' : ''}${ramp.toFixed(1)} this week` : undefined} />
        </Card>
        <Card className="p-4">
          <Stat label="Form (TSB)" value={`${now.tsb > 0 ? '+' : ''}${Math.round(now.tsb)}`} sub={now.tsb < -25 ? 'deep fatigue' : now.tsb < -10 ? 'productive fatigue' : now.tsb < 5 ? 'neutral' : 'fresh'} />
        </Card>
        <Card className="p-4">
          <Stat label="FTP" value={profile.ftp} unit="W" sub={`${wPerKg.toFixed(2)} W/kg at ${fmtWeight(currentWeightKg, profile.units)}`} />
        </Card>
        <Card className="p-4">
          <Stat label="Recovery" value={latest?.hrv ? Math.round(latest.hrv) : '—'} unit={latest?.hrv ? 'ms HRV' : undefined} sub={latest?.restingHR ? `RHR ${latest.restingHR} bpm` : 'sync wellness from Intervals'} />
        </Card>
      </div>

      <Card className="p-5">
        <SectionTitle>Performance management</SectionTitle>
        <PmcChart points={fitness} today={today} event={goals.eventDate ? { date: goals.eventDate, name: goals.eventName, targetCtl: goals.targetCtl } : undefined} />
        {ramp !== undefined && ramp > goals.maxRampPerWeek && (
          <p className="mt-3 rounded-xl bg-warn/10 p-3 text-sm text-warn">
            Fitness is ramping {ramp.toFixed(1)}/week — above your {goals.maxRampPerWeek}/week limit. Watch sleep and fuel the hard days fully.
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle
            action={
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => navigate('settings', 'section=goals')}>
                Edit goals
              </Button>
            }
          >
            Goal event
          </SectionTitle>
          {goals.eventDate ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-i-race/15 text-i-race">
                  <Flag size={20} />
                </div>
                <div>
                  <div className="font-semibold">{goals.eventName ?? 'Target event'}</div>
                  <div className="text-sm text-muted">
                    {formatDate(goals.eventDate, { weekday: true })} · {daysToEvent! >= 0 ? `${daysToEvent} days` : 'passed'}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-raised/60 p-3">
                  <div className="label mb-1">Fitness on the day</div>
                  <div className="num text-lg font-semibold">
                    {eventPt ? Math.round(eventPt.ctl) : '—'}
                    {goals.targetCtl && <span className="text-sm font-normal text-muted"> / {goals.targetCtl}</span>}
                  </div>
                </div>
                <div className="rounded-xl bg-raised/60 p-3">
                  <div className="label mb-1">Form on the day</div>
                  <div className="num text-lg font-semibold">
                    {eventPt ? `${eventPt.tsb > 0 ? '+' : ''}${Math.round(eventPt.tsb)}` : '—'}
                    {goals.targetTsb !== undefined && <span className="text-sm font-normal text-muted"> / +{goals.targetTsb}</span>}
                  </div>
                </div>
              </div>
              {!planCoversEvent && (
                <p className="text-sm text-muted">
                  Your calendar doesn't reach the event yet, so the projection assumes rest after the last planned session.{' '}
                  {neededLoad !== undefined && (
                    <>
                      Holding about <b className="num text-ink">{Math.round(neededLoad * 7)}</b> load/week gets you to {goals.targetCtl} CTL a week out.
                    </>
                  )}
                </p>
              )}
              <Button variant="primary" onClick={() => navigate('coach', 'ask=event')}>
                <Target size={16} /> Ask the coach to plan the build
              </Button>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-muted">
              <p>Set a target event and fitness goal to see a projection and let the coach plan your build and taper.</p>
              <Button onClick={() => navigate('settings', 'section=goals')}>Set a goal</Button>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle>Weekly load</SectionTitle>
          <div className="flex h-40 items-end gap-1.5">
            {weekList.map(([wk, w]) => (
              <div key={wk} className="flex flex-1 flex-col items-center gap-1">
                <div className="num text-[10px] text-muted">{Math.round(w.load)}</div>
                <div className="w-full rounded-md" style={{ height: `${(w.load / maxWeek) * 110}px`, background: 'rgb(var(--ember))', opacity: w.projected ? 0.35 : 0.85 }} />
                <div className="text-[9px] text-faint">{formatDate(wk).replace(/^\w+ /, '')}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-ember" /> completed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-ember/40" /> planned
            </span>
            <Chip className="ml-auto">
              <TrendingUp size={11} /> max ramp {goals.maxRampPerWeek}/wk
            </Chip>
          </div>
        </Card>
      </div>
    </div>
  );
}
