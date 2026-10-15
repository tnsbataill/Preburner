import { describe, expect, it } from 'vitest';
import { backtest, summarize } from '../sim/experiments';
import { STRATEGIES, runStrategy } from '../sim/strategies';

// Seeded regression on the synthetic-athlete world (small population so it
// runs in seconds; scripts/sim-*.ts run the full-size experiments). These are
// claims about a simulated world, not about real athletes: they guard
// against changes that break the fitting or the planner, nothing more.

describe('simulation regression', () => {
  it('the individual fit predicts true FTP better than persistence and priors', () => {
    const rows = backtest(
      Array.from({ length: 16 }, (_, i) => i + 1),
      ['prior', 'core'],
    );
    const mape = summarize(rows, 'mape');
    expect(mape.core.mean).toBeLessThan(mape.persistence.mean);
    expect(mape.core.mean).toBeLessThan(mape.prior.mean);
    expect(mape.core.mean).toBeLessThan(0.025);
  }, 120_000);

  it('optimised plans on the individual fit beat the static template on true FTP', () => {
    const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
    const cfg = { weeks: 8, objective: 'ftp' as const };
    const mean = (name: string) => seeds.reduce((s, seed) => s + runStrategy(seed, STRATEGIES[name], cfg).gain, 0) / seeds.length;
    const stat = mean('static');
    const opt = mean('opt-core');
    expect(opt).toBeGreaterThan(stat);
    expect(opt).toBeGreaterThan(0.015);
  }, 180_000);
});
