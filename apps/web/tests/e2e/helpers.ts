import type { Page } from '@playwright/test';

export async function signIn(page: Page, id: string, secret: string) {
  await page.goto('/signin');
  await page.getByLabel('Phone number').fill(id);
  await page.locator('#secret').fill(secret);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export const MEMBER = ['0803 123 4567', '123456'] as const;
export const OFFICER = ['godpower@ipl.test', 'Officer#2026'] as const;
export const JETTY_OFFICER = ['esther@ipl.test', 'Officer#2026'] as const;

export async function writeGrievance(page: Page, text: string) {
  await page.getByRole('button', { name: 'Submit a grievance' }).click();
  await page.getByRole('button', { name: /^Yes, / }).click();
  await page.getByLabel('What is your concern?').fill(text);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Roads, water/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Skip|Continue/ }).click();
}
