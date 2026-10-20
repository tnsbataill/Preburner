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

test('"Calculate meal" on a meal card asks for an Anthropic key when there is none', async ({ page }) => {
  await onboardWithDemo(page);
  const button = page.getByTestId('calculate-meal').first();
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByText('to calculate meals.').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' }).first()).toHaveAttribute('href', '#/settings');
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

test('an Apple Health export is imported: report, body fat into the profile, kept across reload', async ({ page }, info) => {
  const { strToU8, zipSync } = await import('fflate');
  const { writeFileSync } = await import('node:fs');
  // Synthetic export dated relative to today, in the shape the Health app writes.
  const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
  const rec = (type: string, d: string, time: string, endTime: string, value: string, unit = '') =>
    `<Record type="${type}" sourceName="Test Watch" ${unit ? `unit="${unit}" ` : ''}startDate="${d} ${time} -0400" endDate="${d} ${endTime} -0400" value="${value}"/>`;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?><HealthData locale="en_US">',
    rec('HKQuantityTypeIdentifierBodyMass', day(-1), '06:40:00', '06:40:00', '170.0', 'lb'),
    rec('HKQuantityTypeIdentifierBodyMass', day(-2), '06:40:00', '06:40:00', '171.0', 'lb'),
    rec('HKQuantityTypeIdentifierBodyFatPercentage', day(-1), '06:40:00', '06:40:00', '0.17', '%'),
    rec('HKQuantityTypeIdentifierRestingHeartRate', day(-1), '00:00:00', '23:59:00', '51', 'count/min'),
    rec('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', day(-1), '02:00:00', '02:01:00', '48', 'ms'),
    rec('HKCategoryTypeIdentifierSleepAnalysis', day(-1), '00:00:00', '07:30:00', 'HKCategoryValueSleepAnalysisAsleepCore'),
    rec('HKQuantityTypeIdentifierHeartRate', day(-1), '07:00:00', '07:00:00', '60', 'count/min'),
    '</HealthData>',
  ].join('\n');
  const file = info.outputPath('export.zip');
  writeFileSync(file, zipSync({ 'apple_health_export/export.xml': strToU8(xml) }));

  await onboardWithDemo(page);
  await page.goto('/#/settings');
  await page.getByTestId('apple-health-file').setInputFiles(file);
  const report = page.getByTestId('apple-health-report');
  await expect(report).toContainText('2 days');
  await expect(report.locator('li').filter({ hasText: 'Weight' })).toContainText('2 days');
  await expect(report.locator('li').filter({ hasText: 'HRV (SDNN)' })).toContainText('1 days');
  await expect(report.locator('li').filter({ hasText: 'Sleep' })).toContainText('Test Watch');
  await expect(report).toContainText('Body fat 17%');
  await expect(page.getByLabel(/^Body fat/)).toHaveValue('17');

  await page.reload();
  await expect(page.getByTestId('apple-health-report')).toContainText('Body fat 17%');
});

test('structured workouts show a power-profile preview', async ({ page }) => {
  await onboardWithDemo(page);
  // Demo indoor sessions carry steps; find a day that has one.
  const strip = page.locator('[data-selected]');
  const n = await strip.count();
  for (let i = 0; i < n; i += 1) {
    await strip.nth(i).click();
    if ((await page.getByTestId('workout-profile').count()) > 0) break;
  }
  const profile = page.getByTestId('workout-profile').first();
  await expect(profile).toBeVisible();
  await expect(profile).toHaveAttribute('aria-label', /Workout profile: \d+ min.*peak \d+% FTP/);
  // Drawn as one block per step.
  expect(await profile.locator('polygon').count()).toBeGreaterThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('a new ride is reviewed: card on Today, review screen, answers saved, then it leaves the list', async ({ page }) => {
  await onboardWithDemo(page);
  const card = page.getByTestId('new-ride-card');
  await expect(card).toBeVisible();
  const before = await card.getByRole('button').count();
  await card.getByRole('button').first().click();
  const review = page.getByTestId('ride-review');
  await expect(review).toBeVisible();
  await expect(page.getByTestId('review-changes')).toContainText('Since this ride came in');
  await expect(page.getByTestId('review-changes')).toContainText(/Fitness \(CTL\) [+−]\d/);
  await expect(page.getByTestId('review-changes')).toContainText('No training plan yet');
  const rpe6 = review.getByRole('group', { name: /Effort for ride/ }).getByRole('button', { name: '6', exact: true });
  await rpe6.click();
  await expect(rpe6).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  // That ride leaves the list (and the card goes once none are left), also after a reload.
  const left = page.getByTestId('new-ride-card').getByRole('button');
  await expect(left).toHaveCount(before - 1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(left).toHaveCount(before - 1);
});
