import { useState } from 'react';
import { OverridesControls } from './OverridesControls.js';

export function QuickAdjustmentsPanel() {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <aside className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm shadow-inner shadow-slate-950/40">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-emerald-200">Plan adjustments</h2>
          <p className="text-xs text-slate-400">
            Tweak nutrition and deficit assumptions without leaving the current view.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          className="rounded-full border border-emerald-500/60 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-200 transition-colors hover:bg-emerald-500/10"
        >
          {isOpen ? 'Hide' : 'Show'}
        </button>
      </header>

      {isOpen ? (
        <OverridesControls />
      ) : (
        <p className="text-xs text-slate-500">
          Adjustments hidden. Visit the <span className="text-emerald-300">Settings</span> tab for full controls and API sync
          options.
        </p>
      )}
    </aside>
  );
}
