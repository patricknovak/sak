# Launch readiness (28 October 2026)

Patrick: "Do a thorough review of what should still be done before going live and do as much as possible of it without
stopping until done and then tell me all the items that I need to do."

The review covered the live project (advisors, logs, scheduled jobs, the migration ledger, Auth settings, backups,
email DNS, costs, capacity), the code a stranger can reach (an independent security read of every anonymous door, the
join function, the Worker, nhl-hub, the fan voice, chat photos and secrets), the public pages in a browser at phone
widths, and the plan documents' open items. `docs/SECURITY-AUDIT-2026-10-16.md` is the earlier pass; this one supersedes
its ranked list where they overlap.

## 1. Where it stands

- **Healthy.** No scheduled job failed in three days; every repo migration is recorded live; CI is green on `main`;
  `npm audit` is clean for production dependencies; edge functions answered ~2,700 requests in a day with one error (an
  ESPN connection reset, fixed below) and a scanner probing for LLM endpoints (refused, 401). Postgres logs clean.
- **Small.** 138 MB of data, 12 accounts (4 test, 1 guest), 9 active prediction pools (5 of them tests), SaK and its
  shadow. Paid calls cost about $0.50 a week (Grok for the voice; the X feed is off since 23 October).
- **Backups.** Daily physical backups (seven kept on Pro); point-in-time recovery is off.

## 2. Fixed in this pass (live or in the pull request)

| Item | What changed |
|---|---|
| No terms of use | `#/terms` (`src/pages/Terms.tsx`): who can play (13+), coins are never money, hosts and calls, what you post, the voice, no affiliation with leagues or shows, the service as is, changes and leaving. Linked beside Privacy everywhere (sign-in, Profile, the fan zones' frame, every landing footer) and one line at each place an account is made |
| Privacy note behind the code | Lounges (seen by other pools under a first name and initial), name-only guest seats, chat photos, every league's fan zones, the voice's provider named (Grok, xAI), data in the United States |
| Account squatting after a reset | A new password signs the account out everywhere else (`Login.tsx`, `Profile.tsx`) |
| Name-only join limits | IPv6 counted by its /64, a join with no address refused (`join`); confirmed that Cloudflare's `cf-connecting-ip` reaches the function on every request, so the address can't be forged |
| Throwaway accounts taking posts down | Migration 339: only reports from established accounts (a real email, or three days old) count toward a take-down; every report still reaches the editors |
| Chat photo read across leagues | Migration 339: a photo opens only from a message in its own league's folder |
| Forced picture renders | The Worker's link pictures are cached by path (and post) only, an hour; a made-up `?v=` can't force a fresh render. The fan pages' season simulations are kept five minutes per answer |
| Image proxy | `/api/img` follows no redirects, refuses anything over 2 MB, and serves pictures with a sandboxing CSP and nosniff |
| nhl-hub amplification | The memory cache is keyed on the parameters each task reads; one rebuild at a time per `hub_cache` key |
| Live rooms | At most 25 sockets waiting to say hello; a renewed token claiming more than two hours is refused |
| Game-day run failing on ESPN | The injury refresh failing no longer fails the probable goalies and scratches |
| "Add SAK to your Home Screen" | The iPhone push hint names the product |
| Share pictures out of date | The landing's `og.png` said "private beta" and "side bets"; it now names what Super Pools is, and every landing card draws the mark's ticks (a gradient on a straight line drew nothing) |
| Page and preview disagreeing | A fan zone's link preview runs the same 3,000 seasons as the page, so both say the same chances |
| "1 fan has their say" | A link's text counts the fans only from ten up; the pictures and the pulse still count every one |
| Start your league without a privacy line | The form says what the name and email are for, with Privacy and Terms |
| A blank page when code fails to load | The app reloads once (a new deploy or a dropped connection) instead of showing nothing |
| Footer "NHL fan zones" | "Fan zones": they cover four leagues |
| No robots.txt or sitemap on the app | The Worker serves both: the fan zones (every club, every page, every league) for search engines, pools, invites and the API kept out; every superpoolsai.com address points at the app's |

## 3. For Patrick

### Before launch (blocking)

1. **Auth settings** (Supabase → Authentication; the session wasn't allowed to change them):
   - URL Configuration → Site URL: `https://app.superpoolsai.com` (today `https://patricknovak.github.io/sak/`).
   - Redirect URLs: `https://app.superpoolsai.com/**`, `https://*.superpoolsai.com/**`, `https://patricknovak.github.io/sak/**`
     (until the GitHub Pages copy retires).
   - Email Templates → Reset password: the body says "Your code for the SAK Superleague"; make it "Your Super Pools code".
2. **Read the terms** (`#/terms` in the pull request) and settle what only you can: the minimum age (13 as written), the
   legal name behind Super Pools and the governing law, and whether a lawyer reads it before strangers arrive.
3. **Check hello@superpoolsai.com reaches you.** The privacy note and the terms promise deletion and answers there; mail
   for superpoolsai.com goes through Cloudflare Email Routing. Send it a test from an outside address.
4. **Decide whether a new email is confirmed by a code** before its account is made (starting a pool, joining from an
   invite). Today an address is taken at its word, which keeps the door one step shorter; a 6-digit code makes the address
   provably the person's. The trade-off and the recommendation are in the session's report; recommended before any paid
   marketing.
5. **Archive the test pools and the shadow league** (status to archived, no data deleted): `sak-shadow` (league 2; the
   gate passed 11 October, it syncs every minute and its voice still posts), and the QA and TEST pools (leagues 9 to 13).
   Together they are a fifth of the voice's bill and show in the platform's counts. Say yes and it is one statement.

### Before a marketing push

6. **Database size.** Micro compute: 37 of 60 connections in use on a quiet night, most of the load is Realtime. Move to
   Small (Settings → Compute) before sending traffic; switch Auth's connection strategy to a percentage at the same time.
7. **Point-in-time recovery** (Settings → Add-ons): today a bad night loses up to a day. Worth it once strangers' pools
   hold weeks of calls.
8. **Bot check on the open doors** (name-only joins, fan joins, the Start your league form, the waitlist): a Cloudflare
   Turnstile site key (free) for `app.superpoolsai.com` and `superpoolsai.com`, and the wiring is a small change.
9. **Uptime alerts** from outside: a Cloudflare health check or UptimeRobot on `app.superpoolsai.com`,
   `superpoolsai.com` and nhl-hub, alerting your phone. The health check inside only bells you in the app.
10. **Email reputation.** DMARC is `p=none`; once its reports show only Resend and Cloudflare, move it to
    `p=quarantine`. A CAA record (letsencrypt.org, pki.goog) is a nice extra.
11. **Mission Control's passcode**: make it long and random.

### Housekeeping

12. **Costs page fixed bills**: Vercel's $5 a month still counts (the landing left Vercel on 4 October); Cloudflare
    Workers Paid ($5 a month since 11 October) is missing.
13. **Retire the GitHub Pages copy** once a SaK GM confirms push alerts and the installed app on `sak.superpoolsai.com`
    (EXPANSION B5 step 3).
14. **Database SSL enforcement** (Settings → Database) and a minimum password length of 8 (Auth → Providers → Email):
    both optional, both safe.
15. **`rosters_2526_backup`**: drop it once you're sure (destroys the copy; your yes).
16. **The repository is public** (MIT since 25 October): the plan documents in `docs/` are public with it. No secrets are
    in it (checked); if the plans should be private, move `docs/` to a private repository.

## 4. Left for later (not blocking)

Billing and tiers (Stripe), the app-store listing, deleting an account from inside the app (needed for an app store),
a Content-Security-Policy on the app, a per-account cap on new pools, room sign-in at the socket upgrade, and the
unindexed foreign keys (index only where scans show it).
