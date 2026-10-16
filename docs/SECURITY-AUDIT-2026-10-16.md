# Security & performance pass (16 October 2026)

What this pass fixed in the repo, and what is left ranked. No production database writes, deploys, or Auth
dashboard changes were made from the agent session.

## Fixed in this PR

| Item | Change |
|---|---|
| npm audit | `source-map-js` 1.2.2 and `fflate` 0.7.5 (dev/transitive); 0 vulnerabilities after |
| Safe dependency bumps | `@supabase/supabase-js` 2.118.0, `react`/`react-dom` 19.3.1, `vite` 8.3.4, `@vitejs/plugin-react` 6.1.2, `lucide-react` 1.58.0, `@cloudflare/workers-types` dated |
| Security headers (app) | `public/_headers` + `worker/headers.ts` on every Worker response (skip WebSocket upgrades) |
| Security headers (landing) | `landing/_headers` |
| Mutable `search_path` | Migration **308** (file only): `_ats_side`, `_pick_res`, `_mc_test_email` |

## Left ranked (do not auto-apply)

1. **Auth: leaked-password protection** — dashboard only ([Auth → Attack Protection](https://supabase.com/dashboard/project/quakdkzdafzlhgjvmypg/auth/attack-protection)). Enable HaveIBeenPwned checks.
2. **Auth DB connections** — switch Auth connection strategy from absolute (10) to percentage ([Going into prod](https://supabase.com/docs/guides/deployment/going-into-prod)).
3. **`pg_net` in `public`** — Supabase-managed; moving it is not a normal migration.
4. **RLS enabled, no policies** (info): `health_alerts`, `hub_cache`, `push_subscriptions`, and three others — intentional service-role / no-anon tables; confirm none are selectable via the Data API, or add deny-all policies.
5. **~198 authenticated SECURITY DEFINER RPCs** — most are the product surface; underscore helpers should stay revoked (308 revokes the three above). A later pass can diff advisor vs `revoke` inventory.
6. **Anon SECURITY DEFINER doors** — intentional signed-out RPCs (`invite_preview`, `league_by_host`, `pool_event_list`, …); covered by `supabase/tests/security.sql`.
7. **Unindexed FKs (~95)** — mostly low-traffic; index only after `pg_stat_user_tables` shows sequential scans on those joins. Do not blanket-index.
8. **Unused indexes (11)** — leave until a quiet window; drop only with Patrick's yes if they hold production data patterns.
9. **`rosters_2526_backup` no PK** — drop once the season is safely under way (Patrick's yes; destroys data).
10. **Strict CSP** — not shipped: the app needs Google Fonts, Supabase, GA4 after consent, and inline boot scripts. Next step: Report-Only CSP on the landing Worker, then tighten.
11. **Self-host Inter/Barlow** — Core Web Vitals win (drop `fonts.googleapis.com` round trip); larger follow-up than this PR.
12. **satori major (0.15 → 0.62)** — major; Worker OG path is pinned for WASM reasons; leave alone.

## Secrets check

- Client and Worker ship only the Supabase **anon** key (designed public; RLS protects data).
- No `service_role` in `src/`, `worker/`, or `landing/`.
- Platform admin key stays in `private.app_keys` / `x-admin-key`, never the site.
