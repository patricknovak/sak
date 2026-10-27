import { expect, type Page, test } from './fixtures';

// Product home (signed-out app.superpoolsai.com): World Series CTA → #/new prefilled + cta_arrival.

const WS = {
  competition: 'mlb-post-2026',
  name: 'MLB Postseason 2026',
  sport: 'mlb',
  kinds: ['series', 'props', 'squares', 'streak'],
  pack: null as string | null,
  open_label: 'WS',
  open_round: 4,
  final_label: 'World Series',
  final_round: 4,
  final_starts: new Date(Date.now() - 2 * 864e5).toISOString(),
  next_lock: new Date(Date.now() + 2 * 3600e3).toISOString(),
  stage: 'World Series',
  club_word: 'team',
  sheets: [{ id: 1, kickoff: new Date(Date.now() + 2 * 3600e3).toISOString(), game_no: 3, label: 'World Series', home: 'LAD', away: 'NYY' }],
  grids: [] as unknown[],
};

function json(data: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'content-range': Array.isArray(data) ? `0-${Math.max(data.length - 1, 0)}/${data.length}` : '0-0/1' },
    body: JSON.stringify(data),
  };
}

async function mockPublicHome(page: Page, events: unknown[] = [WS]) {
  await page.route('**/*googletagmanager.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/quakdkzdafzlhgjvmypg.supabase.co/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/')) return route.fulfill(json({}));
    if (url.includes('/rest/v1/rpc/pool_event_list')) return route.fulfill(json(events));
    if (url.includes('/rest/v1/rpc/pool_pack_list')) return route.fulfill(json([]));
    if (url.includes('/rest/v1/rpc/')) return route.fulfill(json(null));
    if (url.includes('/rest/v1/')) return route.fulfill(json([]));
    return route.fulfill({ status: 204, body: '' });
  });
}

async function ctaArrivalSrcs(page: Page) {
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

test.describe('World Series home CTA', () => {
  test('button on home opens #/new prefilled and fires cta_arrival home-ws', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __spAnalyticsTest?: boolean }).__spAnalyticsTest = true;
      localStorage.setItem('sp_analytics_consent', 'granted');
      localStorage.setItem('sp_ads_consent', 'denied');
    });
    await mockPublicHome(page);
    await page.goto('./#/');
    const cta = page.getByRole('link', { name: /Start a World Series pool/i });
    await expect(cta).toBeVisible({ timeout: 30_000 });
    await expect(cta).toHaveAttribute('href', /#\/new\?comp=mlb-post-2026&kind=series&src=home-ws/);
    await cta.click();
    await expect(page).toHaveURL(/#\/new\?comp=mlb-post-2026/);
    await expect(page.getByText(/World Series|MLB Postseason/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel(/Name your pool/i)).toBeVisible();
    await expect.poll(async () => page.getByLabel(/Name your pool/i).inputValue()).toMatch(/World Series|MLB/i);
    await expect.poll(() => ctaArrivalSrcs(page), { timeout: 10_000 }).toContain('home-ws');
  });

  test('hidden when no World Series games remain', async ({ page }) => {
    await mockPublicHome(page, [{
      ...WS,
      next_lock: null,
      sheets: [],
      grids: [],
    }]);
    await page.goto('./#/');
    await expect(page.getByText(/Sign in|Run a pool/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: /Start a World Series pool/i })).toHaveCount(0);
  });

  test('hidden when mlb-post-2026 is absent from pool_event_list', async ({ page }) => {
    await mockPublicHome(page, []);
    await page.goto('./#/');
    await expect(page.getByText(/Sign in|Run a pool/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: /Start a World Series pool/i })).toHaveCount(0);
  });

  test('#/new?comp=mlb-post-2026 does not prefill when the event is absent', async ({ page }) => {
    await mockPublicHome(page, []);
    await page.goto('./#/new?comp=mlb-post-2026&kind=series&src=home-ws');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel(/Name your pool/i)).toHaveCount(0);
    await expect(page.getByText(/MLB Postseason|World Series pool/i)).toHaveCount(0);
  });
});
