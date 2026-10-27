import { expect, type Page, test } from './fixtures';

// Hash-query change on the same /new route must re-select the template without a full reload
// (NHL #/new?comp=… then a Love Is Blind pack link must not keep the NHL setup).

const NHL = {
  competition: 'nhl-2026-27',
  name: 'NHL 2026-27',
  sport: 'nhl',
  kinds: ['players', 'pickem', 'streak'],
  pack: null as string | null,
  open_label: 'Oct',
  final_label: 'Jun',
  club_word: 'club',
  word: 'week',
  sheets: [] as unknown[],
};

const PACK = {
  slug: 'love-is-blind-s11',
  name: 'Love Is Blind · Season 11',
  questions: 12,
  color: '#fb7185',
  icon: '📺',
  blurb: 'Pods',
  next_close: new Date(Date.now() + 3 * 864e5).toISOString(),
  last_close: new Date(Date.now() + 30 * 864e5).toISOString(),
};

function json(data: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'content-range': Array.isArray(data) ? `0-${Math.max(data.length - 1, 0)}/${data.length}` : '0-0/1' },
    body: JSON.stringify(data),
  };
}

async function mockNewPoolApis(page: Page) {
  await page.route('**/*googletagmanager.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/quakdkzdafzlhgjvmypg.supabase.co/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/')) return route.fulfill(json({}));
    if (url.includes('/rest/v1/rpc/pool_pack_list')) return route.fulfill(json([PACK]));
    if (url.includes('/rest/v1/rpc/pool_event_list')) return route.fulfill(json([NHL]));
    if (url.includes('/rest/v1/rpc/')) return route.fulfill(json(null));
    if (url.includes('/rest/v1/')) return route.fulfill(json([]));
    return route.fulfill({ status: 204, body: '' });
  });
}

test.describe('NewPool hash query re-selects template', () => {
  test('navigating #/new?comp=nhl… then a pack link shows the pack, not NHL', async ({ page }) => {
    await mockNewPoolApis(page);
    await page.goto('./#/new?comp=nhl-2026-27&kind=players&src=e2e_nhl');
    await expect(page.getByText(/NHL 2026-27/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/What are you starting/i)).toBeHidden();

    // Same SPA document: only the hash query changes (reproduces the stuck-template bug).
    await page.evaluate(() => { window.location.hash = '#/new?pack=love-is-blind-s11&src=e2e_lib'; });

    await expect(page.getByText(/Love Is Blind/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/NHL 2026-27/i)).toHaveCount(0);
    await expect(page.getByLabel(/Name your pool/i)).toBeVisible();
    await expect.poll(async () => page.getByLabel(/Name your pool/i).inputValue()).toMatch(/Pod Squad|Group Chat|Love/i);
  });

  test('bare #/new then sports is not wiped when lists finish loading', async ({ page }) => {
    let releaseEvents: (() => void) | undefined;
    const eventsReady = new Promise<void>((r) => { releaseEvents = r; });
    await page.route('**/*googletagmanager.com/**', (route) => route.fulfill({ status: 204, body: '' }));
    await page.route('**/quakdkzdafzlhgjvmypg.supabase.co/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/v1/')) return route.fulfill(json({}));
      if (url.includes('/rest/v1/rpc/pool_pack_list')) return route.fulfill(json([PACK]));
      if (url.includes('/rest/v1/rpc/pool_event_list')) {
        await eventsReady;
        return route.fulfill(json([NHL]));
      }
      if (url.includes('/rest/v1/rpc/')) return route.fulfill(json(null));
      if (url.includes('/rest/v1/')) return route.fulfill(json([]));
      return route.fulfill({ status: 204, body: '' });
    });
    await page.goto('./#/new');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /A sports pool/i }).click();
    await expect(page.getByText(/What are you following/i)).toBeVisible();
    releaseEvents?.();
    await expect(page.getByText(/Live now|NHL 2026-27/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/What are you starting/i)).toHaveCount(0);
  });

  test('same template keeps a typed pool name; host email is kept across template switch', async ({ page }) => {
    await mockNewPoolApis(page);
    await page.goto('./#/new?pack=love-is-blind-s11&src=e2e_keep');
    await expect(page.getByLabel(/Name your pool/i)).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(/Name your pool/i).fill('My Typed Pool');
    await page.getByPlaceholder(/Your name/i).fill('Alex');
    await page.getByPlaceholder(/you@example.com/i).fill('alex@example.com');

    // Identical template query (src only): must not wipe the typed pool name.
    await page.evaluate(() => { window.location.hash = '#/new?pack=love-is-blind-s11&src=e2e_keep2'; });
    await expect.poll(async () => page.getByLabel(/Name your pool/i).inputValue()).toBe('My Typed Pool');
    await expect(page.getByPlaceholder(/you@example.com/i)).toHaveValue('alex@example.com');

    // Different template: default pool name refreshes; host fields stay.
    await page.evaluate(() => { window.location.hash = '#/new?comp=nhl-2026-27&kind=players&src=e2e_nhl2'; });
    await expect(page.getByText(/NHL 2026-27/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByPlaceholder(/you@example.com/i)).toHaveValue('alex@example.com');
    await expect(page.getByPlaceholder(/Your name/i)).toHaveValue('Alex');
  });
});
