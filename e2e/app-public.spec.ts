import { expect, test } from './fixtures';

test.describe('App public journeys', () => {
  test('sign-in page shows email/password and product mark', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in|drop the puck/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /start one free/i })).toBeVisible();
  });

  test('bad credentials show a friendly error (no crash)', async ({ page }) => {
    await page.goto('./');
    await page.getByLabel(/email/i).fill('e2e-nobody@example.com');
    await page.getByLabel(/password/i).fill('definitely-wrong-password-123');
    await page.getByRole('button', { name: /sign in|drop the puck/i }).click();
    await expect(page.getByText(/don’t match|Invalid|rate limit|Too many/i)).toBeVisible({ timeout: 20_000 });
  });

  test('privacy page is open without signing in', async ({ page }) => {
    await page.goto('./#/privacy');
    await expect(page.getByRole('heading', { name: /privacy/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/never money/i).first()).toBeVisible();
    await expect(page.getByText(/Supabase/i).first()).toBeVisible();
  });

  test('start-a-pool flow: pick sports, see live events', async ({ page }) => {
    await page.goto('./#/new');
    await expect(page.getByText(/What are you starting/i)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /A sports pool/i }).click();
    await expect(page.getByText(/What are you following/i)).toBeVisible();
    // events come from pool_event_list; wait for either a Live now chip or the empty copy
    await expect(page.getByText(/Live now|No league is open/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('start page (ask for a fantasy league) loads', async ({ page }) => {
    await page.goto('./#/start');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('form, input[type="email"]').first()).toBeVisible();
  });

  test('forgot-password mode is reachable', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: /Forgot your password/i }).click();
    await expect(page.getByText(/Send|code|email/i).first()).toBeVisible();
  });
});
