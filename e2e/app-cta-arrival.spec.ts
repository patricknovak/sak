import { expect, type Page, test } from '@playwright/test';

// App-side landing CTA measurement: cta_arrival once per session per src on #/new?src=…

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

async function ctaArrivalEvents(page: Page) {
  return page.evaluate(() => {
    const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer || [];
    const out: string[] = [];
    for (const entry of layer) {
      if (!entry || typeof entry !== 'object') continue;
      const args = entry as { [i: number]: unknown };
      if (args[0] === 'event' && args[1] === 'cta_arrival') {
        out.push(String(((args[2] as { src?: string }) || {}).src || ''));
      }
    }
    return out;
  });
}

test.describe('cta_arrival on #/new', () => {
  test('granted consent: fires once per session per src', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __spAnalyticsTest?: boolean }).__spAnalyticsTest = true;
      localStorage.setItem('sp_analytics_consent', 'granted');
      localStorage.setItem('sp_ads_consent', 'denied');
    });
    await mockPublicNew(page);
    await page.goto('./#/new?src=home');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => ctaArrivalEvents(page), { timeout: 10_000 }).toEqual(['home']);

    // Same src again (extra query): still one event.
    await page.evaluate(() => { window.location.hash = '#/new?src=home&type=questions'; });
    await page.waitForTimeout(400);
    expect(await ctaArrivalEvents(page)).toEqual(['home']);

    await page.evaluate(() => { window.location.hash = '#/new?src=lib'; });
    await expect.poll(() => ctaArrivalEvents(page), { timeout: 5_000 }).toEqual(['home', 'lib']);
  });

  test('denied consent: no cta_arrival until Accept, then once', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __spAnalyticsTest?: boolean }).__spAnalyticsTest = true;
      // Leave consent unset so the banner shows; we Accept Analytics only mid-test.
    });
    await mockPublicNew(page);
    await page.goto('./#/new?src=traitors');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });
    expect(await ctaArrivalEvents(page)).toEqual([]);

    const dialog = page.getByRole('dialog', { name: /Analytics and ads/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Any Analytics choice closes the sheet and denies unanswered Ads (current banner).
    await dialog.getByRole('button', { name: 'Accept' }).first().click();
    await expect.poll(() => ctaArrivalEvents(page), { timeout: 10_000 }).toEqual(['traitors']);
    expect(await page.evaluate(() => sessionStorage.getItem('sp_cta_arrival:traitors'))).toBe('1');
  });

  test('denied Analytics: never fires', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __spAnalyticsTest?: boolean }).__spAnalyticsTest = true;
      localStorage.setItem('sp_analytics_consent', 'denied');
      localStorage.setItem('sp_ads_consent', 'denied');
    });
    await mockPublicNew(page);
    await page.goto('./#/new?src=hockey');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    expect(await ctaArrivalEvents(page)).toEqual([]);
    expect(await page.evaluate(() => sessionStorage.getItem('sp_cta_arrival:hockey'))).toBeNull();
  });
});
