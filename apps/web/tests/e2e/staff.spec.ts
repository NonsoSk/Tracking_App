import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('Super Admin puts people in charge of a whole community type, and several people share it', async ({ browser }) => {
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(admin, 'admin@ipl.test', 'Admin#2026');
  await admin.goto('/admin/communities');

  // Whole community type: add a second person to Host (Godpower Jaka stays).
  const host = admin.getByRole('region', { name: 'Host communities' });
  await expect(host).toContainText('Godpower Jaka');
  await host.getByRole('button', { name: 'Add person to Host' }).click();
  await admin.getByPlaceholder('Search anyone by name, phone or email').fill('Emmanuel');   // signed up as a community member
  await admin.getByRole('button', { name: /Emmanuel Nwala/ }).click();
  await expect(admin.getByText('will be given the Officer role')).toBeVisible();
  await admin.getByRole('button', { name: 'Put in charge' }).click();
  await expect(admin.getByText('Emmanuel Nwala is now in charge of all Host communities')).toBeVisible();
  await expect(host).toContainText('Godpower Jaka');
  await expect(host).toContainText('Emmanuel Nwala');

  // They now sign in to the officer workspace instead of the community app.
  const officer = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(officer, '0803 123 4567', '123456');
  await expect(officer.getByRole('link', { name: 'My work' })).toBeVisible();

  // One community: add a person without removing the one who covers it already.
  await admin.getByRole('tab', { name: /^Communities/ }).click();
  await admin.getByPlaceholder('Search communities').fill('Onne');
  const row = admin.getByRole('row', { name: /Onne/ });
  await expect(row).toContainText('Esther Walter Anga');          // the Jetty officer covers it
  await row.getByRole('button', { name: 'Add person' }).click();
  await admin.getByPlaceholder('Search anyone by name, phone or email').fill('Godwin');
  await admin.getByRole('button', { name: /Godwin Bebe-Okpabi/ }).click();
  await admin.getByRole('button', { name: 'Put in charge' }).click();
  await expect(admin.getByText('Godwin Bebe-Okpabi is now in charge of Onne')).toBeVisible();
  await expect(row).toContainText('Esther Walter Anga');
  await expect(row).toContainText('Godwin Bebe-Okpabi');

  // Remove someone from a type; the page asks on the spot.
  await admin.getByRole('tab', { name: /^People in charge/ }).click();
  const person = host.getByRole('listitem').filter({ hasText: 'Emmanuel Nwala' });
  await person.getByRole('button', { name: 'Remove' }).click();
  await person.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(admin.getByText('Emmanuel Nwala is no longer in charge of all Host communities')).toBeVisible();
  await expect(host).not.toContainText('Emmanuel Nwala');
});
