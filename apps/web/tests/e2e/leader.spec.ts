import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('a community leader added as Viewer sees only their community, its codes, and no complainant names', async ({ browser }) => {
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(admin, 'admin@ipl.test', 'Admin#2026');
  await admin.goto('/admin/users');
  await admin.getByRole('button', { name: 'Add staff member' }).click();
  await admin.getByLabel('Full name').fill('Chief Agbonchia');
  await admin.getByLabel('Work email').fill('chief.agbonchia@ipl.test');
  await admin.getByLabel('Role').selectOption({ label: 'Viewer (e.g. community leader)' });
  await admin.getByLabel('Add a single community').selectOption({ label: 'Agbonchia' });
  await admin.getByRole('button', { name: 'Set a temporary password myself instead' }).click();
  await admin.getByLabel('Temporary password').fill('Leader#20261');
  await admin.getByRole('button', { name: 'Create account' }).click();
  await expect(admin.getByText('Staff account created')).toBeVisible();

  // Two paper grievances: one in the leader's community, one elsewhere.
  for (const [who, community, text] of [['Paper Person A', 'Agbonchia', 'Agbonchia: the borehole has been dry for two weeks.'], ['Paper Person B', 'Onne', 'Onne: dust from trucks every morning.']]) {
    await admin.goto('/new');
    await admin.getByLabel('Full name').fill(who);
    await admin.getByLabel('Community').selectOption({ label: community });
    await admin.getByLabel(/Concern/).fill(text);
    await admin.getByRole('button', { name: 'Save grievance' }).click();
    await expect(admin).toHaveURL(/\/grievances\/[0-9a-f-]{36}$/);
  }

  const leader = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(leader, 'chief.agbonchia@ipl.test', 'Leader#20261');
  await leader.goto('/codes');
  await expect(leader.getByText('AGB-2026-0923-X7P4')).toBeVisible();               // the code for their community
  await expect(leader.getByRole('button', { name: 'New code' })).toHaveCount(0);    // only the Super Admin creates codes

  await leader.goto('/grievances');
  const rows = leader.locator('tbody tr');
  await expect(rows.first()).toContainText('Agbonchia');
  for (const text of await rows.allTextContents()) expect(text).toContain('Agbonchia');
  await expect(leader.getByRole('table').getByText('Agbonchia: the borehole')).toBeVisible();
  await expect(leader.getByText('Onne: dust')).toHaveCount(0);                       // not their community
  await expect(leader.getByText('Paper Person A')).toHaveCount(0);                  // complainant names are hidden
});
