import { type Page, expect, test } from '@playwright/test';

// End-to-end: the real app on the demo provider (a simulated year of riding).
// Nothing mocked: history -> model fit -> optimiser -> plan -> calendar ->
// fuelling, plus "how did it feel?" feedback and persistence.

async function onboardWithDemo(page: Page) {
  await page.goto('/');
  await page.getByText('Explore with demo data first').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Show my plan' }).click();
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

async function generate(page: Page) {
  await page.goto('/#/plan');
  await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
  await expect(page.getByTestId('model-card')).toContainText('Estimated FTP');
  await page.getByLabel('Plan length in weeks').selectOption('8');
  await page.getByTestId('generate-plan').click();
  await expect(page.getByTestId('plan-summary')).toBeVisible({ timeout: 20_000 });
}

test('generates an optimised FTP plan from history and puts it on the calendar', async ({ page }) => {
  await onboardWithDemo(page);
  await generate(page);
  const summary = page.getByTestId('plan-summary');
  await expect(summary).toContainText('Raise FTP · 8 weeks');
  await expect(summary).toContainText('Projected FTP');
  // Sessions list: week 1 opens with structured workouts.
  await expect(page.getByRole('button', { name: /Week 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Week 8/ })).toBeVisible();

  await page.getByTestId('apply-plan').click();
  await expect(summary).toContainText('Active');

  // Week view: in the plan window, plan sessions replace the TrainerRoad demo sessions.
  await page.goto('/#/week');
  const next = page.getByRole('button', { name: 'Next week' });
  await next.click();
  await expect(page.getByText(/Sweet spot:|Threshold:|VO2max:|Over-unders:|30\/15s:/).first()).toBeVisible();
  await expect(page.getByText('Threshold intervals')).toHaveCount(0);

  // Survives a reload.
  await page.reload();
  await page.goto('/#/plan');
  await expect(page.getByTestId('plan-summary')).toContainText('Active');
});

test('"how did it feel?" feedback is recorded and persists', async ({ page }) => {
  await onboardWithDemo(page);
  await generate(page);
  const prompt = page.getByTestId('feedback-prompt');
  await expect(prompt).toBeVisible();
  const effort = prompt.getByRole('group', { name: /Effort for ride/ }).first();
  await effort.getByRole('button', { name: '3', exact: true }).click();
  await expect(effort.getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const feel = prompt.getByRole('group', { name: /Feel for ride/ }).first();
  await feel.getByRole('button', { name: 'Good' }).click();
  await expect(feel.getByRole('button', { name: 'Good' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByTestId('feedback-prompt').getByRole('group', { name: /Effort for ride/ }).first().getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('readiness shows on Today once a plan exists', async ({ page }) => {
  await onboardWithDemo(page);
  await generate(page);
  await page.goto('/#/today');
  await expect(page.getByTestId('readiness-card')).toBeVisible();
  await expect(page.getByTestId('readiness-card')).toContainText(/Ready to train|Take it a bit easier|Recovery first/);
});

test('discarding the plan brings the original calendar back', async ({ page }) => {
  await onboardWithDemo(page);
  await generate(page);
  await page.getByTestId('apply-plan').click();
  // Confirmed in the page, not with a native dialog (some browsers suppress those).
  page.on('dialog', () => {
    throw new Error('native dialog shown');
  });
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByTestId('plan-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('plan-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Discard plan' }).click();
  await expect(page.getByTestId('generate-plan')).toBeVisible();
  await page.goto('/#/week');
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByText('Threshold intervals').first()).toBeVisible();
});

test('a history file (e.g. built from the Strava connector) drives the model and the plan', async ({ page }, info) => {
  // Synthetic two-season history: steady riding, two FTP tests.
  const rides = [];
  const start = Date.parse('2025-01-06T12:00:00Z');
  for (let d = 0; d < 260; d += 1) {
    if (d % 7 === 4 || d % 7 === 0) continue;
    const date = new Date(start + d * 86_400_000).toISOString().slice(0, 10);
    const hard = d % 7 === 1 || d % 7 === 3;
    const tss = hard ? 85 : 55;
    rides.push({ id: `h-${d}`, date, durationMin: hard ? 60 : 90, tss, domain: hard ? { low: 30, mid: 50, high: 5 } : { low: 55, mid: 0, high: 0 }, ftpSet: 280, best20: hard ? 270 : undefined, isTest: d === 29 || d === 120, source: 'strava' });
  }
  // FTP rose 280 -> 300 W over 13 weeks of sweet-spot-led training.
  rides.filter((r) => r.isTest)[0].best20 = 280 / 0.95;
  rides.filter((r) => r.isTest)[1].best20 = 300 / 0.95;
  const file = info.outputPath('history.json');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, JSON.stringify({ rides }));

  await onboardWithDemo(page);
  await page.goto('/#/plan');
  await page.getByTestId('strava-file').setInputFiles(file);
  await expect(page.getByText(/Strava rides imported/)).toBeVisible();
  await expect(page.getByTestId('model-card')).toContainText('Estimated FTP');
  // The FTP-raising block in the history is found and offered as the plan shape.
  await expect(page.getByTestId('best-builds')).toContainText('Your FTP rose 280→300 W');
  // Its hard days were sweet spot (mid), not VO2: the plan is pinned to that.
  await expect(page.getByTestId('best-builds')).toContainText('almost no VO2 sessions');
  await page.getByTestId('generate-plan').click();
  await expect(page.getByTestId('plan-summary')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('plan-summary')).toContainText('80% range');
});

test('"what happened?" after skipped or cut-short sessions changes the plan', async ({ page }) => {
  // Plan made on a Wednesday (starts the next Monday), then three weeks later
  // the demo athlete's real riding has missed or cut short some sessions.
  await page.clock.install({ time: new Date('2026-10-14T09:00:00') });
  await onboardWithDemo(page);
  await generate(page);
  await page.clock.setSystemTime(new Date('2026-11-05T09:00:00'));
  await page.reload();
  await page.goto('/#/today');
  const card = page.getByTestId('debrief-prompt');
  await expect(card).toBeVisible();
  // The demo athlete didn't ride Tuesday's quality session.
  await expect(card).toContainText(/· Tue, Nov 3 · skipped/);
  const group = card.getByRole('group', { name: /was skipped/ }).first();
  const label = (await group.getAttribute('aria-label'))!;
  await group.getByRole('button', { name: 'Sick' }).click();
  await expect(card.getByRole('status')).toContainText('Easy spins for three days');
  // The plan changed: hard days in the next three became easy spins.
  await expect(page.getByTestId('readiness-card')).toContainText(/Getting over illness: easy spin instead of/);
  // Answered: it isn't asked again, after a reload either.
  await expect(card.getByRole('group', { name: label! })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('group', { name: label! })).toHaveCount(0);
});

test('a cut-short ride is asked about and the answer sticks', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-14T09:00:00') });
  await onboardWithDemo(page);
  await generate(page);
  await page.clock.setSystemTime(new Date('2026-10-28T09:00:00'));
  await page.reload();
  await page.goto('/#/today');
  const card = page.getByTestId('debrief-prompt');
  await expect(card).toContainText('Long endurance 3h · Sun, Oct 25 · 2h15 of 3h');
  await card.getByRole('group', { name: /was cut short/ }).getByRole('button', { name: 'Ran out of time' }).click();
  await expect(card.getByRole('status')).toContainText('No change to your plan.');
  await page.reload();
  await expect(page.getByRole('group', { name: /Long endurance 3h was cut short/ })).toHaveCount(0);
});

test('hovering or tapping a week shows its hours and intensity breakdown', async ({ page }) => {
  await onboardWithDemo(page);
  await generate(page);
  const bar = page.getByTestId('week-bar').nth(3);
  await bar.hover();
  const tip = page.getByTestId('week-tooltip');
  await expect(tip).toContainText('Week 4');
  await expect(tip).toContainText(/\dh\d\d|\dh|\d+m/);
  for (const band of ['Endurance', 'Tempo–threshold', 'VO2 and above']) await expect(tip).toContainText(band);
  await page.getByTestId('week-bar').nth(4).click();
  await expect(tip).toContainText('Week 5');
  // The chart never makes the page scroll sideways (phones included).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
