import { expect, test } from '@playwright/test';
import { MEMBER, signIn } from './helpers';

test('members must type the exact code; the app never shows or fills it in', async ({ page }) => {
  await signIn(page, ...MEMBER);
  await expect(page.getByText('Grievance collection')).toBeVisible();
  await expect(page.getByText('AGB-2026-0923-X7P4')).toHaveCount(0);           // not on the home screen

  await page.getByRole('button', { name: 'Submit a grievance' }).click();
  await expect(page.getByLabel('Submission code')).toHaveValue('');           // not filled in
  await page.getByLabel('Submission code').fill('AGB-2026-0923-ZZZZ');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText("That submission code isn't correct")).toBeVisible();

  await page.getByLabel('Submission code').fill('agb-2026-0923-x7p4');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Code accepted: it opens collection for Agbonchia.')).toBeVisible();
});

test('officers cannot generate codes', async ({ page }) => {
  await signIn(page, 'godpower@ipl.test', 'Officer#2026');
  await expect(page.getByRole('link', { name: 'My work' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Submission codes' })).toHaveCount(0);
});
