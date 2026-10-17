import { HeartPulse, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../state/store';
import { formatDate } from '../engine/time';
import { Button } from '../ui/primitives';

// Apple Health import. Browsers can't read HealthKit, so this takes the export
// from the Health app and keeps weight, body fat, resting HR, HRV and sleep.

export function AppleHealthImport() {
  const importAppleHealth = useApp((s) => s.importAppleHealth);
  const health = useApp((s) => s.training.appleHealth);
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const onFile = async (f: File) => {
    setError(undefined);
    setProgress(0);
    try {
      await importAppleHealth(f, setProgress);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(undefined);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const r = health?.report;
  const rows: Array<[string, number, string[]]> = r
    ? [
        ['Weight', r.counts.weight, r.sources.weight],
        ['Body fat', r.counts.bodyFat, r.sources.bodyFat],
        ['Resting HR', r.counts.restingHR, r.sources.restingHR],
        ['HRV (SDNN)', r.counts.hrv, r.sources.hrv],
        ['Sleep', r.counts.sleep, r.sources.sleep],
      ]
    : [];
  return (
    <div className="space-y-3" data-testid="apple-health">
      <p className="text-sm text-muted">
        On your iPhone: Health → your picture → <span className="text-ink">Export All Health Data</span>, then choose the zip here (it can take a few minutes to make). Weight, body fat, resting HR, HRV and sleep from the last 400 days are kept; nothing else is read.
      </p>
      <input ref={fileRef} type="file" accept=".zip,.xml,application/zip,text/xml,application/xml" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} data-testid="apple-health-file" />
      <Button variant="ghost" disabled={progress !== undefined} onClick={() => fileRef.current?.click()}>
        {progress !== undefined ? <HeartPulse size={16} className="animate-pulse" /> : <Upload size={16} />}
        {progress !== undefined ? `Reading… ${Math.round(progress * 100)}%` : health ? 'Import a newer export' : 'Import Apple Health export'}
      </Button>
      {error && <p className="text-sm text-bad">{error}</p>}
      {r && (
        <div className="rounded-xl border border-line/70 p-3 text-sm" data-testid="apple-health-report">
          <div className="text-muted">
            Imported {formatDate(health!.importedAt.slice(0, 10))}: {r.days} days{r.first && r.last ? `, ${formatDate(r.first)} – ${formatDate(r.last)}` : ''}
          </div>
          <ul className="mt-2 space-y-1">
            {rows.map(([label, n, sources]) => (
              <li key={label} className="flex flex-wrap justify-between gap-x-3">
                <span>
                  {label} <span className="num text-muted">{n} days</span>
                </span>
                <span className="min-w-0 text-muted">{sources.join(', ') || '—'}</span>
              </li>
            ))}
          </ul>
          {r.appliedBodyFat && (
            <p className="mt-2 text-muted">
              Body fat {r.appliedBodyFat.pct}% ({formatDate(r.appliedBodyFat.date)}) is now your profile's body fat. It sets fat-free mass, which the energy-availability floor uses.
            </p>
          )}
          <p className="mt-2 text-muted">Check that these look right. Weight: a manual entry, then Apple Health, then Intervals. Resting HR and sleep: Intervals' value when it has one, otherwise Apple's. HRV: readiness uses Intervals' rMSSD when it has enough days, otherwise Apple's SDNN, never both together.</p>
        </div>
      )}
    </div>
  );
}
