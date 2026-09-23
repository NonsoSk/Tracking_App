import { expect, test } from '@playwright/test';
import { MEMBER, OFFICER, signIn, writeGrievance } from './helpers';

test('offline: grievance is saved on the phone, then submitted exactly once when back online', async ({ page, context }) => {
  await signIn(page, ...MEMBER);
  await expect(page.getByText('Grievance collection')).toBeVisible();
  await expect(page.getByText('OPEN')).toBeVisible();
  // let the service worker take control so the app shell works offline
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByText('Grievance collection')).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("You're offline.")).toBeVisible();
  await writeGrievance(page, 'Offline test: the culvert near the primary school is blocked.');
  await page.getByRole('button', { name: 'Save and send later' }).click();
  await expect(page.getByRole('heading', { name: 'Saved on this phone' })).toBeVisible();
  await expect(page.getByText('Not yet received by IPL')).toBeVisible();
  await expect(page.getByTestId('tracking-id')).toHaveCount(0);   // never pretends it was submitted

  // The app still opens with no connection, and the item is still there.
  await page.reload();
  await expect(page.getByText('Not yet received by IPL')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByTestId('tracking-id')).toHaveText(/^IPL-GRV-\d{4}-\d{6}$/, { timeout: 30_000 });
  const tid = await page.getByTestId('tracking-id').textContent();

  // Exactly one grievance reached the server.
  await page.goto('/grievances');
  await expect(page.getByText(tid!)).toHaveCount(1);
  await expect(page.getByText('Saved on this phone · not yet sent')).toHaveCount(0);
});

test('full cycle: submit → officer resolves → member acknowledges', async ({ browser }) => {
  const member = await (await browser.newContext()).newPage();
  await signIn(member, ...MEMBER);
  await writeGrievance(member, 'Cycle test: street lights on Market Road have been off for a month.');
  await member.getByRole('button', { name: 'Send grievance' }).click();
  const tid = (await member.getByTestId('tracking-id').textContent())!;

  const officer = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(officer, ...OFFICER);
  await officer.goto(`/grievances?q=${tid}`);
  await officer.getByRole('link', { name: tid }).click();
  await officer.getByRole('tab', { name: 'Resolve' }).click();
  await officer.getByLabel('How was it resolved?').fill('New street light fittings were installed on Market Road on Monday.');
  await officer.getByRole('button', { name: 'Mark as resolved' }).click();
  await officer.getByRole('button', { name: 'Resolve and notify' }).click();
  await expect(officer.getByText('Resolved', { exact: true }).first()).toBeVisible();

  await member.goto('/notifications');
  await expect(member.getByText('Your grievance has been marked as resolved')).toBeVisible();
  await member.goto('/grievances');
  await member.getByText(tid).click();
  await expect(member.getByText('Do you acknowledge this resolution?')).toBeVisible();
  await member.getByRole('button', { name: 'Yes, I acknowledge' }).click();
  await expect(member.getByText('You acknowledged this resolution')).toBeVisible();
});

test('a member cannot open someone else’s grievance by changing the URL', async ({ browser }) => {
  const officer = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(officer, 'esther@ipl.test', 'Officer#2026');
  // Jetty officer enters a paper form for another person.
  await officer.goto('/new');
  await officer.getByLabel('Full name').fill('Paper Complainant');
  await officer.getByLabel('Community').selectOption({ label: 'Onne' });
  await officer.getByLabel(/Concern/).fill('Trucks from the jetty block the only road every morning.');
  await officer.getByRole('button', { name: 'Save grievance' }).click();
  await expect(officer).toHaveURL(/\/grievances\/[0-9a-f-]{36}$/);
  const otherId = officer.url().split('/').pop();

  const member = await (await browser.newContext()).newPage();
  await signIn(member, '0803 123 4567', '123456');
  await expect(member.getByText('Grievance collection')).toBeVisible();
  await member.goto(`/grievances/${otherId}`);
  await expect(member.getByText("We couldn't find that grievance.")).toBeVisible();
  await expect(member.getByText('Trucks from the jetty')).toHaveCount(0);

  // A Host/Pipeline officer cannot see the Jetty grievance either.
  const hostOfficer = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(hostOfficer, 'godpower@ipl.test', 'Officer#2026');
  await expect(hostOfficer.getByText('Attention required')).toBeVisible();
  await hostOfficer.goto(`/grievances/${otherId}`);
  await expect(hostOfficer.getByText("We couldn't find that grievance.")).toBeVisible();
});
