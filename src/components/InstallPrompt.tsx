import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia('(display-mode: standalone)').matches;
}

export function InstallPrompt(): JSX.Element | null {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(isStandaloneDisplay());

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDismissed(false);
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleMediaChange = () => {
      if (mediaQuery.matches) {
        setInstalled(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', handleInstalled);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleMediaChange);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', handleInstalled);
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleMediaChange);
      } else if (typeof mediaQuery.removeListener === 'function') {
        mediaQuery.removeListener(handleMediaChange);
      }
    };
  }, []);

  if (installed || dismissed || !deferredPrompt) {
    return null;
  }

  const handleInstall = async () => {
    try {
      await deferredPrompt.prompt();
      const outcome = await deferredPrompt.userChoice;
      if (outcome.outcome !== 'accepted') {
        setDeferredPrompt(null);
      }
    } catch (error) {
      console.error('Unable to trigger install prompt', error);
      setDeferredPrompt(null);
      return;
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setDismissed(true);
    setDeferredPrompt(null);
  };

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100 shadow-inner shadow-emerald-500/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-semibold text-emerald-100">Install Preburner</p>
          <p className="text-xs text-emerald-200/80">
            Add the planner to your home screen so the latest synced plan stays available offline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleInstall}
            className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-950 shadow hover:bg-emerald-400"
          >
            Install app
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-full border border-emerald-500/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-200 hover:bg-emerald-500/20"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
