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

  test('FAQ answers the money and app questions', async ({ page }) => {
    await page.goto('./#faq');
    const money = page.locator('details').filter({ hasText: /real money/i });
    await money.locator('summary').click();
    await expect(money).toContainText(/cannot be bought, sold or cashed out/i);
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
    await expect(start).toHaveAttribute('href', /app\.superpoolsai\.com\/#\/new\?comp=mlb-post-2026&kind=series&utm_source=landing/);
    await expect(page.getByRole('link', { name: /A squares grid/i })).toHaveAttribute('href', /kind=squares/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-world-series\.png/);
  });

  test('no payment or Stripe checkout surface', async ({ page }) => {
    await page.goto('./');
    // Supercoins are never money: no Stripe, no checkout, and the page itself says so
    await expect(page.locator('a[href*="stripe"], a[href*="checkout"], form[action*="stripe"]')).toHaveCount(0);
    await expect(page.getByText(/Never money|No buying coins|No cashing out/i).first()).toBeVisible();
  });
});
