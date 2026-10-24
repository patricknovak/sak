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

  test('landing CTA navigates without delay (no click hold)', async ({ page }) => {
    await page.route('https://app.superpoolsai.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>app</title>ok' }));
    await page.goto('./');
    const start = page.getByRole('link', { name: /Start a pool, free|Start a pool/i }).first();
    await expect(start).toHaveAttribute('href', /[?&]src=home\b/);
    const t0 = Date.now();
    await Promise.all([
      page.waitForURL(/app\.superpoolsai\.com/, { timeout: 5_000 }),
      start.click(),
    ]);
    expect(Date.now() - t0).toBeLessThan(800);
  });

  test('sp_consent cookie fills keys and skips the consent bar', async ({ page }) => {
    await page.addInitScript(() => {
      document.cookie = `sp_consent=${encodeURIComponent('a=granted;d=denied')}; Path=/; SameSite=Lax`;
    });
    await page.goto('./');
    await expect(page.locator('#sp-consent')).toHaveCount(0);
    const keys = await page.evaluate(() => ({
      a: localStorage.getItem('sp_analytics_consent'),
      d: localStorage.getItem('sp_ads_consent'),
    }));
    expect(keys).toEqual({ a: 'granted', d: 'denied' });
  });

  test('localhost Accept does not write sp_consent cookie', async ({ page }) => {
    await page.goto('./');
    const bar = page.locator('#sp-consent');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await bar.locator('button[data-a="1"]').click();
    await bar.locator('button[data-d="0"]').click();
    await expect(bar).toHaveCount(0);
    const hasCookie = await page.evaluate(() =>
      (document.cookie || '').split(';').some((p) => p.trim().startsWith('sp_consent=')));
    expect(hasCookie).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('sp_analytics_consent'))).toBe('granted');
    expect(await page.evaluate(() => localStorage.getItem('sp_ads_consent'))).toBe('denied');
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
