import { Activity, CalendarDays, Dumbbell, Flame, MessageSquareText, RefreshCw, Settings as SettingsIcon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ReviewPage } from './components/RideReview';
import { CoachPage } from './pages/CoachPage';
import { FitnessPage } from './pages/FitnessPage';
import { PlanPage } from './pages/PlanPage';
import { Onboarding } from './pages/Onboarding';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
import { WeekPage } from './pages/WeekPage';
import { useApp } from './state/store';
import { cx } from './ui/primitives';

export type Route = 'today' | 'week' | 'plan' | 'fitness' | 'coach' | 'settings' | 'review';

const NAV: Array<{ id: Route; label: string; icon: typeof Sun }> = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'week', label: 'Week', icon: CalendarDays },
  { id: 'plan', label: 'Plan', icon: Dumbbell },
  { id: 'fitness', label: 'Fitness', icon: Activity },
  { id: 'coach', label: 'Coach', icon: MessageSquareText },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function readRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  if (h === 'review') return 'review';
  return (NAV.find((n) => n.id === h)?.id ?? 'today') as Route;
}

export function navigate(route: Route, query?: string) {
  window.location.hash = `/${route}${query ? `?${query}` : ''}`;
}

function useTheme() {
  const theme = useApp((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0e' : '#f7f6f3');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function SyncButton({ compact }: { compact?: boolean }) {
  const mode = useApp((s) => s.connection.mode);
  const syncing = useApp((s) => s.syncing);
  const lastSync = useApp((s) => s.connection.lastSync);
  const error = useApp((s) => s.connection.syncError);
  const sync = useApp((s) => s.sync);
  if (mode === 'demo') {
    return (
      <button onClick={() => navigate('settings', 'section=connections')} className="rounded-full border border-amber/40 bg-amber/10 px-2.5 py-1 text-[11px] font-medium text-amber">
        Demo data
      </button>
    );
  }
  const ago = lastSync ? Math.round((Date.now() - Date.parse(lastSync)) / 60000) : undefined;
  return (
    <button
      onClick={() => void sync()}
      title={error ?? (ago !== undefined ? `Synced ${ago} min ago` : 'Sync')}
      className={cx('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted hover:bg-raised hover:text-ink', error && 'text-bad')}
    >
      <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
      {!compact && (syncing ? 'Syncing…' : error ? 'Sync failed' : ago === undefined ? 'Sync' : ago < 1 ? 'Just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`)}
    </button>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const onboarded = useApp((s) => s.onboarded);
  const mode = useApp((s) => s.connection.mode);
  const lastSync = useApp((s) => s.connection.lastSync);
  const sync = useApp((s) => s.sync);
  useTheme();

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Adjust the training plan once a day from what actually happened.
  const adaptTraining = useApp((s) => s.adaptTraining);
  const ensureReviews = useApp((s) => s.ensureReviews);
  useEffect(() => {
    adaptTraining();
  }, [adaptTraining]);
  // New rides go into the review queue. A sync queues them itself against the
  // plan as it stood before; this catches rides that appear any other way
  // (first open, demo data, an import).
  const rides = useApp((s) => s.training.intervalsRides);
  useEffect(() => {
    ensureReviews();
  }, [rides, ensureReviews]);

  // Refresh from Intervals on open if the cache is older than 15 minutes.
  useEffect(() => {
    if (mode === 'intervals' && (!lastSync || Date.now() - Date.parse(lastSync) > 15 * 60_000)) void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // An installed app on a phone is resumed, not reopened: refresh FTP, weight
  // and the calendar when it comes back to the foreground with stale data,
  // and run the daily adaptation if the day has turned over.
  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState !== 'visible') return;
      const s = useApp.getState();
      const stale = !s.connection.lastSync || Date.now() - Date.parse(s.connection.lastSync) > 15 * 60_000;
      if (s.connection.mode === 'intervals' && stale && !s.syncing) void s.sync();
      else s.adaptTraining();
    };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('pageshow', onResume);
    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('pageshow', onResume);
    };
  }, []);

  const page = {
    today: <TodayPage />,
    week: <WeekPage />,
    plan: <PlanPage />,
    fitness: <FitnessPage />,
    coach: <CoachPage />,
    settings: <SettingsPage />,
    review: <ReviewPage />,
  }[route];

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line/70 px-4 py-6 lg:flex">
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <div className="ember-bg grid h-8 w-8 place-items-center rounded-xl text-white shadow-glow">
            <Flame size={18} />
          </div>
          <span className="text-[17px] font-semibold tracking-tight">Preburner</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#/${id}`}
              className={cx(
                'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
                route === id ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink',
              )}
            >
              <Icon size={18} className={route === id ? 'text-ember' : ''} />
              {label}
            </a>
          ))}
        </nav>
        <div className="mt-auto px-2">
          <SyncButton />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <header className="safe-top sticky top-0 z-30 flex items-center justify-between border-b border-line/60 bg-bg/80 px-4 pb-3 backdrop-blur-xl [--pad-top:0.75rem] lg:hidden">
          <div className="flex items-center gap-2">
            <div className="ember-bg grid h-7 w-7 place-items-center rounded-lg text-white">
              <Flame size={15} />
            </div>
            <span className="font-semibold tracking-tight">Preburner</span>
          </div>
          <SyncButton />
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8" key={route}>
          <div className="animate-fade-up">{page}</div>
        </main>
      </div>

      {/* Mobile tab bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/85 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-md justify-around px-2 pt-1.5">
          {NAV.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#/${id}`} className={cx('flex w-14 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium', route === id ? 'text-ember' : 'text-muted')}>
              <Icon size={21} strokeWidth={route === id ? 2.4 : 1.9} />
              {label}
            </a>
          ))}
        </div>
      </nav>

      {!onboarded && <Onboarding />}
    </div>
  );
}
