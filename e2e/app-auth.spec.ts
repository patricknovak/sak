import { expect, test } from '@playwright/test';

// Optional signed-in smoke. Set E2E_EMAIL + E2E_PASSWORD (a dedicated test account, never a real GM)
// in the GitHub Actions secrets / local env. Without them this file skips cleanly so CI stays green.
const email = process.env.E2E_EMAIL?.trim();
const password = process.env.E2E_PASSWORD?.trim();

test.describe('App signed-in smoke', () => {
  test.skip(!email || !password, 'E2E_EMAIL / E2E_PASSWORD not set');

  test('sign in lands inside a pool or league home', async ({ page }) => {
    await page.goto('./');
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole('button', { name: /sign in|drop the puck/i }).click();
    // either the dock / home, or the "not linked to a team" card — both mean auth worked
    await expect(
      page.getByText(/Tonight|My team|Standings|This login isn’t linked|Start a pool|Your pools/i).first(),
    ).toBeVisible({ timeout: 45_000 });
  });
});
