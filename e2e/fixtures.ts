// Shared Playwright fixture: never let GA / GTM / DoubleClick hit the live network in e2e
// (CI runs on 127.0.0.1 with __spAnalyticsTest, which would otherwise load real gtag.js).
import { test as base, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';

export function isAnalyticsHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'googletagmanager.com' || h.endsWith('.googletagmanager.com')
    || h === 'google-analytics.com' || h.endsWith('.google-analytics.com')
    || h === 'doubleclick.net' || h.endsWith('.doubleclick.net')
  );
}

/** Block GTM (204) and abort collect / ads pixels. Call once per context. */
export async function blockAnalyticsHosts(context: BrowserContext) {
  await context.route((url) => isAnalyticsHost(url.hostname), async (route) => {
    const host = new URL(route.request().url()).hostname.toLowerCase();
    if (host === 'googletagmanager.com' || host.endsWith('.googletagmanager.com')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.abort();
  });
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await blockAnalyticsHosts(context);
    await use(context);
  },
});

export { expect };
export type { Page } from '@playwright/test';
