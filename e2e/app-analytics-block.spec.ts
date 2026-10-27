import { expect, isAnalyticsHost, test } from './fixtures';

// Guard: if the global block is missing or a glob is too tight, this fails when GTM/GA leave the machine.

test.describe('e2e analytics network block', () => {
  test('no googletagmanager or google-analytics request reaches the live network', async ({ page }) => {
    const outcomes: { url: string; status: number | null; failed: boolean }[] = [];

    page.on('requestfinished', async (req) => {
      let host = '';
      try { host = new URL(req.url()).hostname; } catch { return; }
      if (!isAnalyticsHost(host)) return;
      const res = await req.response();
      outcomes.push({ url: req.url(), status: res?.status() ?? null, failed: false });
    });
    page.on('requestfailed', (req) => {
      let host = '';
      try { host = new URL(req.url()).hostname; } catch { return; }
      if (!isAnalyticsHost(host)) return;
      outcomes.push({ url: req.url(), status: null, failed: true });
    });

    await page.goto('./#/new');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });

    // Force the hosts the bug used: www.googletagmanager.com/gtag/js and g/collect.
    await page.evaluate(() => {
      const s = document.createElement('script');
      s.src = 'https://www.googletagmanager.com/gtag/js?id=G-E2E-BLOCK';
      document.head.appendChild(s);
      void fetch('https://www.google-analytics.com/g/collect?v=2&tid=G-E2E-BLOCK').catch(() => {});
      void fetch('https://stats.g.doubleclick.net/g/collect?v=2&tid=G-E2E-BLOCK').catch(() => {});
    });
    await expect.poll(() => outcomes.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

    for (const o of outcomes) {
      const host = new URL(o.url).hostname.toLowerCase();
      if (host.includes('googletagmanager.com')) {
        // Fulfilled locally as 204 — never a real Google response.
        expect(o.failed, o.url).toBe(false);
        expect(o.status, o.url).toBe(204);
      } else {
        // Collect / DoubleClick aborted before the wire.
        expect(o.failed, o.url).toBe(true);
      }
    }
  });
});
