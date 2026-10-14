import { expect, test } from '@playwright/test';

// The v1 app stored its Intervals key in IndexedDB "PreburnerPlanner". v2 must
// pick it up on first run without modifying the old database.
test('imports the Intervals key and preferences from the v1 database', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('PreburnerPlanner', 30);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('settings', { keyPath: 'id' });
          db.createObjectStore('connections', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const tx = req.result.transaction(['settings', 'connections'], 'readwrite');
          tx.objectStore('connections').put({ id: 'intervals', apiKey: 'legacy-key-123', athleteId: '0' });
          tx.objectStore('settings').put({ id: 'active', overrides: { targetKgPerWeek: -0.35, protein_g_per_kg: 2.0 } });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
        req.onerror = () => reject(req.error);
      }),
  );
  await page.reload();
  await expect(page.getByText('Found your key and preferences')).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveValue('legacy-key-123');
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('preburner-v2') ?? '{}').state);
  expect(state.settings.nutrition.proteinGPerKg).toBe(2);
  expect(state.settings.goals.weeklyRateKg).toBe(-0.35);
});
