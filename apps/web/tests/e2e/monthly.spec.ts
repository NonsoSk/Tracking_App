import { expect, test } from '@playwright/test';
import { MEMBER, OFFICER, signIn } from './helpers';

test('the Super Admin sets a monthly limit and members see how many they have left', async ({ browser }) => {
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(admin, 'admin@ipl.test', 'Admin#2026');
  await admin.goto('/admin/settings');
  const limit = admin.getByLabel(/Grievances each member may send per month/);
  await limit.fill('50');
  await admin.getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByText('Setting saved')).toBeVisible();

  const member = await (await browser.newContext()).newPage();
  await signIn(member, ...MEMBER);
  await expect(member.getByText(/more grievances this month \(limit 50\)/)).toBeVisible();

  // Back to unlimited.
  await limit.fill('');
  await admin.getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByText('Setting saved').first()).toBeVisible();
  await member.reload();
  await expect(member.getByText(/this month \(limit/)).toHaveCount(0);
});

test('the officer home shows Resolved, opening the latest resolved first', async ({ browser }) => {
  const officer = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(officer, ...OFFICER);
  await expect(officer.getByRole('button', { name: /Resolved/ })).toBeVisible();
  await expect(officer.getByRole('button', { name: /In progress/ })).toHaveCount(0);
  await officer.getByRole('button', { name: /Resolved/ }).click();
  await expect(officer).toHaveURL(/sort=resolved_desc/);
  await expect(officer.getByLabel('Sort')).toHaveValue('resolved_desc');
});
