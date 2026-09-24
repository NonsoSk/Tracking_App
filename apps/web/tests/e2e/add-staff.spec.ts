import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('Super Admin adds a staff member, who can then sign in', async ({ browser }) => {
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(admin, 'admin@ipl.test', 'Admin#2026');
  await expect(admin.getByText('Indorama Grievance Portal').first()).toBeVisible();
  await admin.goto('/admin/users');
  await admin.getByRole('button', { name: 'Add staff member' }).click();
  await admin.getByLabel('Full name').fill('Chika Staff');
  await admin.getByLabel('Work email').fill('chika.staff@ipl.test');
  await admin.getByLabel(/Job title/).fill('CR Officer');
  await admin.getByLabel('Temporary password').fill('Skixzy7878**');
  await admin.getByRole('button', { name: 'Create account' }).click();
  await expect(admin.getByText('Staff account created')).toBeVisible();
  await expect(admin.getByText('Chika Staff')).toBeVisible();

  const staff = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(staff, 'chika.staff@ipl.test', 'Skixzy7878**');
  await expect(staff.getByRole('link', { name: 'My work' })).toBeVisible();
});
