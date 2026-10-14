import { type Page, expect, test } from '@playwright/test';

// Full end-to-end runs of the real app on its built-in demo provider —
// no mocks; engine, store, persistence and UI all run for real.

async function onboardWithDemo(page: Page) {
  await page.goto('/');
  await page.getByText('Explore with demo data first').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Show my plan' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

test('first run: demo onboarding lands on a timed day plan', async ({ page }) => {
  await onboardWithDemo(page);
  await expect(page.getByText('Eat today')).toBeVisible();
  await expect(page.getByText(/Breakfast/).first()).toBeVisible();
  // Settings persist across reload; onboarding does not reappear.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText('Eat for the work')).toHaveCount(0);
});

test('setting the real start time of a date-only session re-times the meals', async ({ page }) => {
  await onboardWithDemo(page);
  // Pick the first upcoming day with an untimed session.
  const strip = page.locator('[data-selected]');
  const n = await strip.count();
  for (let i = 0; i < n; i += 1) {
    await strip.nth(i).click();
    if (await page.getByText('Time assumed').first().isVisible().catch(() => false)) break;
  }
  await page.getByText('Time assumed').first().click();
  await page.getByRole('button', { name: '6am' }).click();
  await expect(page.getByText('Time assumed')).toHaveCount(0);
  await expect(page.getByText(/Pre-ride (snack|bite)/).first()).toBeVisible();
  await expect(page.locator('li').filter({ hasText: 'Pre-ride' }).first()).toContainText(/5:\d\dam|5am/);
});

test('ticking a meal off persists', async ({ page }) => {
  await onboardWithDemo(page);
  const first = page.getByRole('button', { name: 'Mark eaten' }).first();
  await first.click();
  await expect(page.getByRole('button', { name: 'Mark not eaten' })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Mark not eaten' })).toHaveCount(1);
});

test('a weight-loss goal puts a deficit on easy days only', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/settings?section=goals');
  const rate = page.locator('#goals input[type=range]').first();
  await rate.fill('-0.5');
  await page.goto('/#/week');
  await expect(page.getByText('Deficit placed')).toBeVisible();
  await expect(page.getByText(/% of [\d,]+ target/)).toBeVisible();
});

test('fitness page projects toward a goal event', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/settings?section=goals');
  await page.getByPlaceholder('e.g. Unbound 100').fill('Test Fondo');
  const inThreeWeeks = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  await page.locator('#goals input[type=date]').nth(1).fill(inThreeWeeks);
  await page.goto('/#/fitness');
  await expect(page.getByText('Test Fondo').first()).toBeVisible();
  await expect(page.getByText('Fitness on the day')).toBeVisible();
});

test('coach explains what it needs without a key', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/coach');
  await expect(page.getByText('A coach that runs the numbers')).toBeVisible();
  await page.getByRole('button', { name: 'Add an Anthropic key' }).click();
  await expect(page.getByText('Anthropic API key (for the Coach)')).toBeVisible();
});

test('no horizontal scroll on any page', async ({ page }) => {
  await onboardWithDemo(page);
  for (const r of ['today', 'week', 'fitness', 'coach', 'settings']) {
    await page.goto(`/#/${r}`);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, r).toBeLessThanOrEqual(1);
  }
});
