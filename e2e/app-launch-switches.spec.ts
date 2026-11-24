import { expect, type Page, test } from './fixtures';

// The Platform page's launch switches (src/pages/Platform.tsx, src/lib/turnstile.ts): the join function says which of
// the bot check and the email code are on, so whoever pastes a key sees that it took. The start page asks the same
// answer for the bot check's public key, so the check comes on from Supabase's function secrets with no build.

const USER_ID = 'e2e-platform-admin';

function json(data: unknown) {
  return { status: 200, contentType: 'application/json', headers: { 'content-range': Array.isArray(data) ? `0-${Math.max(data.length - 1, 0)}/${data.length}` : '0-0/1' }, body: JSON.stringify(data) };
}

async function asAdmin(page: Page, switches: Record<string, unknown>) {
  await page.addInitScript((id) => {
    localStorage.setItem('sak-remember', '1');
    localStorage.setItem('sp_analytics_consent', 'denied');
    localStorage.setItem('sp_ads_consent', 'denied');
    localStorage.setItem('sak-auth', JSON.stringify({ access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer',
      user: { id, aud: 'authenticated', role: 'authenticated', email: 'e2e-admin@example.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' } }));
  }, USER_ID);
  await page.route('**/quakdkzdafzlhgjvmypg.supabase.co/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/functions/v1/join')) {
      const body = route.request().postDataJSON() as { config?: boolean } | null;
      return route.fulfill(body?.config === true ? json({ ok: true, ...switches }) : { status: 400, contentType: 'application/json', body: '{"error":"no"}' });
    }
    if (url.includes('/auth/v1/user')) return route.fulfill(json({ id: USER_ID, email: 'e2e-admin@example.com', role: 'authenticated', aud: 'authenticated' }));
    if (url.includes('/auth/v1/')) return route.fulfill(json({}));
    if (url.includes('/rest/v1/rpc/')) {
      const name = url.split('/rest/v1/rpc/')[1]?.split('?')[0] ?? '';
      if (name === 'platform_leagues') return route.fulfill(json([]));
      return route.fulfill(json(null));
    }
    if (url.includes('/rest/v1/teams')) return route.fulfill(json([{ id: 1, name: 'Sam', abbrev: 'SAM', gm_name: 'Sam', login_email: 'e2e-admin@example.com', user_id: USER_ID, color: '#4ade80', emoji: '🏈', motto: null, fav_nhl: null, is_commish: true, joined_season: null, auto_lineup: false, autodraft: false, keepers_submitted: false, last_seen: null, auto_mode: 'off', auto_basis: 'proj', lineup_touched: null, role: 'gm', perms: {}, tv: {} }]));
    if (url.includes('/rest/v1/league') && !url.includes('leagues')) return route.fulfill(json({ league_id: 7, name: 'The Red Zone', season: '2026', phase: 'season', format: 'season' }));
    if (url.includes('/rest/v1/leagues')) return route.fulfill(json({ brand: null, short_name: 'RZ', sport: 'nfl', kind: 'predict' }));
    if (url.includes('/rest/v1/draft_state')) return route.fulfill(json({ status: 'idle', pick: 0, round: 0, on_clock: null, deadline: null }));
    if (url.includes('/rest/v1/')) return route.fulfill(json([]));
    return route.fulfill({ status: 204, body: '' });
  });
}

test.describe('Launch switches on the Platform page', () => {
  test('both off: each says what to set', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await asAdmin(page, { turnstile: '', human: false, codes: false });
    await page.goto('./#/platform');
    await expect(page.getByRole('heading', { name: 'Launch switches' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Add TURNSTILE_SITE_KEY and TURNSTILE_SECRET/)).toBeVisible();
    await expect(page.getByText(/then the EMAIL_CODES secret to on/)).toBeVisible();
    await expect(page.getByText('Off', { exact: true })).toHaveCount(2);
  });

  test('the bot check half set is called out, the email code on', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await asAdmin(page, { turnstile: '0x4AAAAAAAe2e', human: false, codes: true });
    await page.goto('./#/platform');
    await expect(page.getByText('Half set', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Add the secret, TURNSTILE_SECRET, to finish/)).toBeVisible();
    await expect(page.getByText('On', { exact: true })).toHaveCount(1);
    if (process.env.SHOT) { await page.getByRole('heading', { name: 'Launch switches' }).evaluate((el) => el.scrollIntoView({ block: 'start' })); await page.screenshot({ path: process.env.SHOT }); }
  });

  test('a secret with no public key is flagged as refusing people', async ({ page }) => {
    await asAdmin(page, { turnstile: '', human: true, codes: false });
    await page.goto('./#/platform');
    await expect(page.getByText(/new accounts are being refused/)).toBeVisible({ timeout: 30_000 });
  });
});
