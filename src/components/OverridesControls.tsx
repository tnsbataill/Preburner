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

export function OverridesControls() {
  const overrides = usePlannerStore((state) => state.overrides);
  const updateOverride = usePlannerStore((state) => state.updateOverride);
  const updateCarbBand = usePlannerStore((state) => state.updateCarbBand);
  const updateCarbSplit = usePlannerStore((state) => state.updateCarbSplit);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
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
      </section>

      <section className="space-y-4">
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
    </div>
  );
}
