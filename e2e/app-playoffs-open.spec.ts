import { expect, type Page, test } from './fixtures';

// The host of a pool on a sport whose playoffs have just opened is told on the pool's home, with one tap to Add a game
// (src/components/PlayoffsOpen.tsx): the promise the event landing pages make to a pool started weeks ahead.

const USER_ID = 'e2e-playoffs-host';
const soon = new Date(Date.now() + 4 * 864e5).toISOString();
const NFL = { competition: 'nfl', name: 'NFL', sport: 'nfl', kinds: ['pickem', 'survivor'], pack: null, stage: 'Week 18 under way', open_round: 18, open_label: 'Week 18', final_round: 18, final_label: 'Week 18', club_word: 'team', word: 'Week', sheets: [], grids: [], game_grids: [], next_lock: soon, final_starts: null };
const POST = { competition: 'nfl-post-2026', name: 'NFL Playoffs', sport: 'nfl', kinds: ['series', 'bracket', 'survivor', 'sweep'], pack: null, stage: 'Wild card next', open_round: 1, open_label: 'Wild card', final_round: 4, final_label: 'Super Bowl', club_word: 'team', sheets: [],
  grids: [{ id: 9, round: 4, label: 'Super Bowl', short: 'Super Bowl', best_of: 1, starts_at: null, tbd: true, high: null, low: null }], game_grids: [], next_lock: soon, final_starts: null };

function json(data: unknown) {
  return { status: 200, contentType: 'application/json', headers: { 'content-range': Array.isArray(data) ? `0-${Math.max(data.length - 1, 0)}/${data.length}` : '0-0/1' }, body: JSON.stringify(data) };
}

async function asHost(page: Page, own: unknown[]) {
  await page.addInitScript((id) => {
    localStorage.setItem('sak-remember', '1');
    localStorage.setItem('sp_analytics_consent', 'denied');
    localStorage.setItem('sp_ads_consent', 'denied');
    localStorage.setItem('sak-auth', JSON.stringify({ access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer',
      user: { id, aud: 'authenticated', role: 'authenticated', email: 'e2e-host@example.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' } }));
  }, USER_ID);
  await page.route('**/*googletagmanager.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/quakdkzdafzlhgjvmypg.supabase.co/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) return route.fulfill(json({ id: USER_ID, email: 'e2e-host@example.com', role: 'authenticated', aud: 'authenticated' }));
    if (url.includes('/auth/v1/')) return route.fulfill(json({}));
    if (url.includes('/rest/v1/rpc/')) {
      const name = url.split('/rest/v1/rpc/')[1]?.split('?')[0] ?? '';
      if (name === 'pool_event_list') return route.fulfill(json([NFL, POST]));
      if (name === 'pool_competitions') return route.fulfill(json(own));
      return route.fulfill(json(null));
    }
    if (url.includes('/rest/v1/teams')) return route.fulfill(json([{ id: 1, name: 'Sam', abbrev: 'SAM', gm_name: 'Sam', login_email: 'e2e-host@example.com', user_id: USER_ID, color: '#4ade80', emoji: '🏈', motto: null, fav_nhl: null, is_commish: true, joined_season: null, auto_lineup: false, autodraft: false, keepers_submitted: false, last_seen: null, auto_mode: 'off', auto_basis: 'proj', lineup_touched: null, role: 'gm', perms: {}, tv: {} }]));
    if (url.includes('/rest/v1/league') && !url.includes('leagues')) return route.fulfill(json({ league_id: 7, name: 'The Red Zone', season: '2026', phase: 'season', format: 'season' }));
    if (url.includes('/rest/v1/leagues')) return route.fulfill(json({ brand: null, short_name: 'RZ', sport: 'nfl', kind: 'predict' }));
    if (url.includes('/rest/v1/draft_state')) return route.fulfill(json({ status: 'idle', pick: 0, round: 0, on_clock: null, deadline: null }));
    if (url.includes('/rest/v1/')) return route.fulfill(json([]));
    return route.fulfill({ status: 204, body: '' });
  });
}

test.describe('The playoffs are open, on the pool home', () => {
  test('a host whose pool follows the sport is offered its playoffs, and can put the card away', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await asHost(page, [{ id: 'nfl', name: 'NFL', short: 'NFL', sport: 'nfl', format: 'rounds', ext_id: null }]);
    await page.goto('./#/');
    const card = page.getByRole('region', { name: /NFL Playoffs are open/i });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText(/Same pool, same people, same table/i)).toBeVisible();
    await expect(card.getByText('Bracket', { exact: true })).toBeVisible();
    await expect(card.getByRole('link', { name: /Add a game/i })).toHaveAttribute('href', /#\/host\?add=1/);
    if (process.env.SHOT) { await card.evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.screenshot({ path: process.env.SHOT }); }
    await card.getByRole('button', { name: /Not now/i }).click();
    await expect(card).toBeHidden();
  });

  test('a pool already on the playoffs, or on another sport, is not', async ({ page }) => {
    await asHost(page, [{ id: 'nfl', name: 'NFL', short: 'NFL', sport: 'nfl', format: 'rounds', ext_id: null }, { id: 'nfl-post-2026', name: 'NFL Playoffs', short: 'NFL', sport: 'nfl', format: 'series', ext_id: null }]);
    await page.goto('./#/');
    await expect(page.getByRole('link', { name: /Questions/i }).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByRole('region', { name: /are open/i })).toHaveCount(0);
  });
});
