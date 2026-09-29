import { expect, test } from '@playwright/test';

// The dev API rejects digit-only passwords, like a Supabase project with strict
// password rules: a 6-digit PIN must still work for sign-up and sign-in.
// The phone number is confirmed with a texted code first (the dev API keeps the "text").
test('a new member confirms their phone by code, signs up with a 6-digit PIN and signs in again', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Ngozi Test');
  await page.getByLabel('Phone number').fill('0809 555 0101');
  await expect(page.getByRole('radio')).toHaveText(['Male', 'Female']);    // no third option
  await page.getByRole('radio', { name: 'Female' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('We sent a 6-digit code by text message to 0809 555 0101.')).toBeVisible();
  const code = (await (await page.request.get('http://localhost:54321/dev/last-otp?phone=%2B2348095550101')).json()).code as string;
  await page.getByLabel('Code').fill(code === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('That code is not correct.')).toBeVisible();
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Confirm' }).click();
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

test('a number that already has an account cannot get a code', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Second Account');
  await page.getByLabel('Phone number').fill('0803 123 4567');     // the seeded member's number
  await page.getByRole('radio', { name: 'Male', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('An account with this phone number or email already exists.')).toBeVisible();
});
