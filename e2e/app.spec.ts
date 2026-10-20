import { type Page, expect, test } from '@playwright/test';

// Full end-to-end runs of the real app on its built-in demo provider —
// no mocks; engine, store, persistence and UI all run for real.

async function onboardWithDemo(page: Page) {
  await page.goto('/');
  await page.getByText('Explore with demo data first').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Show my plan' }).click();
  await page.getByRole('button', { name: 'Skip tour' }).click();
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

test('the Intervals key helper walks through getting a key and pastes it into the field', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Help me get my key' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Developer Settings')).toBeInViewport();
  const popup = page.waitForEvent('popup');
  await sheet.getByRole('button', { name: 'Open Intervals.icu' }).click();
  expect((await popup).url()).toContain('intervals.icu/settings');
  await page.evaluate(() => navigator.clipboard.writeText('  test-key-123  '));
  await sheet.getByRole('button', { name: 'Paste my key' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Intervals.icu API key')).toHaveValue('test-key-123');

  // Settings has the same helper beside its key field.
  await onboardWithDemo(page);
  await page.goto('/#/settings?section=connections');
  await page.getByRole('button', { name: 'Help me get my key' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Paste my key' }).click();
  await expect(page.getByLabel('Intervals.icu API key')).toHaveValue('test-key-123');
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

test('a workout planned by calorie burn joins the day, persists, and can be removed', async ({ page }) => {
  await onboardWithDemo(page);
  const training = async () => Number((await page.locator('span', { hasText: /^Training [\d,]+$/ }).first().innerText()).replace(/\D/g, ''));
  const before = await training();
  await page.getByRole('button', { name: 'Plan a workout' }).click();
  await page.getByLabel('Calories burned').fill('1000');
  await page.getByLabel('Duration').fill('120');
  await page.getByLabel('Start time').fill('12:00');
  await page.getByLabel('Name').fill('Lunch spin');
  // 1000 kcal at 22% gross efficiency is 920 kJ of work.
  await expect(page.getByTestId('plan-preview')).toContainText('920 kJ');
  const net = Number((await page.getByTestId('plan-preview').innerText()).match(/Adds (\d+) kcal/)![1]);
  await page.getByRole('button', { name: 'Add workout' }).click();
  const card = page.getByText('Lunch spin').first();
  await expect(card).toBeVisible();
  // Today's training burn goes up by the ride less the resting energy it replaces
  // (about 190 kcal over two hours), as the sheet said it would.
  await expect.poll(training).toBeGreaterThan(before + 700);
  expect(await training()).toBeLessThan(before + 950);
  expect(Math.abs((await training()) - before - net)).toBeLessThanOrEqual(2);
  await page.reload();
  await expect(page.getByText('Lunch spin').first()).toBeVisible();
  await card.click();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Lunch spin')).toHaveCount(0);
  await expect.poll(training).toBe(before);
});

test('"Ride it instead" swaps a plan session for a workout added on Intervals, and it stays swapped', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/plan');
  await page.getByRole('checkbox', { name: /Optimise for me/ }).uncheck();
  await page.getByTestId('generate-plan').click();
  await expect(page.getByTestId('apply-plan')).toBeVisible();
  // What a sync would record when a workout shows up on Intervals after the
  // plan was made (demo mode never syncs): flag a demo workout on a plan day.
  const { date, workoutTitle, sessionTitle } = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('preburner-v2')!);
    const { plan } = raw.state.training;
    const s = plan.sessions.find((x: { date: string }) => raw.state.workouts.some((w: { date: string }) => w.date === x.date));
    const w = raw.state.workouts.find((x: { date: string }) => x.date === s.date);
    raw.state.training.addedExternal = { [w.id]: { date: s.date } };
    localStorage.setItem('preburner-v2', JSON.stringify(raw));
    return { date: s.date as string, workoutTitle: w.title as string, sessionTitle: s.title as string };
  });
  await page.goto(`/#/today?date=${date}`);
  await page.reload();
  const card = page.getByTestId('added-on-intervals');
  await expect(card).toContainText(workoutTitle);
  await expect(card).toContainText(`alongside ${sessionTitle}`);
  const title = (t: string) => page.getByText(t, { exact: true });
  await expect(title(sessionTitle).first()).toBeVisible();
  await card.getByRole('button', { name: 'Ride it instead' }).click();
  await expect(card).toHaveCount(0);
  await expect(title(sessionTitle)).toHaveCount(0);
  await expect(title(workoutTitle).first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('added-on-intervals')).toHaveCount(0);
  await expect(title(sessionTitle)).toHaveCount(0);
  await expect(title(workoutTitle).first()).toBeVisible();
});

test('the week view shows power profiles on structured workouts', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/week');
  // Step through weeks until one has a structured session.
  const next = page.getByRole('button', { name: 'Next week' });
  for (let i = 0; i < 4 && (await page.getByTestId('workout-profile').count()) === 0; i += 1) {
    if (await next.isDisabled()) break;
    await next.click();
  }
  const profile = page.getByTestId('workout-profile').first();
  await expect(profile).toBeVisible();
  expect(await profile.locator('polygon').count()).toBeGreaterThan(0);
  const box = await profile.boundingBox();
  expect(box!.width).toBeGreaterThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('after setup, a tour walks through the app and ends on Today', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Explore with demo data first').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Show my plan' }).click();
  const callout = page.getByTestId('tour-callout');
  await expect(page).toHaveURL(/#\/today$/);
  const vp = page.viewportSize()!;
  const seen: string[] = [];
  for (;;) {
    await expect(callout).toBeVisible();
    // Wait for the callout to settle, then check it sits inside the screen.
    await page.waitForTimeout(600);
    seen.push(await callout.locator('h2').innerText());
    const box = (await callout.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    const done = callout.getByRole('button', { name: 'Done', exact: true });
    if (await done.isVisible()) {
      await done.click();
      break;
    }
    await callout.getByRole('button', { name: 'Next', exact: true }).click();
  }
  // Every step found its target; none was skipped.
  expect(seen).toEqual(['Pick a day', 'Your day, in order', 'Daily targets', 'Fuel tank', 'Week', 'Plan', 'Fitness', 'Coach', 'Demo data', 'Settings']);
  await expect(page.getByTestId('tour')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/today$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('re-running setup from Settings finishes on Today, not back in Settings', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/settings?section=goals');
  await page.getByRole('button', { name: 'Re-run setup' }).click();
  await page.getByText('Explore with demo data first').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Show my plan' }).click();
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
});
