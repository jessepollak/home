import { web, surfaceOf } from '@e2e-dev/web';
import { expect, type App, type Screen } from 'e2e';
import { installApiFixtures, seedSignedInSession } from '../../apps/web/tests/browser/fixtures/api';

const cdp = process.env.HOME_E2E_CDP_URL;
if (cdp) {
  const url = new URL(cdp);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('HOME_E2E_CDP_URL must identify a dedicated disposable loopback browser.');
  }
}
export const engine = web({ browser: 'chromium', viewport: { width: 390, height: 844 },
  ...(cdp ? { connect: { cdpEndpoint: async () => cdp } } : {}),
});

export async function openFixture(app: App, screen: Screen, country: 'US' | 'ID' = 'US') {
  const surface = surfaceOf(engine);
  if (!surface || !app.baseUrl) throw new Error('The pilot requires its fixture web target.');
  const base = new URL(app.baseUrl);
  const mutation = process.env.HOME_E2E_MUTATION;
  if (mutation && !['funding-first-tap', 'funding-wrong-amount', 'send-duplicate-dispatch'].includes(mutation)) {
    throw new Error(`Unknown pilot mutation: ${mutation}`);
  }
  await surface.context().route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol !== 'http:' || url.port !== base.port || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.fallback();
  });
  await app.open('/');
  const page = surface.page();
  const fundingRequests: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/funding/quotes') {
      fundingRequests.push(request.postData() ?? 'null');
    }
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedSignedInSession(page, country);
  await installApiFixtures(page);
  if (mutation === 'funding-first-tap') {
    await page.addInitScript(() => document.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('a[href="/home?flow=add-money"]')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true));
  }
  if (mutation === 'send-duplicate-dispatch') {
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        original.call(this, key, key === 'home:playwright-smoke:dispatch-count' ? String(Number(value) + 1) : value);
      };
    });
  }
  await app.open('/home');
  await expect(screen.getByRole('button', { name: 'Account', exact: true })).toBeEnabled();
  const cacheBadge = page.getByRole('button', { name: 'Collapse Cache disabled badge' });
  await cacheBadge.waitFor({ state: 'visible', timeout: 15_000 });
  await cacheBadge.click();
  return { page, fundingRequests };
}
