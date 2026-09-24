import { expect, test } from '@playwright/test';

// The dev API rejects digit-only passwords, like a Supabase project with strict
// password rules: a 6-digit PIN must still work for sign-up and sign-in.
test('a new member signs up with a 6-digit PIN and signs in again', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Ngozi Test');
  await page.getByLabel('Phone number').fill('0809 555 0101');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Search communities').fill('Agbonchia');
  await page.getByRole('button', { name: /Agbonchia/ }).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#pin').fill('246810');
  await page.locator('#pin2').fill('246810');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Grievance collection')).toBeVisible();

  const again = await (await browser.newContext()).newPage();
  await again.goto('/signin');
  await again.getByLabel('Phone number').fill('0809 555 0101');
  await again.locator('#secret').fill('246810');
  await again.getByRole('button', { name: 'Sign in' }).click();
  await expect(again.getByText('Grievance collection')).toBeVisible();
});
