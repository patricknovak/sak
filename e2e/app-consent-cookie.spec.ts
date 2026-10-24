import { expect, type Page, test } from '@playwright/test';

// Shared sp_consent cookie: app hydrates empty localStorage and skips the sheet.

function json(data: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'content-range': Array.isArray(data) ? `0-${Math.max(data.length - 1, 0)}/${data.length}` : '0-0/1' },
    body: JSON.stringify(data),
  };
}

async function mockPublicNew(page: Page) {
  await page.route('**/googletagmanager.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/quakdkzdafzlhgjvmypg.supabase.co/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/')) return route.fulfill(json({}));
    if (url.includes('/rest/v1/rpc/pool_pack_list')) return route.fulfill(json([]));
    if (url.includes('/rest/v1/rpc/pool_event_list')) return route.fulfill(json([]));
    if (url.includes('/rest/v1/rpc/')) return route.fulfill(json(null));
    if (url.includes('/rest/v1/')) return route.fulfill(json([]));
    return route.fulfill({ status: 204, body: '' });
  });
}

test.describe('shared consent cookie', () => {
  test('cookie fills keys and skips the consent sheet', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __spAnalyticsTest?: boolean }).__spAnalyticsTest = true;
      // Host-only cookie (localhost cannot use Domain=.superpoolsai.com); hydrate still reads it.
      document.cookie = `sp_consent=${encodeURIComponent('a=granted;d=denied')}; Path=/; SameSite=Lax`;
    });
    await mockPublicNew(page);
    await page.goto('./#/new?src=consent_cookie');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: /Analytics and ads/i })).toHaveCount(0);
    const keys = await page.evaluate(() => ({
      a: localStorage.getItem('sp_analytics_consent'),
      d: localStorage.getItem('sp_ads_consent'),
    }));
    expect(keys).toEqual({ a: 'granted', d: 'denied' });
  });

  test('localhost Accept does not write sp_consent cookie', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __spAnalyticsTest?: boolean }).__spAnalyticsTest = true;
    });
    await mockPublicNew(page);
    await page.goto('./#/new');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: /Analytics and ads/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Accept' }).first().click();
    await expect(dialog).toHaveCount(0);
    const cookie = await page.evaluate(() => {
      const raw = document.cookie || '';
      return raw.split(';').some((p) => p.trim().startsWith('sp_consent='));
    });
    expect(cookie).toBe(false);
    const keys = await page.evaluate(() => ({
      a: localStorage.getItem('sp_analytics_consent'),
      d: localStorage.getItem('sp_ads_consent'),
    }));
    expect(keys.a).toMatch(/granted|denied/);
    expect(keys.d).toMatch(/granted|denied/);
  });

  test('privacy mentions the shared cookie', async ({ page }) => {
    await mockPublicNew(page);
    await page.goto('./#/privacy');
    await expect(page.getByText(/stored in your browser and in a cookie on superpoolsai\.com/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
