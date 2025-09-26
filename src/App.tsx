import { useEffect, useMemo } from 'react';
import { SettingsPanel } from './components/SettingsPanel.js';
import { WeightTracker } from './components/WeightTracker.js';
import { OnboardingPage } from './pages/OnboardingPage.js';
import { PlannerPage } from './pages/PlannerPage.js';
import { WeeklyPage } from './pages/WeeklyPage.js';
import { WindowsPage } from './pages/WindowsPage.js';
import { usePlannerStore } from './state/plannerStore.js';
import type { PlannerPage as PlannerPageKey } from './state/types.js';

const pageDefinitions: { key: PlannerPageKey; label: string }[] = [
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'planner', label: 'Planner' },
  { key: 'windows', label: 'Windows' },
  { key: 'weekly', label: 'Weekly' },
];

function usePlannerInitialization() {
  const init = usePlannerStore((state) => state.init);

  useEffect(() => {
    void init();
  }, [init]);
}

function PageContent({ page }: { page: PlannerPageKey }) {
  switch (page) {
    case 'planner':
      return <PlannerPage />;
    case 'windows':
      return <WindowsPage />;
    case 'weekly':
      return <WeeklyPage />;
    case 'onboarding':
    default:
      return <OnboardingPage />;
  }
}

export default function App() {
  usePlannerInitialization();

  const status = usePlannerStore((state) => state.status);
  const error = usePlannerStore((state) => state.error);
  const page = usePlannerStore((state) => state.page);
  const setPage = usePlannerStore((state) => state.setPage);
  const currentProfile = usePlannerStore((state) => state.profile);

  const headerSummary = useMemo(() => {
    const efficiency = (currentProfile.efficiency * 100).toFixed(1);
    const weight = currentProfile.weight_kg.toFixed(1);
    return `${weight} kg • Efficiency ${efficiency}%`;
  }, [currentProfile.efficiency, currentProfile.weight_kg]);

  let content: JSX.Element;
  if (status === 'error') {
    content = (
      <div className="rounded-lg border border-rose-900/60 bg-rose-950/60 p-4 text-sm text-rose-200">
        Failed to load sample data: {error}
      </div>
    );
  } else if (status !== 'ready') {
    content = (
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-400">
        Loading sample workouts and computing nutrition plan…
      </div>
    );
  } else {
    content = <PageContent page={page} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Preburner Planner</h1>
              <p className="text-sm text-slate-400">Fake adapter → core engine → reactive UI.</p>
            </div>
            <p className="text-xs uppercase tracking-wide text-slate-500">{headerSummary}</p>
          </div>

          <nav className="flex flex-wrap gap-2">
            {pageDefinitions.map((definition) => {
              const isActive = page === definition.key;
              return (
                <button
                  key={definition.key}
                  type="button"
                  onClick={() => setPage(definition.key)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    isActive
                      ? 'bg-emerald-500 text-slate-900'
                      : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {definition.label}
                </button>
              );
            })}
          </nav>
        </header>

        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="lg:w-80">
            <SettingsPanel />
          </div>
          <main className="flex-1 space-y-6">
            <WeightTracker />
            {content}
          </main>
        </div>
      </div>
    </div>
  );
}
