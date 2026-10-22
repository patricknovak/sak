import { expect, type Page, test } from '@playwright/test';

// Proves pool_created hits dataLayer/gtag after Analytics Accept on every create path,
// with pack/sport/kind/src params. Supabase REST + auth + join are mocked; reload is stubbed
// so openPool does not wipe the page before we can read dataLayer.

const USER_ID = 'e2e-pool-created-user';
const PACK = {
  slug: 'e2e-show-pack',
  name: 'E2E Show',
  questions: 12,
  color: '#fb7185',
  icon: '📺',
  blurb: 'Test pack',
  next_close: new Date(Date.now() + 3 * 864e5).toISOString(),
  last_close: new Date(Date.now() + 30 * 864e5).toISOString(),
};

type CreatePath = 'member' | 'new-user' | 'fantasy';

function json(data: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'content-range': Array.isArray(data) ? `0-${Math.max(data.length - 1, 0)}/${data.length}` : '0-0/1' },
    body: JSON.stringify(data),
  };
}

async function stubReloadAndCapture(page: Page) {
  await page.addInitScript(() => {
    // openPool / Reopen call location.reload(); block it so the SPA stays put.
    (window as unknown as { __e2eReloads: number }).__e2eReloads = 0;
    const blockReload = () => {
      (window as unknown as { __e2eReloads: number }).__e2eReloads += 1;
    };
    try {
      Object.defineProperty(Location.prototype, 'reload', { configurable: true, writable: true, value: blockReload });
    } catch { /* ignore */ }
    try {
      Object.defineProperty(window.location, 'reload', { configurable: true, writable: true, value: blockReload });
    } catch { /* some browsers lock Location.reload */ }

    // Survive a real reload: record pool_created in sessionStorage whenever gtag is assigned.
    const logKey = '__e2e_pool_created';
    const record = (params: unknown) => {
      try {
        const prev = JSON.parse(sessionStorage.getItem(logKey) || '[]') as unknown[];
        prev.push(params ?? {});
        sessionStorage.setItem(logKey, JSON.stringify(prev));
      } catch { /* private mode */ }
    };
    let currentGtag: typeof window.gtag;
    Object.defineProperty(window, 'gtag', {
      configurable: true,
      enumerable: true,
      get() { return currentGtag; },
      set(fn: typeof window.gtag) {
        if (typeof fn !== 'function' || (fn as { __e2e?: boolean }).__e2e) {
          currentGtag = fn;
          return;
        }
        const wrapped = function wrappedGtag(this: unknown) {
          const a0 = arguments[0];
          const a1 = arguments[1];
          const a2 = arguments[2] as Record<string, unknown> | undefined;
          if (a0 === 'event' && a1 === 'pool_created') record(a2);
          const ret = (fn as (...a: unknown[]) => unknown).apply(this, arguments as unknown as unknown[]);
          // Mimic gtag.js's early event_callback (must not set the once-key in app code).
          if (a0 === 'event' && a2 && typeof a2.event_callback === 'function') {
            try { (a2.event_callback as () => void)(); } catch { /* ignore */ }
          }
          if (a0 === 'event' && a1 === 'pool_created') {
            try {
              sessionStorage.setItem('__e2e_after_callback', JSON.stringify({
                pending: localStorage.getItem('sp_pool_created_pending'),
                keys: Object.keys(localStorage).filter((k) => k.startsWith('sp_pool_created:')),
              }));
            } catch { /* private mode */ }
          }
          return ret;
        };
        (wrapped as { __e2e?: boolean }).__e2e = true;
        currentGtag = wrapped as typeof window.gtag;
      },
    });
  });
}

// localStorage reads that survive openPool's reload (real or stubbed) mid-evaluate.
async function settleAfterNav(page: Page) {
  try {
    await page.waitForFunction(() => (window as unknown as { __e2eReloads?: number }).__e2eReloads !== undefined, null, {
      timeout: 5_000,
    });
  } catch { /* init script not ready yet */ }
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 });
  } catch { /* already loaded */ }
}

async function storageGet(page: Page, key: string): Promise<string | null> {
  try {
    return await page.evaluate((k) => localStorage.getItem(k), key);
  } catch {
    await settleAfterNav(page);
    try {
      return await page.evaluate((k) => localStorage.getItem(k), key);
    } catch {
      return null;
    }
  }
}

async function storageOnceKey(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sp_pool_created:')) return k;
      }
      return null;
    });
  } catch {
    await settleAfterNav(page);
    try {
      return await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('sp_pool_created:')) return k;
        }
        return null;
      });
    } catch {
      return null;
    }
  }
}

async function plantMemberSession(page: Page) {
  const session = {
    access_token: 'e2e-access',
    refresh_token: 'e2e-refresh',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'e2e-host@example.com',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
  await page.addInitScript((s) => {
    localStorage.setItem('sak-remember', '1');
    localStorage.setItem('sak-auth', JSON.stringify(s));
  }, session);
}

async function mockSupabase(page: Page, path: CreatePath) {
  await page.route('**/googletagmanager.com/**', (route) => route.fulfill({ status: 204, body: '' }));

  await page.route('**/quakdkzdafzlhgjvmypg.supabase.co/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();

    // Auth: session plant + password sign-in for the new-user path.
    if (url.includes('/auth/v1/')) {
      if (url.includes('/token') && method === 'POST') {
        return route.fulfill(json({
          access_token: 'e2e-access',
          refresh_token: 'e2e-refresh',
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: USER_ID, email: 'e2e-new@example.com', role: 'authenticated', aud: 'authenticated' },
        }));
      }
      if (url.includes('/user')) {
        return route.fulfill(json({
          id: USER_ID,
          email: path === 'new-user' ? 'e2e-new@example.com' : 'e2e-host@example.com',
          role: 'authenticated',
          aud: 'authenticated',
        }));
      }
      return route.fulfill(json({}));
    }

    // Edge function: join creates account + pool for someone new.
    if (url.includes('/functions/v1/join')) {
      return route.fulfill(json({
        pool: { id: 501, slug: 'e2e-new-pool' },
        ok: true,
      }));
    }

    // RPCs
    if (url.includes('/rest/v1/rpc/')) {
      const name = url.split('/rest/v1/rpc/')[1]?.split('?')[0] ?? '';
      if (name === 'pool_pack_list') return route.fulfill(json([PACK]));
      if (name === 'pool_event_list') return route.fulfill(json([]));
      if (name === 'pool_start') return route.fulfill(json({ id: 401, slug: 'e2e-member-pool' }));
      if (name === 'fantasy_start') return route.fulfill(json({ id: 601, slug: 'e2e-fantasy-league' }));
      if (name === 'pool_start_games' || name === 'set_active_league' || name === 'league_by_host') {
        return route.fulfill(json(null));
      }
      return route.fulfill(json(null));
    }

    // Tables the store loads once a member session exists.
    if (url.includes('/rest/v1/teams')) {
      return route.fulfill(json([{
        id: 1,
        name: 'E2E Team',
        abbrev: 'E2E',
        gm_name: 'E2E Host',
        login_email: 'e2e-host@example.com',
        user_id: USER_ID,
        color: '#fb7185',
        emoji: '🏒',
        motto: null,
        fav_nhl: null,
        is_commish: true,
        joined_season: null,
        auto_lineup: false,
        autodraft: false,
        keepers_submitted: false,
        last_seen: null,
        auto_mode: 'off',
        auto_basis: 'proj',
        lineup_touched: null,
        role: 'gm',
        perms: {},
        tv: {},
      }]));
    }
    if (url.includes('/rest/v1/league') && !url.includes('leagues')) {
      return route.fulfill(json({
        league_id: 1,
        name: 'E2E League',
        season: '2026',
        phase: 'season',
        format: 'season',
      }));
    }
    if (url.includes('/rest/v1/leagues')) {
      return route.fulfill(json({
        brand: null,
        short_name: 'E2E',
        sport: 'nhl',
        kind: 'predict',
      }));
    }
    if (url.includes('/rest/v1/draft_state')) {
      return route.fulfill(json({
        status: 'idle',
        pick: 0,
        round: 0,
        on_clock: null,
        deadline: null,
      }));
    }
    // Everything else the store selects: empty list is fine.
    if (url.includes('/rest/v1/')) {
      return route.fulfill(json([]));
    }

    return route.fulfill({ status: 204, body: '' });
  });
}

async function acceptAnalyticsOnly(page: Page) {
  const dialog = page.getByRole('dialog', { name: /Analytics and ads/i });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Accept' }).first().click();
  // Ads must stay unset after Analytics Accept alone (#286 split).
  const ads = await page.evaluate(() => localStorage.getItem('sp_ads_consent'));
  expect(ads).toBeNull();
  await dialog.getByRole('button', { name: 'No thanks' }).nth(1).click();
  await expect(dialog).toBeHidden();
  const after = await page.evaluate(() => ({
    a: localStorage.getItem('sp_analytics_consent'),
    d: localStorage.getItem('sp_ads_consent'),
  }));
  expect(after.a).toBe('granted');
  expect(after.d).toBe('denied');
}

async function acceptAnalytics(page: Page) {
  await acceptAnalyticsOnly(page);
}

async function poolCreatedEvents(page: Page) {
  try {
    return await page.evaluate(() => {
      // Prefer the sessionStorage log (survives reload); fall back to live dataLayer.
      try {
        const logged = JSON.parse(sessionStorage.getItem('__e2e_pool_created') || '[]') as Record<string, unknown>[];
        if (logged.length) return logged.map((params) => ({ name: 'pool_created', params }));
      } catch { /* ignore */ }
      const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer || [];
      const out: { name: string; params: Record<string, unknown> }[] = [];
      for (const entry of layer) {
        if (!entry || typeof entry !== 'object') continue;
        const args = entry as { [i: number]: unknown; length: number };
        if (args[0] === 'event' && args[1] === 'pool_created') {
          out.push({ name: 'pool_created', params: (args[2] as Record<string, unknown>) || {} });
        }
      }
      return out;
    });
  } catch {
    // Navigation mid-evaluate: caller polls again.
    return [];
  }
}

async function startQuestionsPoolAsGuest(page: Page) {
  await page.goto('./#/new?src=e2e_guest');
  await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });
  await acceptAnalytics(page);
  await page.getByRole('button', { name: /A questions pool/i }).click();
  await expect(page.getByText(/Which questions/i)).toBeVisible();
  await page.getByRole('button', { name: /E2E Show/i }).click();
  await page.getByLabel(/Name your pool/i).fill('E2E Guest Pool');
  await page.getByPlaceholder(/Your name/i).fill('Guest Host');
  await page.getByPlaceholder(/you@example.com/i).fill('e2e-new@example.com');
  await page.getByPlaceholder(/A password/i).fill('secret12');
  await page.getByRole('button', { name: /Start my pool/i }).click();
}

async function startQuestionsPoolAsMember(page: Page) {
  await page.goto('./#/new?src=e2e_member');
  await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 45_000 });
  await acceptAnalytics(page);
  await page.getByRole('button', { name: /A questions pool/i }).click();
  await expect(page.getByText(/Which questions/i)).toBeVisible();
  await page.getByRole('button', { name: /E2E Show/i }).click();
  await page.getByLabel(/Name your pool/i).fill('E2E Member Pool');
  await expect(page.getByText(/signed in as E2E Host/i)).toBeVisible();
  await page.getByRole('button', { name: /Start my pool/i }).click();
}

async function startFantasyLeague(page: Page) {
  await page.goto('./#/new?type=fantasy&src=e2e_fantasy');
  await expect(page.getByText(/Start a league|What are you starting/i).first()).toBeVisible({ timeout: 45_000 });
  await acceptAnalytics(page);
  // type=fantasy already selects the mode; if the mode picker still shows, click it.
  const fantasyMode = page.getByRole('button', { name: /A fantasy league/i });
  if (await fantasyMode.isVisible().catch(() => false)) await fantasyMode.click();
  await page.getByPlaceholder(/The Beer League/i).fill('E2E Fantasy');
  await page.getByRole('button', { name: /Start my league/i }).click();
}

test.describe('pool_created after Accept (mocked create paths)', () => {
  test('new-user sign-up + create pushes pool_created with params', async ({ page }) => {
    await stubReloadAndCapture(page);
    await mockSupabase(page, 'new-user');
    await startQuestionsPoolAsGuest(page);

    let ev: { name: string; params: Record<string, unknown> } | undefined;
    await expect.poll(async () => {
      const events = await poolCreatedEvents(page);
      ev = events[0];
      return events.length;
    }, { timeout: 15_000 }).toBe(1);
    expect(ev?.params.pack).toBe('e2e-show-pack');
    expect(ev?.params.kind).toBe('questions');
    expect(ev?.params.src).toBe('e2e_guest');
    expect(ev?.params.transport_type).toBe('beacon');
  });

  test('signed-in pool_start pushes pool_created with params', async ({ page }) => {
    await stubReloadAndCapture(page);
    await plantMemberSession(page);
    await mockSupabase(page, 'member');
    await startQuestionsPoolAsMember(page);

    let ev: { name: string; params: Record<string, unknown> } | undefined;
    await expect.poll(async () => {
      const events = await poolCreatedEvents(page);
      ev = events[0];
      return events.length;
    }, { timeout: 15_000 }).toBe(1);
    expect(ev?.params.pack).toBe('e2e-show-pack');
    expect(ev?.params.kind).toBe('questions');
    expect(ev?.params.src).toBe('e2e_member');
    expect(ev?.params.transport_type).toBe('beacon');
  });

  test('fantasy_start pushes pool_created with params', async ({ page }) => {
    await stubReloadAndCapture(page);
    await plantMemberSession(page);
    await mockSupabase(page, 'fantasy');
    await startFantasyLeague(page);

    let ev: { name: string; params: Record<string, unknown> } | undefined;
    await expect.poll(async () => {
      const events = await poolCreatedEvents(page);
      ev = events[0];
      return events.length;
    }, { timeout: 15_000 }).toBe(1);
    expect(ev?.params.kind).toBe('fantasy');
    expect(ev?.params.sport).toBe('nhl');
    expect(ev?.params.src).toBe('e2e_fantasy');
    expect(ev?.params.transport_type).toBe('beacon');
  });

  test('create before Accept: pending flushes on Analytics Accept', async ({ page }) => {
    await stubReloadAndCapture(page);
    await mockSupabase(page, 'new-user');
    await page.goto('./#/new?src=e2e_pending');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });

    // Create while the banner is still up (consent not granted).
    await page.getByRole('button', { name: /A questions pool/i }).click();
    await page.getByRole('button', { name: /E2E Show/i }).click();
    await page.getByLabel(/Name your pool/i).fill('E2E Pending Pool');
    await page.getByPlaceholder(/Your name/i).fill('Pending Host');
    await page.getByPlaceholder(/you@example.com/i).fill('e2e-pending@example.com');
    await page.getByPlaceholder(/A password/i).fill('secret12');
    await page.getByRole('button', { name: /Start my pool/i }).click();

    // openPool may reload (stubbed or real): wait for the page, then read storage safely.
    await settleAfterNav(page);
    await expect.poll(async () => storageGet(page, 'sp_pool_created_pending'), {
      timeout: 15_000,
    }).toBeTruthy();
    expect(await storageOnceKey(page)).toBeNull();
    expect(await poolCreatedEvents(page)).toHaveLength(0);

    await acceptAnalytics(page);
    await settleAfterNav(page);

    let ev: { name: string; params: Record<string, unknown> } | undefined;
    await expect.poll(async () => {
      const events = await poolCreatedEvents(page);
      ev = events[0];
      return events.length;
    }, { timeout: 10_000 }).toBe(1);
    expect(ev?.params.pack).toBe('e2e-show-pack');
    expect(ev?.params.src).toBe('e2e_pending');
    // Event is in dataLayer immediately; once-key / pending clear only after the flush window.
    await expect.poll(async () => storageGet(page, 'sp_pool_created:501'), {
      timeout: 5_000,
    }).toBe('1');
    expect(await storageGet(page, 'sp_pool_created_pending')).toBeNull();
  });

  test('Analytics Accept alone does not grant Ads consent', async ({ page }) => {
    await stubReloadAndCapture(page);
    await mockSupabase(page, 'new-user');
    await page.goto('./#/new');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: /Analytics and ads/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Accept' }).first().click();
    const keys = await page.evaluate(() => ({
      a: localStorage.getItem('sp_analytics_consent'),
      d: localStorage.getItem('sp_ads_consent'),
    }));
    expect(keys.a).toBe('granted');
    expect(keys.d).toBeNull();
    // Banner stays open until Ads is chosen.
    await expect(dialog).toBeVisible();
  });

  // Pack path: pending first, once-key only after the flush window (not on early event_callback).
  // Does not claim a /g/collect network hit — GTM is stubbed here, and a stub-fired collect would be circular.
  test('pack-pool path: pending first; once-key only after send window', async ({ page }) => {
    await stubReloadAndCapture(page);
    await plantMemberSession(page);
    await mockSupabase(page, 'member');
    await startQuestionsPoolAsMember(page);
    await settleAfterNav(page);

    let ev: { name: string; params: Record<string, unknown> } | undefined;
    await expect.poll(async () => {
      const events = await poolCreatedEvents(page);
      ev = events[0];
      return events.length;
    }, { timeout: 15_000 }).toBe(1);
    expect(ev?.params.pack).toBe('e2e-show-pack');
    expect(ev?.params.kind).toBe('questions');
    expect(ev?.params.transport_type).toBe('beacon');

    // Snapshot taken immediately after the early event_callback: pending yes, once-key no.
    let afterCb: { pending: string | null; keys: string[] } | null = null;
    await expect.poll(async () => {
      try {
        afterCb = await page.evaluate(() => {
          try { return JSON.parse(sessionStorage.getItem('__e2e_after_callback') || 'null'); }
          catch { return null; }
        });
      } catch {
        afterCb = null;
      }
      return afterCb;
    }, { timeout: 5_000 }).toBeTruthy();
    expect(afterCb?.pending).toBeTruthy();
    expect(afterCb?.keys ?? ['x']).toEqual([]);

    await expect.poll(async () => storageGet(page, 'sp_pool_created:401'), {
      timeout: 5_000,
    }).toBe('1');
    expect(await storageGet(page, 'sp_pool_created_pending')).toBeNull();
  });
});
