import { expect, test } from '@playwright/test';
import { MEMBER, OFFICER, signIn, writeGrievance } from './helpers';

test('the officer messages the complainant and the complainant replies', async ({ browser }) => {
  const member = await (await browser.newContext()).newPage();
  await signIn(member, ...MEMBER);
  await writeGrievance(member, 'Conversation test: the borehole in the town square stopped working.');
  await member.getByRole('button', { name: 'Send grievance' }).click();
  const tid = (await member.getByTestId('tracking-id').textContent())!;

  const officer = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(officer, ...OFFICER);
  await officer.goto(`/grievances?q=${tid}`);
  await officer.getByRole('link', { name: tid }).click();
  await officer.getByRole('tab', { name: 'Remark' }).click();
  await officer.getByRole('button', { name: 'Message complainant' }).click();
  await officer.getByLabel('Text').fill('Which borehole do you mean, the one near the church?');
  await officer.getByRole('button', { name: 'Send message' }).click();
  await expect(officer.getByText('Message sent to the complainant')).toBeVisible();

  await member.goto('/grievances');
  await member.getByText(tid).click();
  await expect(member.getByText('Which borehole do you mean, the one near the church?')).toBeVisible();
  await member.getByLabel('Your reply').fill('Yes, the one beside the church.');
  await member.getByRole('button', { name: 'Send reply' }).click();
  await expect(member.getByText('Yes, the one beside the church.')).toBeVisible();

  await officer.reload();
  await expect(officer.getByText('Reply from the complainant')).toBeVisible();
  await expect(officer.getByText('Yes, the one beside the church.')).toBeVisible();
});
