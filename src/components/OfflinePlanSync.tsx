import { useEffect } from 'react';
import { usePlannerStore } from '../state/plannerStore.js';

export function OfflinePlanSync(): null {
  const status = usePlannerStore((state) => state.status);
  const windows = usePlannerStore((state) => state.windows);
  const weekly = usePlannerStore((state) => state.weekly);
  const workouts = usePlannerStore((state) => state.workouts);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      return;
    }

    const payload = {
      type: 'PREBURNER_CACHE_PLAN',
      payload: {
        windows,
        weekly,
        workouts,
        timestamp: new Date().toISOString(),
      },
    } as const;

    navigator.serviceWorker.ready
      .then((registration) => {
        registration.active?.postMessage(payload);
      })
      .catch((error) => {
        console.error('Failed to sync offline plan cache', error);
      });
  }, [status, windows, weekly, workouts]);

  return null;
}
