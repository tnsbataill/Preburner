import type { ChangeEvent } from 'react';
import { usePlannerStore } from '../state/plannerStore.js';
import type { EfficiencyPreset, SessionType } from '../types.js';

const efficiencyPresetOptions: EfficiencyPreset[] = ['WorldClass', 'Elite', 'Competitive', 'Enthusiast'];
const sessionTypeOrder: SessionType[] = ['Endurance', 'Tempo', 'Threshold', 'VO2', 'Race', 'Rest'];

function handleNumberChange(handler: (value: number) => void) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    handler(Number(event.target.value));
  };
}

export function SettingsPanel() {
  const overrides = usePlannerStore((state) => state.overrides);
  const updateOverride = usePlannerStore((state) => state.updateOverride);
  const updateCarbBand = usePlannerStore((state) => state.updateCarbBand);
  const updateCarbSplit = usePlannerStore((state) => state.updateCarbSplit);
  const connection = usePlannerStore((state) => state.connection);
  const updateConnectionSetting = usePlannerStore((state) => state.updateConnectionSetting);
  const refreshWorkouts = usePlannerStore((state) => state.refreshWorkouts);
  const isRefreshing = usePlannerStore((state) => state.isRefreshing);
  const dataSource = usePlannerStore((state) => state.dataSource);
  const lastSyncISO = usePlannerStore((state) => state.lastSyncISO);
  const syncError = usePlannerStore((state) => state.syncError);
  const syncLog = usePlannerStore((state) => state.syncLog);

  const levelClasses: Record<'info' | 'warn' | 'error', string> = {
    info: 'text-slate-300',
    warn: 'text-amber-300',
    error: 'text-rose-300',
  };

  const rangeSummary = (() => {
    if (!connection.startDateISO) {
      return 'Select a start date';
    }
    const start = new Date(`${connection.startDateISO}T00:00:00`);
    if (Number.isNaN(start.getTime())) {
      return 'Select a valid start date';
    }
    const end = new Date(start.getTime() + connection.rangeDays * 24 * 60 * 60 * 1000);
    return `${start.toLocaleDateString()} → ${end.toLocaleDateString()}`;
  })();

  const lastSyncSummary = lastSyncISO
    ? new Date(lastSyncISO).toLocaleString()
    : dataSource === 'intervals'
      ? 'Not synced yet'
      : 'Using sample data';

  const refreshLabel = isRefreshing
    ? 'Refreshing…'
    : connection.apiKey
      ? 'Refresh from Intervals.icu'
      : 'Load sample plan';

  return (
    <aside className="space-y-6 rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm shadow-inner shadow-slate-950/40">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-emerald-200">Settings</h2>
        <p className="text-xs text-slate-400">Adjust sliders to see the plan update instantly.</p>
      </header>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Intervals.icu</h3>
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-slate-400">API key</label>
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100"
            type="password"
            placeholder="Paste your personal API key"
            value={connection.apiKey}
            onChange={(event) => updateConnectionSetting('apiKey', event.target.value)}
          />
          <p className="text-[0.65rem] text-slate-500">Stored locally in your browser via IndexedDB.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-xs uppercase tracking-wide text-slate-400">
            <span>Start date</span>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100"
              type="date"
              value={connection.startDateISO}
              onChange={(event) => updateConnectionSetting('startDateISO', event.target.value)}
            />
          </label>
          <label className="space-y-2 text-xs uppercase tracking-wide text-slate-400">
            <span>Days</span>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 accent-emerald-400"
                type="range"
                min={7}
                max={14}
                step={1}
                value={connection.rangeDays}
                onChange={handleNumberChange((value) => updateConnectionSetting('rangeDays', value))}
              />
              <span className="w-8 text-right font-semibold text-slate-200">{connection.rangeDays}</span>
            </div>
          </label>
        </div>
        <p className="text-[0.7rem] text-slate-400">Sync window: {rangeSummary}</p>
        <div className="space-y-2">
          <button
            type="button"
            className={`w-full rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
              isRefreshing
                ? 'cursor-wait bg-slate-800 text-slate-400'
                : 'bg-emerald-500 text-slate-900 hover:bg-emerald-400'
            }`}
            onClick={() => {
              void refreshWorkouts();
            }}
            disabled={isRefreshing}
          >
            {refreshLabel}
          </button>
          <div className="rounded-md border border-slate-800/80 bg-slate-950/60 p-3 text-[0.7rem] text-slate-400">
            <dl className="space-y-1">
              <div className="flex justify-between">
                <dt>Source</dt>
                <dd className="font-medium text-slate-200">{dataSource === 'intervals' ? 'Intervals.icu' : 'Sample dataset'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Last sync</dt>
                <dd className="font-medium text-slate-200">{lastSyncSummary}</dd>
              </div>
            </dl>
            {syncError ? (
              <p className="mt-2 rounded-md border border-rose-900/50 bg-rose-950/40 p-2 text-rose-200">
                {syncError}
              </p>
            ) : null}
            {syncLog.length > 0 ? (
              <div className="mt-3 space-y-2">
                <h4 className="text-[0.6rem] font-semibold uppercase tracking-wide text-slate-500">
                  Sync log
                </h4>
                <ul className="max-h-48 space-y-2 overflow-auto rounded-md border border-slate-800/60 bg-slate-950/40 p-2">
                  {syncLog.map((entry, index) => (
                    <li
                      key={`${entry.timestamp}-${index}`}
                      className="rounded-sm border border-slate-800/40 bg-slate-950/80 p-2"
                    >
                      <div className="flex items-baseline justify-between gap-2 text-[0.6rem]">
                        <span className={`${levelClasses[entry.level]} font-semibold`}>{entry.message}</span>
                        <time className="text-[0.55rem] text-slate-500">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </time>
                      </div>
                      {entry.detail ? (
                        <p className="mt-1 text-[0.55rem] text-slate-400">{entry.detail}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>Efficiency preset</span>
            <span className="font-medium text-slate-200">{overrides.efficiencyPreset}</span>
          </label>
          <select
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100"
            value={overrides.efficiencyPreset}
            onChange={(event) => updateOverride('efficiencyPreset', event.target.value as EfficiencyPreset)}
          >
            {efficiencyPresetOptions.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>Efficiency (%)</span>
            <span className="font-medium text-slate-200">{(overrides.efficiency * 100).toFixed(1)}</span>
          </label>
          <input
            className="w-full accent-emerald-400"
            type="range"
            min={18}
            max={28}
            step={0.1}
            value={overrides.efficiency * 100}
            onChange={handleNumberChange((value) => updateOverride('efficiency', value / 100))}
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>Activity factor</span>
            <span className="font-medium text-slate-200">{overrides.activityFactorDefault.toFixed(2)}</span>
          </label>
          <input
            className="w-full accent-emerald-400"
            type="range"
            min={1.2}
            max={1.9}
            step={0.01}
            value={overrides.activityFactorDefault}
            onChange={handleNumberChange((value) => updateOverride('activityFactorDefault', value))}
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>Weekly weight change (kg)</span>
            <span className="font-medium text-slate-200">{overrides.targetKgPerWeek.toFixed(2)}</span>
          </label>
          <input
            className="w-full accent-emerald-400"
            type="range"
            min={-1.5}
            max={1.5}
            step={0.05}
            value={overrides.targetKgPerWeek}
            onChange={handleNumberChange((value) => updateOverride('targetKgPerWeek', value))}
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>Deficit cap / window</span>
            <span className="font-medium text-slate-200">{Math.round(overrides.deficitCapPerWindow)}</span>
          </label>
          <input
            className="w-full accent-emerald-400"
            type="range"
            min={0}
            max={1200}
            step={10}
            value={overrides.deficitCapPerWindow}
            onChange={handleNumberChange((value) => updateOverride('deficitCapPerWindow', value))}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Macro defaults</h3>
        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>Protein (g/kg)</span>
            <span className="font-medium text-slate-200">{overrides.protein_g_per_kg.toFixed(2)}</span>
          </label>
          <input
            className="w-full accent-emerald-400"
            type="range"
            min={1.2}
            max={2.5}
            step={0.05}
            value={overrides.protein_g_per_kg}
            onChange={handleNumberChange((value) => updateOverride('protein_g_per_kg', value))}
          />
        </div>
        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>Fat min (g/kg)</span>
            <span className="font-medium text-slate-200">{overrides.fat_g_per_kg_min.toFixed(2)}</span>
          </label>
          <input
            className="w-full accent-emerald-400"
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={overrides.fat_g_per_kg_min}
            onChange={handleNumberChange((value) => updateOverride('fat_g_per_kg_min', value))}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Carb bands (g/hr)</h3>
        <div className="space-y-4">
          {sessionTypeOrder.map((session) => {
            const band = overrides.carbBands[session];
            if (!band) {
              return null;
            }
            return (
              <div key={session} className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
                  <span>{session}</span>
                  <span className="font-medium text-slate-200">{band[0]}–{band[1]}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[0.65rem] uppercase tracking-wide text-slate-500">Low</span>
                    <input
                      className="w-full accent-emerald-400"
                      type="range"
                      min={20}
                      max={120}
                      step={5}
                      value={band[0]}
                      onChange={handleNumberChange((value) => updateCarbBand(session, 0, value))}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[0.65rem] uppercase tracking-wide text-slate-500">High</span>
                    <input
                      className="w-full accent-emerald-400"
                      type="range"
                      min={band[0]}
                      max={160}
                      step={5}
                      value={band[1]}
                      onChange={handleNumberChange((value) => updateCarbBand(session, 1, value))}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Carb splits (%)</h3>
        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>Pre</span>
            <span className="font-medium text-slate-200">{overrides.carbSplit.pre}</span>
          </label>
          <input
            className="w-full accent-emerald-400"
            type="range"
            min={0}
            max={100}
            step={1}
            value={overrides.carbSplit.pre}
            onChange={handleNumberChange((value) => updateCarbSplit('pre', value))}
          />
        </div>
        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>During</span>
            <span className="font-medium text-slate-200">{overrides.carbSplit.during}</span>
          </label>
          <input
            className="w-full accent-emerald-400"
            type="range"
            min={0}
            max={100}
            step={1}
            value={overrides.carbSplit.during}
            onChange={handleNumberChange((value) => updateCarbSplit('during', value))}
          />
        </div>
        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <span>Post</span>
            <span className="font-medium text-slate-200">{overrides.carbSplit.post}</span>
          </label>
          <input
            className="w-full accent-emerald-400"
            type="range"
            min={0}
            max={100}
            step={1}
            value={overrides.carbSplit.post}
            onChange={handleNumberChange((value) => updateCarbSplit('post', value))}
          />
        </div>
      </section>

      <section className="space-y-2">
        <label className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
          <span>Glu:Fru ratio</span>
          <span className="font-medium text-slate-200">{overrides.gluFruRatio.toFixed(2)}</span>
        </label>
        <input
          className="w-full accent-emerald-400"
          type="range"
          min={0.5}
          max={1.2}
          step={0.05}
          value={overrides.gluFruRatio}
          onChange={handleNumberChange((value) => updateOverride('gluFruRatio', value))}
        />
      </section>
    </aside>
  );
}
