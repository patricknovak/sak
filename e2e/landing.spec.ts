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

  test('cta_click fires with src when Analytics is granted (not without consent)', async ({ page }) => {
    await page.route('**/googletagmanager.com/**', (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
      (window as unknown as { __spAnalyticsTest?: boolean }).__spAnalyticsTest = true;
      localStorage.setItem('sp_analytics_consent', 'granted');
      localStorage.setItem('sp_ads_consent', 'denied');
    });
    await page.goto('./');
    await expect.poll(async () => page.evaluate(() => !!document.getElementById('sp-ga4')), {
      timeout: 10_000,
    }).toBe(true);

    const ctaClicks = async () => page.evaluate(() => {
      const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer || [];
      const out: string[] = [];
      for (const entry of layer) {
        if (!entry || typeof entry !== 'object') continue;
        const args = entry as { [i: number]: unknown };
        if (args[0] === 'event' && args[1] === 'cta_click') {
          const p = (args[2] as { src?: string }) || {};
          out.push(String(p.src || ''));
        }
      }
      return out;
    });

    expect(await ctaClicks()).toEqual([]);
    const start = page.getByRole('link', { name: /Start a pool, free|Start a pool/i }).first();
    await expect(start).toHaveAttribute('href', /[?&]src=home\b/);
    // Stay on the landing page so we can read dataLayer after the click.
    await page.evaluate(() => {
      document.querySelectorAll('a[href*="app.superpoolsai.com"]').forEach((a) => {
        a.addEventListener('click', (e) => e.preventDefault(), true);
      });
    });
    await start.click();
    await expect.poll(ctaClicks, { timeout: 5_000 }).toEqual(['home']);
  });

  test('cta_click does not fire when Analytics consent is denied', async ({ page }) => {
    await page.route('**/googletagmanager.com/**', (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
      (window as unknown as { __spAnalyticsTest?: boolean }).__spAnalyticsTest = true;
      localStorage.setItem('sp_analytics_consent', 'denied');
      localStorage.setItem('sp_ads_consent', 'denied');
    });
    await page.goto('./love-is-blind.html');
    await expect(page.getByRole('link', { name: /Start your Love Is Blind pool/i }).first()).toBeVisible();
    await page.evaluate(() => {
      document.querySelectorAll('a[href*="app.superpoolsai.com"]').forEach((a) => {
        a.addEventListener('click', (e) => e.preventDefault(), true);
      });
    });
    await page.getByRole('link', { name: /Start your Love Is Blind pool/i }).first().click();
    const n = await page.evaluate(() => {
      const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer || [];
      let count = 0;
      for (const entry of layer) {
        if (!entry || typeof entry !== 'object') continue;
        const args = entry as { [i: number]: unknown };
        if (args[0] === 'event' && args[1] === 'cta_click') count += 1;
      }
      return count;
    });
    expect(n).toBe(0);
    expect(await page.evaluate(() => document.getElementById('sp-ga4'))).toBeNull();
  });

  test('love-is-blind CTA sends cta_click with src=lib', async ({ page }) => {
    await page.route('**/googletagmanager.com/**', (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
      (window as unknown as { __spAnalyticsTest?: boolean }).__spAnalyticsTest = true;
      localStorage.setItem('sp_analytics_consent', 'granted');
      localStorage.setItem('sp_ads_consent', 'denied');
    });
    await page.goto('./love-is-blind.html');
    await expect.poll(async () => page.evaluate(() => !!document.getElementById('sp-ga4')), {
      timeout: 10_000,
    }).toBe(true);
    const cta = page.getByRole('link', { name: /Start your Love Is Blind pool/i }).first();
    await expect(cta).toHaveAttribute('href', /[?&]src=lib\b/);
    await page.evaluate(() => {
      document.querySelectorAll('a[href*="app.superpoolsai.com"]').forEach((a) => {
        a.addEventListener('click', (e) => e.preventDefault(), true);
      });
    });
    await cta.click();
    await expect.poll(async () => page.evaluate(() => {
      const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer || [];
      for (const entry of layer) {
        if (!entry || typeof entry !== 'object') continue;
        const args = entry as { [i: number]: unknown };
        if (args[0] === 'event' && args[1] === 'cta_click') {
          return String(((args[2] as { src?: string }) || {}).src || '');
        }
      }
      return '';
    }), { timeout: 5_000 }).toBe('lib');
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
