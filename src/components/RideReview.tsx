import { ArrowLeft, ArrowRight, Bike, Check, CircleSlash, PlugZap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { navigate } from '../App';
import { addDays, formatClock, formatDate, formatDuration } from '../engine/time';
import { useApp } from '../state/store';
import { currentTsb, historyRides } from '../state/training';
import { useToday } from '../state/usePlan';
import { mergeRides } from '../training/history/intervals';
import type { RideRecord } from '../training/history/types';
import { type PlanChange, planChanges, reviewCandidates } from '../training/review';
import { Button, Card, Chip, SectionTitle, cx } from '../ui/primitives';
import { KIND_LABEL, RideFeedback } from './TrainingCards';
import { WorkoutProfile } from './WorkoutProfile';

// New rides: a card on Today for each one not yet reviewed, and a review
// screen with how it went, the questions that steer the plan, and what
// changed because of it.

function useRideTitle() {
  const workouts = useApp((s) => s.workouts);
  const plan = useApp((s) => s.training.plan);
  const stravaOnly = useApp((s) => s.training.intervalsRides);
  return (r: RideRecord) => {
    if (stravaOnly.some((x) => x.id === r.id && x.noData)) return 'Ride via Strava';
    const named = workouts.find((w) => w.id === r.id)?.title;
    if (named) return named;
    const s = r.plannedId ? plan?.sessions.find((x) => x.id === r.plannedId) : undefined;
    if (s) return s.title;
    return r.noData ? 'Ride via Strava' : r.kind ? KIND_LABEL[r.kind] ?? 'Ride' : 'Ride';
  };
}

/** The ride as the app sees it: with data, filled in, or a Strava-only placeholder. */
function useReviewRide(rideId: string | undefined) {
  const training = useApp((s) => s.training);
  return useMemo(() => {
    if (!rideId) return undefined;
    const full = historyRides(training).find((r) => r.id === rideId);
    if (full) return full;
    return mergeRides(training.intervalsRides, training.stravaRides).find((r) => r.id === rideId);
  }, [training, rideId]);
}

export function NewRideCard() {
  const training = useApp((s) => s.training);
  const today = useToday();
  const title = useRideTitle();
  const pending = useMemo(() => {
    const all = reviewCandidates(training.intervalsRides, training.stravaRides, today);
    return Object.values(training.reviews ?? {})
      .filter((r) => !r.doneAt && r.date >= addDays(today, -2))
      .map((r) => ({ review: r, ride: historyRides(training).find((x) => x.id === r.rideId) ?? all.find((x) => x.id === r.rideId) }))
      .filter((x): x is { review: typeof x.review; ride: RideRecord } => !!x.ride && !training.rideDetails?.[x.ride.id]?.notRide)
      .sort((a, b) => (a.ride.date < b.ride.date ? 1 : -1));
  }, [training, today]);
  if (!pending.length) return null;
  return (
    <Card className="border-ember/40 p-4" data-testid="new-ride-card">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <Bike size={14} /> New {pending.length === 1 ? 'ride' : 'rides'}
        </span>
      </SectionTitle>
      <ul className="space-y-2">
        {pending.map(({ ride }) => (
          <li key={ride.id}>
            <button onClick={() => navigate('review', `ride=${encodeURIComponent(ride.id)}`)} className="flex w-full items-center gap-3 rounded-xl border border-line/70 p-3 text-left transition hover:bg-raised/60">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{title(ride)}</span>
                <span className="num block text-xs text-muted">
                  {formatDate(ride.date, { weekday: true })}
                  {ride.startMin !== undefined && ` · ${formatClock(ride.startMin)}`}
                  {ride.noData ? ' · via Strava, no data' : ` · ${formatDuration(ride.durationMin)} · ${ride.tss} TSS`}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-ember">
                Review <ArrowRight size={14} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function readRideParam() {
  const q = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q).get('ride') ?? undefined;
}

const signed = (x: number, digits = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;

function ChangeLine({ c }: { c: PlanChange }) {
  const d = (x: string) => formatDate(x, { weekday: true });
  switch (c.type) {
    case 'moved':
      return (
        <>
          <b className="font-medium">{c.title}</b> moved from {d(c.from)} to {d(c.to)}
        </>
      );
    case 'harder':
    case 'easier':
      return (
        <>
          <b className="font-medium">{c.title}</b> ({d(c.date)}) is {c.type}: {c.fromLevel !== c.toLevel ? `level ${c.fromLevel} → ${c.toLevel}, ` : ''}
          {c.fromTss} → {c.toTss} TSS
        </>
      );
    case 'replaced':
      return (
        <>
          {d(c.date)}: <b className="font-medium">{c.from}</b> became {c.to}
        </>
      );
    case 'added':
      return (
        <>
          Added <b className="font-medium">{c.title}</b> on {d(c.date)}
        </>
      );
    case 'removed':
      return (
        <>
          Removed <b className="font-medium">{c.title}</b> on {d(c.date)}
        </>
      );
  }
}

const CHANGE_TONE: Record<PlanChange['type'], string> = {
  harder: 'rgb(var(--ember))',
  easier: 'rgb(var(--good))',
  moved: 'rgb(var(--protein))',
  replaced: 'rgb(var(--warn))',
  added: 'rgb(var(--protein))',
  removed: 'rgb(var(--muted))',
};

function StravaDetails({ ride }: { ride: RideRecord }) {
  const details = useApp((s) => s.training.rideDetails?.[ride.id]);
  const setRideDetails = useApp((s) => s.setRideDetails);
  const [minutes, setMinutes] = useState(details?.durationMin ? String(details.durationMin) : '');
  return (
    <div className="space-y-3" data-testid="strava-details">
      <div className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/5 p-3 text-sm">
        <PlugZap size={16} className="mt-0.5 shrink-0 text-warn" />
        <p className="text-muted">
          This ride reached Intervals.icu through Strava, and Intervals can't share Strava's ride data. Tell Preburner how long it was and how hard it felt, and it estimates the load. For full data, connect your bike computer to Intervals directly (Intervals → Settings → Connections).
        </p>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Moving time (minutes)</span>
        <input
          type="number"
          inputMode="numeric"
          min={5}
          max={600}
          className="w-32 rounded-xl border border-line bg-raised/50 px-3 py-2 text-sm outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/20"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          onBlur={() => Number(minutes) >= 5 && setRideDetails(ride.id, { durationMin: Math.round(Number(minutes)), notRide: false })}
          aria-label="Moving time in minutes"
        />
      </label>
      <button onClick={() => setRideDetails(ride.id, { notRide: true })} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
        <CircleSlash size={12} /> It wasn't a ride (leave it out)
      </button>
    </div>
  );
}

export function ReviewPage() {
  const rideId = readRideParam();
  const training = useApp((s) => s.training);
  const profileFtp = useApp((s) => s.settings.profile.ftp);
  const markReviewed = useApp((s) => s.markReviewed);
  const today = useToday();
  const ride = useReviewRide(rideId);
  const title = useRideTitle();
  const review = rideId ? training.reviews?.[rideId] : undefined;
  const plan = training.plan;
  const session = ride?.plannedId ? plan?.sessions.find((s) => s.id === ride.plannedId) : undefined;
  const changes = useMemo(() => (review ? planChanges(review.baseline, plan?.sessions, today) : []), [review, plan, today]);
  const fitness = useMemo(() => {
    if (!ride || ride.noData) return undefined;
    const rides = historyRides(training);
    const after = currentTsb(rides, addDays(today, 1));
    const before = currentTsb(
      rides.filter((r) => r.id !== ride.id),
      addDays(today, 1),
    );
    return { ctl: after.ctl - before.ctl, form: after.tsb };
  }, [training, ride, today]);
  if (!rideId || !ride) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted">That ride isn't in the app any more.</p>
        <Button variant="ghost" className="mt-3" onClick={() => navigate('today')}>
          <ArrowLeft size={16} /> Back to Today
        </Button>
      </Card>
    );
  }
  const ftpNow = training.ftp ?? profileFtp;
  const ftpBefore = review?.baseline.ftp;
  const readinessBefore = review?.baseline.readiness;
  const readinessNow = training.readiness?.level;
  // Strava-only, whether or not the athlete has filled it in yet (they can correct it).
  const stub = training.intervalsRides.some((r) => r.id === ride.id && r.noData);
  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="ride-review">
      <button onClick={() => navigate('today')} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> Today
      </button>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Ride review</div>
        <h1 className="text-2xl font-semibold tracking-tight">{title(ride)}</h1>
        <div className="num mt-1 text-sm text-muted">
          {formatDate(ride.date, { weekday: true })}
          {ride.startMin !== undefined && ` · ${formatClock(ride.startMin)}`}
          {!ride.noData && ` · ${formatDuration(ride.durationMin)} · ${ride.tss} TSS`}
          {ride.estimated && ' (estimated)'}
          {ride.assumed && ' · assumed as planned'}
        </div>
      </div>

      {stub && (
        <Card className="p-5">
          <StravaDetails ride={ride} />
        </Card>
      )}

      {session && (
        <Card className="p-5">
          <SectionTitle>Planned vs ridden</SectionTitle>
          <WorkoutProfile steps={session.steps} className="mb-3 h-12 w-full rounded-md" />
          <div className="num grid grid-cols-3 gap-2 text-sm">
            <span className="text-muted">Planned</span>
            <span>{formatDuration(session.durationMin)}</span>
            <span>{session.tss} TSS</span>
            <span className="text-muted">Ridden</span>
            <span>{ride.assumed ? '—' : formatDuration(ride.durationMin)}</span>
            <span>{ride.assumed ? '—' : `${ride.tss} TSS`}</span>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle>How did it go?</SectionTitle>
        <RideFeedback ride={ride} showTitle={false} />
        <p className="mt-3 text-xs text-muted">Your answers steer the plan: easier than usual moves the next sessions of this kind up, harder holds them or steps back.</p>
      </Card>

      <Card className="p-5" data-testid="review-changes">
        <SectionTitle>What changed</SectionTitle>
        {fitness && (
          <p className="num text-sm">
            Fitness (CTL) {signed(fitness.ctl, 1)} · form tomorrow {signed(fitness.form)}
          </p>
        )}
        {!plan ? (
          <p className="mt-2 text-sm text-muted">No training plan yet, so nothing was adjusted.</p>
        ) : changes.length ? (
          <ul className="mt-2 space-y-1.5 text-sm">
            {changes.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: CHANGE_TONE[c.type] }} />
                <span>
                  <ChangeLine c={c} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Your plan hasn't changed. Rating the effort above may move the next sessions of this kind.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ftpBefore !== undefined && ftpBefore !== ftpNow && (
            <Chip color="rgb(var(--ember))">
              FTP {ftpBefore} → {ftpNow} W
            </Chip>
          )}
          {training.ftpSuggestion && <Chip color="rgb(var(--ember))">Suggested FTP {training.ftpSuggestion.ftp} W</Chip>}
          {readinessNow && readinessBefore && readinessNow !== readinessBefore && (
            <Chip>
              Readiness {readinessBefore} → {readinessNow}
            </Chip>
          )}
        </div>
        {review?.batch && review.batch.length > 1 && <p className="mt-3 text-xs text-muted">This arrived with {review.batch.length - 1} other {review.batch.length === 2 ? 'ride' : 'rides'}; the changes include theirs.</p>}
      </Card>

      <Button
        variant="primary"
        className={cx('w-full justify-center sm:w-auto')}
        onClick={() => {
          markReviewed(ride.id);
          navigate('today');
        }}
      >
        <Check size={16} /> Done
      </Button>
    </div>
  );
}
