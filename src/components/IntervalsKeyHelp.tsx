import { ClipboardPaste, ExternalLink, HelpCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, Sheet } from '../ui/primitives';

const SETTINGS_URL = 'https://intervals.icu/settings';

const STEPS = [
  <>Open Intervals.icu with the button below and sign in if it asks.</>,
  <>
    Scroll to the bottom of the page to <b>Developer Settings</b>.
  </>,
  <>
    Next to <b>API Key</b>, click <b>Generate</b> if there's no key yet, then copy it.
  </>,
  <>Come back here and paste it in.</>,
];

/** A button that walks the user through getting a personal Intervals.icu API key. */
export function IntervalsKeyHelp({ onKey }: { onKey: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pasteError, setPasteError] = useState(false);
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return setPasteError(true);
      onKey(text);
      setOpen(false);
    } catch {
      setPasteError(true);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setPasteError(false);
          setOpen(true);
        }}
      >
        <HelpCircle size={16} /> Help me get my key
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Get your Intervals.icu API key">
        <p className="mb-4 text-sm text-muted">Preburner reads your training through a personal key. It takes about a minute, and the key stays in this browser.</p>
        <ol className="mb-5 space-y-3">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold">{i + 1}</span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="primary" className="sm:flex-1" onClick={() => window.open(SETTINGS_URL, '_blank', 'noopener,noreferrer')}>
            <ExternalLink size={16} /> Open Intervals.icu
          </Button>
          {canPaste && (
            <Button type="button" className="sm:flex-1" onClick={() => void paste()}>
              <ClipboardPaste size={16} /> Paste my key
            </Button>
          )}
        </div>
        {pasteError && <p className="mt-3 text-sm text-bad">Couldn't read the clipboard. Close this and paste the key into the field instead.</p>}
      </Sheet>
    </>
  );
}
