import { expect, type TestFixtures } from 'e2e';
import { openFixture } from './fixture';
import { RECIPIENT } from '../../apps/web/tests/browser/fixtures/api';

type Fixtures = Pick<TestFixtures, 'app' | 'screen'>;
export type Drive = (goal: string, scripted: () => Promise<void>) => Promise<void>;
export const scripted: Drive = async (_goal, run) => run();

export async function fund({ app, screen }: Fixtures, drive: Drive) {
  const { page, fundingRequests } = await openFixture(app, screen, 'ID');
  await screen.getByRole('link', { name: 'Add money', exact: true }).tap();
  await expect(screen.getByRole('dialog', { name: 'Add money', exact: true })).toBeVisible();
  await drive('Choose Deposit IDR using IDRX, Bank transfer, Mandiri. Stop at the Amount field.', async () => {
    await screen.getByRole('button', { name: /Deposit IDR/ }).tap();
  });
  await expect(screen.getByRole('textbox', { name: 'Amount' })).toBeVisible();
  const amount = process.env.HOME_E2E_MUTATION === 'funding-wrong-amount' ? '99999' : '20000';
  await drive(`Enter exactly ${amount} IDR and tap Review quote. Stop there; do not confirm deposit.`, async () => {
    await screen.getByRole('textbox', { name: 'Amount' }).pressSequentially(amount);
    await screen.getByRole('button', { name: 'Review quote', exact: true }).tap();
  });
  await expect(screen.getByRole('heading', { name: 'Review quote' })).toBeVisible();
  expect(fundingRequests.map(body => JSON.parse(body))).toEqual([{
    providerId: 'idrx', region: 'ID', paymentMethod: 'bank-va-mandiri', fiatAmount: '20000',
  }]);
  await expect(screen.getByRole('image', { name: '20.000,00\u00a0IDRX' })).toBeVisible();
  await screen.getByRole('button', { name: 'Confirm deposit', exact: true }).tap();
  await expect(screen.getByRole('heading', { name: 'Review payment details' })).toBeVisible();
  await screen.getByRole('button', { name: 'View payment instructions' }).tap();
  await expect(screen.getByText('123456789012', { exact: true })).toBeVisible();
  await expect(screen.getByText('Money received')).toBeVisible();
  expect(page.url()).not.toMatch(/actionId=|action_id=/);
}

export async function save({ app, screen }: Fixtures, drive: Drive) {
  await openFixture(app, screen);
  await app.open('/cash/savings?flow=save-deposit');
  await expect(screen.getByRole('textbox', { name: 'Amount' })).toBeVisible();
  await drive('Enter exactly 0.1 USDC and tap Continue. Stop at Confirm; do not deposit.', async () => {
    await screen.getByRole('textbox', { name: 'Amount' }).pressSequentially('0.1');
    await screen.getByRole('button', { name: 'Continue', exact: true }).tap();
  });
  await expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Deposit $0.10', exact: true })).toBeVisible();
  await expect(screen.getByText('Network fee', { exact: true })).toBeVisible();
  await expect(screen.getByText('Up to 0.02 USDC · ≈ $0.02', { exact: true })).toBeVisible();
}

export async function send({ app, screen }: Fixtures, drive: Drive) {
  const { page } = await openFixture(app, screen);
  await screen.getByRole('button', { name: 'Send', exact: true }).tap();
  await expect(screen.getByRole('textbox', { name: 'Amount' })).toBeVisible();
  await drive('Enter exactly 1 USDC and tap Continue. Stop at the To field.', async () => {
    await screen.getByRole('textbox', { name: 'Amount' }).pressSequentially('1');
    await screen.getByRole('button', { name: 'Continue', exact: true }).tap();
  });
  await expect(screen.getByRole('textbox', { name: 'To' })).toBeVisible();
  await drive(`Enter exactly ${RECIPIENT} in To and tap Continue. Stop at Confirm; do not send.`, async () => {
    await screen.getByRole('textbox', { name: 'To' }).pressSequentially(RECIPIENT);
    await screen.getByRole('button', { name: 'Continue', exact: true }).tap();
  });
  await expect(screen.getByRole('button', { name: 'Send $1.00', exact: true })).toBeVisible();
  await expect.poll(() => page.getByRole('button', { name: /Show full address/ }).getAttribute('title')).toBe(RECIPIENT);
  await screen.getByRole('button', { name: 'Send $1.00', exact: true }).tap();
  await expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  await screen.getByRole('button', { name: 'Try again' }).tap();
  await screen.getByRole('button', { name: 'Send $1.00', exact: true }).tap();
  await expect(screen.getByRole('heading', { name: '$1.00 on its way' })).toBeVisible();
  await expect(screen.getByText('Confirming on Base')).toBeVisible();
  await expect(screen.getByRole('button', { name: /try again|retry/i })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('home:playwright-smoke:dispatch-count'))).toBe('1');
  expect(page.url()).not.toMatch(/actionId=|action_id=|action=/);
  await page.reload();
  await expect(screen.getByRole('button', { name: 'Send $1.00', exact: true })).toHaveCount(0);
}
