import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('Super Admin puts anyone in charge of a community from the app', async ({ browser }) => {
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(admin, 'admin@ipl.test', 'Admin#2026');
  await admin.goto('/admin/communities');
  await admin.getByPlaceholder('Search communities').fill('Onne');
  const row = admin.getByRole('row', { name: /Onne/ });
  await expect(row).toContainText('Esther Walter Anga');          // the Jetty officer covers it by default
  await row.getByRole('button', { name: 'Change' }).click();

  // Pick a person who signed up as an ordinary community member.
  await admin.getByPlaceholder('Search anyone by name, phone or email').fill('Emmanuel');
  await admin.getByRole('button', { name: /Emmanuel Nwala/ }).click();
  await expect(admin.getByText('will be given the Officer role')).toBeVisible();
  await admin.getByRole('button', { name: 'Put in charge' }).click();
  await expect(admin.getByText('Emmanuel Nwala is now in charge of Onne')).toBeVisible();
  await expect(row).toContainText('Emmanuel Nwala');
  await expect(row).toContainText('this community');

  // They now sign in to the officer workspace instead of the community app.
  const officer = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(officer, '0803 123 4567', '123456');
  await expect(officer.getByRole('link', { name: 'My work' })).toBeVisible();
});
