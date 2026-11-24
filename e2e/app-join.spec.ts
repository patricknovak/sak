import { devices } from '@playwright/test';
import { expect, type Page, test } from './fixtures';

// The page a friend opens from an invite (#/join/<code>), on a phone: the pitch, a name, a first call, and in. The join
// is how a pool grows, so this walks it against a mocked Supabase, and checks what broke it on 24 November 2026: the
// consent line floating over Join the pool. The line is part of the page now (ConsentSlot) and must never sit on a
// button a newcomer reaches for.

const { defaultBrowserType: _engine, ...phone } = devices['iPhone 13'];
test.use({ ...phone });

function json(data: unknown, status = 200) {
  return { status, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify(data) };
}
const GUEST = 'guest-e2e@guest.superpoolsai.com';
const user = { id: 'e2e-guest', aud: 'authenticated', role: 'authenticated', email: GUEST, email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: { guest: true }, created_at: '2026-01-01T00:00:00Z' };
const closes = new Date(Date.now() + 30 * 36e5).toISOString();
const preview = {
  ok: true, reason: null, league_id: 77, league: 'Friday Watch Party', short: 'FWP', kind: 'predict', role: 'gm', team: null,
  brand: { colors: { gold: '#fb7185' }, coin: { name: 'Coins', emoji: '🪙' }, tagline: 'A Super Pools pool', wordmark: { a: 'FRIDAY', b: 'WATCH PARTY' } },
  host: 'Dana', members: 2, open_questions: 1, next_market: 1, next_question: 'Who goes home first?', next_closes: closes,
  next_outcomes: [{ key: 'a', label: 'The chef', pct: 50 }, { key: 'b', label: 'The pilot', pct: 50 }],
};

async function mock(page: Page, seen: { join: Record<string, unknown>[]; buy: Record<string, unknown>[] }) {
  await page.route('**/quakdkzdafzlhgjvmypg.supabase.co/**', async (route) => {
    const req = route.request(), url = req.url();
    const signedIn = (req.headers()['authorization'] ?? '').includes('e2e-guest-access');
    if (url.includes('/auth/v1/token')) return route.fulfill(json({ access_token: 'e2e-guest-access', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user }));
    if (url.includes('/auth/v1/user')) return route.fulfill(json(user));
    if (url.includes('/auth/v1/')) return route.fulfill(json({}));
    if (url.includes('/functions/v1/join')) {
      seen.join.push(req.postDataJSON() as Record<string, unknown>);
      return route.fulfill(json({ ok: true, league: 77, email: GUEST, password: 'pw-e2e-guest' }));
    }
    if (url.includes('/rest/v1/rpc/invite_preview')) return route.fulfill(json(preview));
    if (url.includes('/rest/v1/rpc/pool_buy')) { seen.buy.push(req.postDataJSON() as Record<string, unknown>); return route.fulfill(json({ ok: true })); }
    if (url.includes('/rest/v1/rpc/pool_scoreboard')) return route.fulfill(json({ games: [], crown: null }));
    if (url.includes('/rest/v1/rpc/')) return route.fulfill(json(null));
    if (url.includes('/rest/v1/teams')) return route.fulfill(json(signedIn ? [{ id: 2, league_id: 77, name: 'Sam', abbrev: 'SAM', gm_name: 'Sam', user_id: 'e2e-guest', is_commish: false, role: 'gm', color: '#38bdf8', emoji: '🎯', perms: {}, tv: {} }] : []));
    if (/\/rest\/v1\/league(\?|$)/.test(url)) return route.fulfill(signedIn ? json({ league_id: 77, name: 'Friday Watch Party', season: '2026', phase: 'season', format: 'season' }) : json({ code: 'PGRST116', message: 'no rows' }, 406));
    if (url.includes('/rest/v1/leagues')) return route.fulfill(json({ brand: preview.brand, short_name: 'FWP', sport: 'nhl', kind: 'predict' }));
    if (url.includes('/rest/v1/draft_state')) return route.fulfill(json({ status: 'idle', pick: 0, round: 0, on_clock: null, deadline: null }));
    if (url.includes('/rest/v1/coin_balances')) return route.fulfill(json({ balance: 1000, escrow: 0 }));
    return route.fulfill(json([]));
  });
}

// two boxes on the screen that share any pixel
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe('an invite opened on a phone', () => {
  test('the pitch, a name and a first call: in, with the call placed', async ({ page }) => {
    const seen = { join: [] as Record<string, unknown>[], buy: [] as Record<string, unknown>[] };
    await mock(page, seen);
    await page.goto('./#/join/e2ecode1?src=share');
    await expect(page.getByRole('heading', { name: 'Friday Watch Party' })).toBeVisible();
    await expect(page.getByText(/Dana invited you/)).toBeVisible();
    await expect(page.getByText('Who goes home first?')).toBeVisible();

    // with Join the pool on the screen, the consent line (still unanswered) is nowhere on it
    const join = page.getByRole('button', { name: 'Join the pool' });
    const consent = page.getByRole('dialog', { name: /Analytics and ads/i });
    await expect(consent).toBeAttached();
    await join.scrollIntoViewIfNeeded();
    const jb = (await join.boundingBox())!, cb = (await consent.boundingBox())!;
    expect(overlap(jb, cb)).toBe(false);
    expect(await consent.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');

    await page.getByRole('button', { name: /The pilot/ }).click();
    await expect(page.getByText(/Your first call: /)).toBeVisible();
    await page.getByLabel('Your name').fill('Sam');
    await join.click();

    // a seat from just a name, then the call picked on the invite, placed in the pool just joined
    await expect.poll(() => seen.join.length).toBe(1);
    expect(seen.join[0]).toMatchObject({ code: 'e2ecode1', name: 'Sam', guest: true });
    await expect.poll(() => seen.buy.length).toBe(1);
    expect(seen.buy[0]).toMatchObject({ p_market: 1, p_outcome: 'b', p_coins: 100 });
    // and they land in the pool, greeted by name, the consent line in the page above it
    await expect(page.getByRole('heading', { name: /Hi Sam/ })).toBeVisible({ timeout: 20_000 });
    const line = page.getByRole('dialog', { name: /Analytics and ads/i });
    await expect(line).toBeVisible();
    expect(await line.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
  });

  test('a link that has expired says so and offers a pool of your own', async ({ page }) => {
    const seen = { join: [] as Record<string, unknown>[], buy: [] as Record<string, unknown>[] };
    await mock(page, seen);
    await page.route('**/rest/v1/rpc/invite_preview', (route) => route.fulfill(json({ ok: false, reason: 'expired' })));
    await page.goto('./#/join/e2ecode1');
    await expect(page.getByText(/That invite has expired/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start a pool of your own' })).toHaveAttribute('href', '#/new');
  });
});
