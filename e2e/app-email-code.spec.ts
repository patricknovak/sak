import { expect, type Page, test } from './fixtures';

// The email code step on the start page (#/new). The code card is drawn inside the start form; when it was a form of
// its own, confirming the code sent the phone back to an empty start page and the pool never opened (24 November 2026).
// Supabase is mocked: the join function asks for the code first, Auth takes 123456, and the second call opens the pool.

function json(data: unknown, status = 200) {
  return { status, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify(data) };
}
const user = { id: 'e2e-code-user', aud: 'authenticated', role: 'authenticated', email: 'e2e-code@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };

async function mock(page: Page, seen: { join: string[]; verify: number }) {
  await page.route('**/quakdkzdafzlhgjvmypg.supabase.co/**', async (route) => {
    const req = route.request(), url = req.url();
    const signedIn = (req.headers()['authorization'] ?? '').includes('e2e-code-access');
    if (url.includes('/auth/v1/verify')) {
      seen.verify += 1;
      const ok = (req.postDataJSON() as { token?: string }).token === '123456';
      return route.fulfill(ok ? json({ access_token: 'e2e-code-access', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user })
        : json({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403));
    }
    if (url.includes('/auth/v1/user')) return route.fulfill(json(user));
    if (url.includes('/auth/v1/')) return route.fulfill(json({}));
    if (url.includes('/functions/v1/join')) {
      // the start and join pages first ask which switches are on (the bot check's key); that ask isn't a door
      if ((route.request().postDataJSON() as { config?: boolean } | null)?.config === true) return route.fulfill(json({ ok: true, turnstile: '', human: false, codes: true }));
      seen.join.push(signedIn ? 'signed-in' : 'anon');
      return route.fulfill(signedIn ? json({ ok: true, pool: { id: 701, slug: 'e2e-code-pool' } }) : json({ verify: true }, 202));
    }
    if (url.includes('/rest/v1/rpc/pool_pack_list') || url.includes('/rest/v1/rpc/pool_event_list')) return route.fulfill(json([]));
    if (url.includes('/rest/v1/rpc/')) return route.fulfill(json(null));
    return route.fulfill(json([]));
  });
}

async function toCodeStep(page: Page) {
  await page.goto('./#/new?type=questions');
  await page.getByRole('button', { name: /Your own questions/i }).click();
  await page.getByLabel(/Name your pool/i).fill('E2E Code Pool');
  await page.getByPlaceholder(/Your name/i).fill('Code Host');
  await page.getByPlaceholder(/you@example.com/i).fill('e2e-code@example.com');
  await page.getByPlaceholder(/A password/i).fill('secret12');
  await page.getByRole('button', { name: /Start my pool/i }).click();
  await expect(page.getByText(/We sent a 6-digit code/i)).toBeVisible();
}

test.describe('the email code step on the start page', () => {
  test('a code pasted with a space opens the pool, with nothing asked twice', async ({ page }) => {
    const seen = { join: [] as string[], verify: 0 };
    await mock(page, seen);
    await toCodeStep(page);
    // the sixth digit confirms by itself; a pasted "123 456" keeps all six
    await page.getByLabel('The 6-digit code').fill('123 456');
    await expect.poll(() => seen.join.join(',')).toBe('anon,signed-in');
    expect(seen.verify).toBe(1);
    // the page was never sent away to a bare start form (a form posted by the browser leaves a "?" in the address)
    expect(new URL(page.url()).search).toBe('');
  });

  test('a wrong code says so and the button confirms the right one', async ({ page }) => {
    const seen = { join: [] as string[], verify: 0 };
    await mock(page, seen);
    await toCodeStep(page);
    await page.getByLabel('The 6-digit code').fill('000000');
    await expect(page.getByText(/That code didn.t work/i)).toBeVisible();
    expect(seen.join).toEqual(['anon']);
    // Enter in the box confirms too, and never asks the start form for the account again
    await page.getByLabel('The 6-digit code').fill('12345');
    await page.getByLabel('The 6-digit code').press('6');
    await expect.poll(() => seen.join.join(',')).toBe('anon,signed-in');
    expect(new URL(page.url()).search).toBe('');
  });
});
