import { SettingsPanel } from '../components/SettingsPanel.js';

export function SettingsPage() {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-100">Settings</h2>
        <p className="text-sm text-slate-400">
          Connect to Intervals.icu and fine tune the assumptions that drive the nutrition and deficit planning engine.
        </p>
      </header>

      <SettingsPanel />
    </section>
  );
}
