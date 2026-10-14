import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { enumerateWindowSlices } from '../../utils/windowSlices.js';
import type { WindowPlan } from '../../types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SNAPSHOT_DIR = path.resolve(__dirname, '../snapshots');

const snapshotFiles = fs.existsSync(SNAPSHOT_DIR)
  ? fs.readdirSync(SNAPSHOT_DIR).filter((file) => file.endsWith('.json'))
  : [];

describe('Planner snapshot coverage', () => {
  if (snapshotFiles.length === 0) {
    it.skip('No planner snapshots captured', () => {});
    return;
  }

  for (const file of snapshotFiles) {
    const snapshotPath = path.join(SNAPSHOT_DIR, file);
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as { windows?: WindowPlan[] };

    it(`${file} windows are contiguous`, () => {
      const windows = (snapshot.windows ?? []).slice().sort(
        (a, b) => new Date(a.windowStartISO).getTime() - new Date(b.windowStartISO).getTime(),
      );
      for (let i = 1; i < windows.length; i += 1) {
        const prevEnd = new Date(windows[i - 1].windowEndISO).getTime();
        const nextStart = new Date(windows[i].windowStartISO).getTime();
        const gapDays = (nextStart - prevEnd) / MS_PER_DAY;
        expect(gapDays).toBeLessThanOrEqual(1.01);
      }
    });

    it(`${file} window slices advance day-by-day`, () => {
      const windows = snapshot.windows ?? [];
      windows.forEach((window) => {
        const slices = enumerateWindowSlices(window);
        for (let i = 1; i < slices.length; i += 1) {
          const prev = new Date(slices[i - 1].dayStartISO).getTime();
          const curr = new Date(slices[i].dayStartISO).getTime();
          const diffDays = (curr - prev) / MS_PER_DAY;
          expect(diffDays).toBeLessThanOrEqual(1);
        }
      });
    });
  }
});
