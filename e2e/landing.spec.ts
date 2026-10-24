import { expect, test } from '@playwright/test';

test.describe('Landing (superpoolsai.com)', () => {
  test('home hero, never-money claim, and start CTA', async ({ page }) => {
    await page.goto('./');
    await expect(page).toHaveTitle(/Super Pools/i);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Fantasy Pools/i);
    await expect(page.getByText('Never money').first()).toBeVisible();
    const start = page.getByRole('link', { name: /Start a pool/i }).first();
    await expect(start).toBeVisible();
    await expect(start).toHaveAttribute('href', /app\.superpoolsai\.com\/#\/new/);
  });

  async function plantLandingAnalytics(page: import('@playwright/test').Page, granted: boolean) {
    await page.route('**/googletagmanager.com/**', (route) => route.fulfill({ status: 204, body: '' }));
    // App CTA navigates cross-origin; fulfill so waitForURL can settle without a real app load.
    await page.route('https://app.superpoolsai.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>app</title>ok' }));
    await page.addInitScript((on) => {
      (window as unknown as { __spAnalyticsTest?: boolean }).__spAnalyticsTest = true;
      localStorage.setItem('sp_analytics_consent', on ? 'granted' : 'denied');
      localStorage.setItem('sp_ads_consent', 'denied');
    }, granted);
  }

  /** Mimic gtag.js event_callback and report the cta_click payload to Node before navigation. */
  async function installCtaProbe(page: import('@playwright/test').Page) {
    const seen: { src: string | null; hasCallback: boolean; sendTo: string | null }[] = [];
    await page.exposeFunction('__e2eOnCta', (payload: { src: string | null; hasCallback: boolean; sendTo: string | null }) => {
      seen.push(payload);
    });
    await page.evaluate(() => {
      const w = window as unknown as {
        gtag?: (...a: unknown[]) => unknown;
        __e2eOnCta?: (p: { src: string | null; hasCallback: boolean; sendTo: string | null }) => void;
      };
      const prev = w.gtag;
      if (typeof prev !== 'function') return;
      w.gtag = function wrappedGtag(this: unknown) {
        const a0 = arguments[0];
        const a1 = arguments[1];
        const a2 = arguments[2] as {
          src?: string; event_callback?: () => void; send_to?: string;
        } | undefined;
        if (a0 === 'event' && a1 === 'cta_click') {
          try {
            w.__e2eOnCta?.({
              src: a2?.src ?? null,
              hasCallback: typeof a2?.event_callback === 'function',
              sendTo: a2?.send_to ?? null,
            });
          } catch { /* ignore */ }
        }
        const ret = prev.apply(this, arguments as unknown as []);
        if (a0 === 'event' && a2 && typeof a2.event_callback === 'function') {
          queueMicrotask(() => { try { a2.event_callback!(); } catch { /* ignore */ } });
        }
        return ret;
      };
    });
    return seen;
  }

  test('cta_click with consent uses event_callback then navigates (src=home)', async ({ page }) => {
    await plantLandingAnalytics(page, true);
    await page.goto('./');
    await expect.poll(async () => page.evaluate(() => !!document.getElementById('sp-ga4')), {
      timeout: 10_000,
    }).toBe(true);
    const seen = await installCtaProbe(page);

    const start = page.getByRole('link', { name: /Start a pool, free|Start a pool/i }).first();
    await expect(start).toHaveAttribute('href', /[?&]src=home\b/);
    const t0 = Date.now();
    await Promise.all([
      page.waitForURL(/app\.superpoolsai\.com/, { timeout: 5_000 }),
      start.click(),
    ]);
    expect(Date.now() - t0).toBeLessThan(800);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0].src).toBe('home');
    expect(seen[0].hasCallback).toBe(true);
    expect(seen[0].sendTo).toMatch(/^G-/);
    expect(page.url()).toMatch(/app\.superpoolsai\.com/);
  });

  test('cta_click denied: no event, link navigates immediately', async ({ page }) => {
    await plantLandingAnalytics(page, false);
    await page.goto('./love-is-blind.html');
    const seen = await installCtaProbe(page);
    const cta = page.getByRole('link', { name: /Start your Love Is Blind pool/i }).first();
    await expect(cta).toBeVisible();
    expect(await page.evaluate(() => document.getElementById('sp-ga4'))).toBeNull();

    const started = Date.now();
    await Promise.all([
      page.waitForURL(/app\.superpoolsai\.com/, { timeout: 5_000 }),
      cta.click(),
    ]);
    expect(Date.now() - started).toBeLessThan(800);
    expect(seen).toEqual([]);
  });

  test('love-is-blind CTA: cta_click src=lib via callback path then navigates', async ({ page }) => {
    await plantLandingAnalytics(page, true);
    await page.goto('./love-is-blind.html');
    await expect.poll(async () => page.evaluate(() => !!document.getElementById('sp-ga4')), {
      timeout: 10_000,
    }).toBe(true);
    const seen = await installCtaProbe(page);
    const cta = page.getByRole('link', { name: /Start your Love Is Blind pool/i }).first();
    await expect(cta).toHaveAttribute('href', /[?&]src=lib\b/);
    await Promise.all([
      page.waitForURL(/app\.superpoolsai\.com.*src=lib/, { timeout: 5_000 }),
      cta.click(),
    ]);
    expect(seen[0]?.src).toBe('lib');
    expect(seen[0]?.hasCallback).toBe(true);
  });

  test('FAQ answers the money and app questions', async ({ page }) => {
    await page.goto('./#faq');
    const money = page.locator('details').filter({ hasText: /real money/i });
    await money.locator('summary').click();
    await expect(money).toContainText(/never bought, never sold/i);
    const app = page.locator('details').filter({ hasText: /download an app/i });
    await app.locator('summary').click();
    await expect(app).toContainText(/No/i);
  });

  test('open-now board loads events from the public API', async ({ page }) => {
    await page.goto('./#open');
    // ghosts clear once pool_event_list answers; at least one real event card or an empty-state
    await expect(page.locator('#now .ev:not(.ghost), #now .empty, #now a').first()).toBeVisible({ timeout: 20_000 });
  });

  test('together and love-is-blind pages load', async ({ page }) => {
    await page.goto('./together.html');
    await expect(page).toHaveTitle(/any group|Super Pools/i);
    await expect(page.getByText(/never money/i).first()).toBeVisible();

    await page.goto('./love-is-blind.html');
    await expect(page).toHaveTitle(/Love Is Blind/i);
    await expect(page.getByText(/never money/i).first()).toBeVisible();
  });

  test('sport pool landing pages load', async ({ page }) => {
    for (const path of ['./football-pools.html', './hockey-pools.html', './basketball-pools.html']) {
      await page.goto(path);
      await expect(page.locator('h1, .display').first()).toBeVisible();
      await expect(page.getByRole('link', { name: /Start|pool/i }).first()).toBeVisible();
    }
  });

  test('the World Series page starts a pool on the World Series with the kind ticked', async ({ page }) => {
    await page.goto('./world-series-pools.html');
    await expect(page).toHaveTitle(/World Series/i);
    await expect(page.getByText(/never money/i).first()).toBeVisible();
    const start = page.getByRole('link', { name: /Start a World Series pool/i }).first();
    await expect(start).toHaveAttribute('href', /app\.superpoolsai\.com\/#\/new\?comp=mlb-post-2026&kind=series&src=ws_page/);
    await expect(page.getByRole('link', { name: /A squares grid/i })).toHaveAttribute('href', /kind=squares&src=ws_page/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-world-series\.png/);
  });

  test('no payment or Stripe checkout surface', async ({ page }) => {
    await page.goto('./');
    // Supercoins are never money: no Stripe, no checkout, and the page itself says so
    await expect(page.locator('a[href*="stripe"], a[href*="checkout"], form[action*="stripe"]')).toHaveCount(0);
    await expect(page.getByText(/Never money|Play coins only|Never bought, never sold/i).first()).toBeVisible();
  });
});
