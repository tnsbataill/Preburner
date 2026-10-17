import { useMemo } from 'react';
import { withHealthDays, withHealthWeights } from '../health/merge';
import { useApp } from './store';

// Wellness and weights as the app should see them: synced or demo data with
// the last Apple Health import merged in (see health/merge.ts for precedence).

export function useWellness() {
  const wellness = useApp((s) => s.wellness);
  const health = useApp((s) => s.training.appleHealth);
  return useMemo(() => withHealthDays(wellness, health), [wellness, health]);
}

export function useWeights() {
  const weights = useApp((s) => s.weights);
  const health = useApp((s) => s.training.appleHealth);
  return useMemo(() => withHealthWeights(weights, health), [weights, health]);
}
