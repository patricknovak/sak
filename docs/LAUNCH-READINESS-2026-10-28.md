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

### What is left, 24 November 2026

Read again on 24 November against the live project (148 MB, 12 accounts, the newest from 23 October, 19 of 60
connections in use, no scheduled job failed in three days, the security advisor showing only the known notices) and
against the code. Everything that could be finished without Patrick is; each line below is the smallest step left.
The Platform page's **Launch switches** card (`#/platform`) shows whether the bot check and the email code are on, so
neither needs a test account to check.

| # | What | Where | The step | Time |
|---|---|---|---|---|
| A | Bot check on every open door, the waitlist included (item 8) | Cloudflare → Turnstile, then Supabase → Edge Functions → Secrets | Add a widget for `superpoolsai.com` (Managed). Paste its two keys as secrets: `TURNSTILE_SITE_KEY` first, then `TURNSTILE_SECRET`. No build, no pull request. The Platform page then reads On | 5 min |
| B | ~~The waitlist closed to the public key~~ | Supabase → SQL editor | *Done 24 November 2026 on Patrick's go:* migration 369 is live (the public key can no longer write the table; the join function can). One leftover, harmless line the connector would not run: `drop policy if exists waitlist_signup on public.waitlist;` | 1 min |
| C | Email confirmed by a code (item 4) | Supabase → Authentication → Email Templates, then Secrets | Confirm signup and Magic Link show `{{ .Token }}` ("Your Super Pools code"); then `EMAIL_CODES` = `on`. The Platform page reads On | 5 min |
| D | Auth settings (item 1) | Supabase → Authentication → URL Configuration | Site URL and the three redirect URLs below; the reset email's wording | 5 min |
| E | Password of 8 at Auth (item 14) | Supabase → Authentication → Providers → Email | Minimum password length 8. Every form, the join function and the commissioner's SQL already ask for 8 (migration 356 is live), so this is safe today | 1 min |
| F | Database SSL enforcement (item 14) | Supabase → Settings → Database | Switch "Enforce SSL" on. The site and the functions use the HTTPS API and are untouched | 1 min |
| G | Compute to Small, Auth's connections to a percentage (item 6) | Supabase → Settings → Compute and Disk | Before the first push for outside users; a restart of about two minutes, best on a morning with no games on. About $15 a month in place of $10 when last checked; the page shows today's price | 5 min |
| H | Point-in-time recovery (item 7) | Supabase → Settings → Add-ons | Seven days. About $100 a month when last checked, so it can wait until strangers' pools hold weeks of calls; the daily backup stands until then | 2 min |
| I | Uptime alarm (item 9) | uptimerobot.com | A free account and the three five-minute keyword monitors listed in item 9 | 10 min |
| J | Mission Control's passcode (item 11) | Supabase → SQL editor | Run `launch/mission-control-passcode.sql` from the project files (not run as of 10 November) | 2 min |
| K | A sign-up on live with a fresh email | `app.superpoolsai.com/#/new` | Start one pool as a stranger would, after C, to see the code arrive | 5 min |
| L | Stripe account and a test key | stripe.com | Only the account, in Planetterrian Ventures' name. Billing itself is not built and waits on the decision in the 24 November review (25 outside pools first) | 20 min |
| M | DMARC to quarantine (item 10) | Cloudflare → DNS | Once the reports show only Resend and Cloudflare | 5 min |

Also waiting on a word in the chat, each written, tested and not live: migrations 362 (the Traitors pack), 364 and 366
(the bug hunt), 365 (bet math) and 368 (realtime rules, step one).

### Before launch (blocking)

1. **Auth settings** (Supabase → Authentication; the session wasn't allowed to change them):
   - URL Configuration → Site URL: `https://app.superpoolsai.com` (today `https://patricknovak.github.io/sak/`).
   - Redirect URLs: `https://app.superpoolsai.com/**`, `https://*.superpoolsai.com/**`, `https://patricknovak.github.io/sak/**`
     (until the GitHub Pages copy retires).
   - Email Templates → Reset password: the body says "Your code for the SAK Superleague"; make it "Your Super Pools code".
2. ~~Read the terms~~ *Done 9 November 2026:* read; 13 (14 in Quebec) stands, and the terms and the privacy note name the
   operator, Planetterrian Ventures and Patrick Novak, British Columbia, under its law, at 963 8th Ave W, Vancouver, BC V5Z 1E4 (10 November 2026, on every landing footer and under the
   waitlist form too). A lawyer's read is still Patrick's call.
3. ~~Check hello@superpoolsai.com reaches you~~ *Done 9 November 2026 (Patrick: it does).*
4. ~~Decide whether a new email is confirmed by a code~~ *Patrick's yes, 9 November 2026 (docs/DEVELOPMENT.md §9.37):*
   built and off until two steps of his: the Auth email templates Confirm signup and Magic Link show `{{ .Token }}`
   ("Your Super Pools code"), then the `EMAIL_CODES` function secret is set to `on`. Migration 355 (`_signup_pending`)
   lets the same address try again before its code is used.
5. ~~Archive the test pools and the shadow league~~ *Done (migrations 340 and 341, on Patrick's "Apply migrations and
   continue"):* `sak-shadow` and the QA and TEST pools (leagues 9 to 13) are archived with their data kept, and the
   shadow's every-minute sync is unscheduled.

### Before a marketing push

6. **Database size.** Micro compute: 37 of 60 connections in use on a quiet night, most of the load is Realtime. Move to
   Small (Settings → Compute) before sending traffic; switch Auth's connection strategy to a percentage at the same time.
7. **Point-in-time recovery** (Settings → Add-ons): today a bad night loses up to a day. Worth it once strangers' pools
   hold weeks of calls.
8. **Bot check on the open doors** (name-only joins, fan joins, the Start your league form, the waitlist): a Cloudflare
   Turnstile site key (free) for `app.superpoolsai.com` and `superpoolsai.com`. *Wired 4 November 2026 (§9.28), off until
   the keys exist:* put the site key in `.env.production` as `VITE_TURNSTILE_SITE_KEY` and let the site deploy, then set
   `TURNSTILE_SECRET` in Supabase's function secrets. In that order: the secret first would refuse every new account
   from the old site. *24 November 2026 (§9.49):* the public key can live beside the secret instead (`TURNSTILE_SITE_KEY`
   in the function secrets, which the site and the landing ask the join function for), so no build is needed: line A
   above. The landing's waitlist goes through the join function's door behind the same check, and migration 369 takes
   the public key's insert on the table away (line B).
9. ~~Uptime alerts~~ *Done 9 November 2026:* `.github/workflows/uptime.yml` checks the app, the marketing site and the
   sports data every ten minutes from GitHub's runners and opens an issue assigned to Patrick when one fails twice in a
   row (closed again when all answer). *Found 24 November 2026:* GitHub ran that schedule only three or four times a day
   (gaps of up to eight hours), so an outage could go unseen most of a day. **Patrick:** make a free UptimeRobot
   account and add three HTTP(s) keyword monitors at five minutes, alerting by email and the app: `https://app.superpoolsai.com/`
   (keyword `<div id="root"`), `https://superpoolsai.com/` (keyword `Super Pools`) and
   `https://app.superpoolsai.com/api/hub?task=standings` (keyword `{`). The GitHub check stays as a slow second opinion.
10. **Email reputation.** DMARC is `p=none`; once its reports show only Resend and Cloudflare, move it to
    `p=quarantine`. A CAA record (letsencrypt.org, pki.goog) is a nice extra.
11. **Mission Control's passcode**: make it long and random. *9 November 2026:* a 28-character one was generated and handed to Patrick with the SQL that sets its hash (the connector holds a `truncate`).

### Housekeeping

12. ~~Costs page fixed bills~~ *Done (migration 340):* Vercel ends 4 October; Cloudflare Workers Paid ($5 a month from
    11 October) is on the list.
13. **Retire the GitHub Pages copy** once a SaK GM confirms push alerts and the installed app on `sak.superpoolsai.com`
    (EXPANSION B5 step 3).
14. **Database SSL enforcement** (Settings → Database) and a minimum password length of 8 (Auth → Providers → Email).
    *4 November 2026:* every form that sets a new password and the join function ask for 8 (§9.29); Auth's own minimum
    goes to 8 once that is deployed, never before, or a 6- or 7-character password would pass the form and fail at Auth.
    Passwords already set keep working. The commissioner's reset and spectator functions ask for 8 too since migration
    356 (live 10 November), so Auth's minimum can go to 8 now.
15. **`rosters_2526_backup`**: drop it once you're sure (destroys the copy; your yes).
16. **The repository is public** (MIT since 25 October): the plan documents in `docs/` are public with it. No secrets are
    in it (checked); if the plans should be private, move `docs/` to a private repository.

## 4. Left for later (not blocking)

Billing and tiers (Stripe), the app-store listing, deleting an account from inside the app (needed for an app store;
today it is a request to hello@, as the privacy note says), naming every script and picture source in the
Content-Security-Policy (its first part, no framing, no plugins, no foreign `<base>`, is on every page since 24 November
2026), room sign-in at the socket upgrade, and the unindexed foreign keys (index only where scans show it). A
per-account cap on new pools is already there: five a day and 25 in all (`_pool_open`).
