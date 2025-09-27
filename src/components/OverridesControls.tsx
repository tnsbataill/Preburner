import { useId, type ChangeEvent } from 'react';
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

  const efficiencyPresetId = useId();
  const efficiencyId = useId();
  const activityFactorId = useId();
  const weightChangeId = useId();
  const deficitCapId = useId();
  const proteinId = useId();
  const fatId = useId();
  const carbSplitIdPrefix = useId();
  const gluFruId = useId();
  const carbBandIdPrefix = useId();

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <label
          className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400"
          htmlFor={efficiencyPresetId}
        >
          <span>Efficiency preset</span>
          <span className="font-medium text-slate-200">{overrides.efficiencyPreset}</span>
        </label>
        <select
          className="w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100"
          value={overrides.efficiencyPreset}
          id={efficiencyPresetId}
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
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <label htmlFor={efficiencyId}>Efficiency (%)</label>
            <span className="font-medium text-slate-200">{(overrides.efficiency * 100).toFixed(1)}</span>
          </div>
          <input
            className="w-full accent-emerald-400"
            type="range"
            id={efficiencyId}
            min={18}
            max={28}
            step={0.1}
            value={overrides.efficiency * 100}
            aria-valuemin={18}
            aria-valuemax={28}
            aria-valuenow={Number((overrides.efficiency * 100).toFixed(1))}
            aria-valuetext={`${(overrides.efficiency * 100).toFixed(1)} percent`}
            onChange={handleNumberChange((value) => updateOverride('efficiency', value / 100))}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <label htmlFor={activityFactorId}>Activity factor</label>
            <span className="font-medium text-slate-200">{overrides.activityFactorDefault.toFixed(2)}</span>
          </div>
          <input
            className="w-full accent-emerald-400"
            type="range"
            id={activityFactorId}
            min={1.2}
            max={1.9}
            step={0.01}
            value={overrides.activityFactorDefault}
            aria-valuemin={1.2}
            aria-valuemax={1.9}
            aria-valuenow={Number(overrides.activityFactorDefault.toFixed(2))}
            aria-valuetext={`${overrides.activityFactorDefault.toFixed(2)} activity factor`}
            onChange={handleNumberChange((value) => updateOverride('activityFactorDefault', value))}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <label htmlFor={weightChangeId}>Weekly weight change (kg)</label>
            <span className="font-medium text-slate-200">{overrides.targetKgPerWeek.toFixed(2)}</span>
          </div>
          <input
            className="w-full accent-emerald-400"
            type="range"
            id={weightChangeId}
            min={-1.5}
            max={1.5}
            step={0.05}
            value={overrides.targetKgPerWeek}
            aria-valuemin={-1.5}
            aria-valuemax={1.5}
            aria-valuenow={Number(overrides.targetKgPerWeek.toFixed(2))}
            aria-valuetext={`${overrides.targetKgPerWeek.toFixed(2)} kilograms per week`}
            onChange={handleNumberChange((value) => updateOverride('targetKgPerWeek', value))}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <label htmlFor={deficitCapId}>Deficit cap / window</label>
            <span className="font-medium text-slate-200">{Math.round(overrides.deficitCapPerWindow)}</span>
          </div>
          <input
            className="w-full accent-emerald-400"
            type="range"
            id={deficitCapId}
            min={0}
            max={1200}
            step={10}
            value={overrides.deficitCapPerWindow}
            aria-valuemin={0}
            aria-valuemax={1200}
            aria-valuenow={Math.round(overrides.deficitCapPerWindow)}
            aria-valuetext={`${Math.round(overrides.deficitCapPerWindow)} kilocalories`}
            onChange={handleNumberChange((value) => updateOverride('deficitCapPerWindow', value))}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Macro defaults</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <label htmlFor={proteinId}>Protein (g/kg)</label>
            <span className="font-medium text-slate-200">{overrides.protein_g_per_kg.toFixed(2)}</span>
          </div>
          <input
            className="w-full accent-emerald-400"
            type="range"
            id={proteinId}
            min={1.2}
            max={2.5}
            step={0.05}
            value={overrides.protein_g_per_kg}
            aria-valuemin={1.2}
            aria-valuemax={2.5}
            aria-valuenow={Number(overrides.protein_g_per_kg.toFixed(2))}
            aria-valuetext={`${overrides.protein_g_per_kg.toFixed(2)} grams per kilogram`}
            onChange={handleNumberChange((value) => updateOverride('protein_g_per_kg', value))}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <label htmlFor={fatId}>Fat min (g/kg)</label>
            <span className="font-medium text-slate-200">{overrides.fat_g_per_kg_min.toFixed(2)}</span>
          </div>
          <input
            className="w-full accent-emerald-400"
            type="range"
            id={fatId}
            min={0.5}
            max={1.5}
            step={0.05}
            value={overrides.fat_g_per_kg_min}
            aria-valuemin={0.5}
            aria-valuemax={1.5}
            aria-valuenow={Number(overrides.fat_g_per_kg_min.toFixed(2))}
            aria-valuetext={`${overrides.fat_g_per_kg_min.toFixed(2)} grams per kilogram`}
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
                  <div className="space-y-1">
                    <label
                      className="text-[0.65rem] uppercase tracking-wide text-slate-500"
                      htmlFor={`${carbBandIdPrefix}-${session}-low`}
                    >
                      Low
                    </label>
                    <input
                      className="w-full accent-emerald-400"
                      type="range"
                      id={`${carbBandIdPrefix}-${session}-low`}
                      min={20}
                      max={120}
                      step={5}
                      value={band[0]}
                      aria-valuemin={20}
                      aria-valuemax={120}
                      aria-valuenow={band[0]}
                      aria-valuetext={`${band[0]} grams per hour minimum`}
                      onChange={handleNumberChange((value) => updateCarbBand(session, 0, value))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      className="text-[0.65rem] uppercase tracking-wide text-slate-500"
                      htmlFor={`${carbBandIdPrefix}-${session}-high`}
                    >
                      High
                    </label>
                    <input
                      className="w-full accent-emerald-400"
                      type="range"
                      id={`${carbBandIdPrefix}-${session}-high`}
                      min={band[0]}
                      max={160}
                      step={5}
                      value={band[1]}
                      aria-valuemin={band[0]}
                      aria-valuemax={160}
                      aria-valuenow={band[1]}
                      aria-valuetext={`${band[1]} grams per hour maximum`}
                      onChange={handleNumberChange((value) => updateCarbBand(session, 1, value))}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Carb splits (%)</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <label htmlFor={`${carbSplitIdPrefix}-pre`}>Pre</label>
            <span className="font-medium text-slate-200">{overrides.carbSplit.pre}</span>
          </div>
          <input
            className="w-full accent-emerald-400"
            type="range"
            id={`${carbSplitIdPrefix}-pre`}
            min={0}
            max={100}
            step={1}
            value={overrides.carbSplit.pre}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={overrides.carbSplit.pre}
            aria-valuetext={`${overrides.carbSplit.pre} percent pre-workout`}
            onChange={handleNumberChange((value) => updateCarbSplit('pre', value))}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <label htmlFor={`${carbSplitIdPrefix}-during`}>During</label>
            <span className="font-medium text-slate-200">{overrides.carbSplit.during}</span>
          </div>
          <input
            className="w-full accent-emerald-400"
            type="range"
            id={`${carbSplitIdPrefix}-during`}
            min={0}
            max={100}
            step={1}
            value={overrides.carbSplit.during}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={overrides.carbSplit.during}
            aria-valuetext={`${overrides.carbSplit.during} percent during`}
            onChange={handleNumberChange((value) => updateCarbSplit('during', value))}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
            <label htmlFor={`${carbSplitIdPrefix}-post`}>Post</label>
            <span className="font-medium text-slate-200">{overrides.carbSplit.post}</span>
          </div>
          <input
            className="w-full accent-emerald-400"
            type="range"
            id={`${carbSplitIdPrefix}-post`}
            min={0}
            max={100}
            step={1}
            value={overrides.carbSplit.post}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={overrides.carbSplit.post}
            aria-valuetext={`${overrides.carbSplit.post} percent post-workout`}
            onChange={handleNumberChange((value) => updateCarbSplit('post', value))}
          />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
          <label htmlFor={gluFruId}>Glu:Fru ratio</label>
          <span className="font-medium text-slate-200">{overrides.gluFruRatio.toFixed(2)}</span>
        </div>
        <input
          className="w-full accent-emerald-400"
          type="range"
          id={gluFruId}
          min={0.5}
          max={1.2}
          step={0.05}
          value={overrides.gluFruRatio}
          aria-valuemin={0.5}
          aria-valuemax={1.2}
          aria-valuenow={Number(overrides.gluFruRatio.toFixed(2))}
          aria-valuetext={`${overrides.gluFruRatio.toFixed(2)} glucose to fructose ratio`}
          onChange={handleNumberChange((value) => updateOverride('gluFruRatio', value))}
        />
      </section>
    </div>
  );
}
