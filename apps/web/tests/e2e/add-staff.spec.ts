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
  await admin.getByRole('button', { name: 'Set a temporary password myself instead' }).click();
  await admin.getByLabel('Temporary password').fill('Skixzy7878**');
  await admin.getByRole('button', { name: 'Create account' }).click();
  await expect(admin.getByText('Staff account created')).toBeVisible();
  await expect(admin.getByText('Chika Staff')).toBeVisible();

  const staff = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(staff, 'chika.staff@ipl.test', 'Skixzy7878**');
  await expect(staff.getByRole('link', { name: 'My work' })).toBeVisible();
});

test('Super Admin invites staff by email; they open the link and choose their password', async ({ browser, request }) => {
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(admin, 'admin@ipl.test', 'Admin#2026');
  await admin.goto('/admin/users');
  await admin.getByRole('button', { name: 'Add staff member' }).click();
  await admin.getByLabel('Full name').fill('Ngozi Invite');
  await admin.getByLabel('Work email').fill('ngozi.invite@ipl.test');
  await admin.getByRole('button', { name: 'Send invitation' }).click();
  await expect(admin.getByText('Invitation sent to ngozi.invite@ipl.test')).toBeVisible();
  const waiting = admin.getByRole('region', { name: 'Invitations waiting to be accepted' });
  await expect(waiting).toContainText('Ngozi Invite');

  // The "email": the dev API keeps the link Supabase would have sent.
  const { link } = await (await request.get('http://localhost:54321/dev/last-link?email=ngozi.invite@ipl.test')).json();
  const invitee = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await invitee.goto(link.replace(/^https?:\/\/[^/#]+/, ''));
  await expect(invitee.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await invitee.getByLabel('New password').fill('Grievance#2026');
  await invitee.getByLabel('Type it again').fill('Grievance#2026');
  await invitee.getByRole('button', { name: 'Save password and continue' }).click();
  await expect(invitee.getByRole('link', { name: 'My work' })).toBeVisible();

  // Next time they sign in with their email and the password they chose.
  const later = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(later, 'ngozi.invite@ipl.test', 'Grievance#2026');
  await expect(later.getByRole('link', { name: 'My work' })).toBeVisible();

  await admin.reload();
  await expect(admin.getByText('Ngozi Invite').first()).toBeVisible();
  await expect(admin.getByRole('region', { name: 'Invitations waiting to be accepted' })).toHaveCount(0);
});
