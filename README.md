# SaK League 🏒

**She's A Keeper** (est. 2013): the league's own home for the draft, daily lineups, live scoring,
trash talk, side bets, trades, rule votes and 13 seasons of history. Built mobile-first; installs to
your home screen like an app.

## What's in it

| | |
|---|---|
| **Keepers** | Pick up to 6 from your 2025-26 roster. Last season's top scorer on each team is blocked automatically and returns to the draft. |
| **Live draft room** | Snake draft with a server-enforced 90-second clock, autopick (queue first, then best projected at a needed position), commissioner pause/undo/pick-for-team, traded picks, pick announcements, and draft chat side by side. Phones get a tabbed layout; desktops get board + players + chat at once. |
| **Daily lineups** | C C LW LW RW RW D D D Util G G + 12 BN + 2 IR. Tap a player, tap where he goes. Players lock at puck drop. "Auto-set today" and an optional every-morning auto-lineup. |
| **Live scoring** | NHL box scores every minute during games → SaK points (G 1.5, A 1, +/- 0.5, PIM −0.2, PPP 0.5, GWG 1, SOG 0.2, HIT 0.1, BLK 0.2; GS 1, W 3, L −1, GA −0.5, SV 0.05, SO 2). Lineups are frozen per game at puck drop, so only starters score. |
| **Trash Talk** | League chat, draft chat and private DMs with reactions, replies, @mentions (with notifications) and one-tap chirps. Adds, drops, trades, bets and fines are announced automatically. |
| **Side bets** | Challenge a GM (or post an open challenge) for cash and/or stakes. Head-to-head fantasy-point bets track live. Both sides confirm the result; the commish can rule. Running tab of who owes whom. |
| **Trades** | Players and draft picks, counter-offers, commissioner review (auto-approves after 24 h), trade deadline. |
| **Free agents** | 10 free pickups; extra pickups cost $30 and hit the ledger automatically. |
| **League** | Every season since 2013-14, all-time points, titles, Peters, career winnings, rules, scoring, the prize pool and SaK Fund, fines ledger, and rule proposals with co-sponsors and voting. |
| **Commissioner** | Announcements, finalize keepers, draft order (manual or lottery), start/pause/undo/reset (for mock drafts), roster moves, fines, password resets, league settings. |

## How it's built

- **Site**: React + Vite + Tailwind, a static single-page app deployed to GitHub Pages by
  `.github/workflows/deploy.yml` on every push.
- **Database / realtime / auth**: Supabase (Postgres). All league rules live in the database as
  functions (`supabase/migrations/*_functions.sql`), so nobody can cheat by poking the API. Row-level
  security keeps DMs and notifications private.
- **NHL data**: the `nhl-sync` edge function (`supabase/functions/nhl-sync`) pulls schedules, box
  scores and rosters from the public NHL API on a `pg_cron` schedule.
- **Player rankings**: `scripts/build-players.mjs` computes every player's 2025-26 SaK points and a
  projection. `data/yahoo-rosters-2025-26.json` holds the end-of-season Yahoo rosters the keepers come from.
- **History**: `src/data/history.ts`, transcribed from the league spreadsheet. Edit and push to update.

## Going live (one-time)

1. **Settings → General → Danger Zone → Change visibility → Public** (free GitHub Pages needs a public repo).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions → Deploy site → Run workflow** (on `main`). The site appears at
   `https://patricknovak.github.io/sak/`.

No passwords or secret keys live in this repo. The Supabase key in `.env` is the public "anon" key;
row-level security and the database functions decide what each GM can see and do.

## Signing in

Each GM taps their team on the sign-in screen and enters their password. The commissioner hands out
starting passwords privately; GMs change theirs under **More → My Profile**, and the commissioner can
reset anyone's under **More → Commissioner**.

## Running locally

```bash
npm install
npm run dev                 # uses the Supabase project in .env
npm run test:nhl            # checks box-score → stat-line parsing against a real NHL game
PGHOST=/tmp PGPORT=5433 PGUSER=postgres npm run test:db   # full rules test on a local Postgres
```

## Season to season

1. Commissioner → League settings: new season dates, keeper deadline, draft time, set phase to `keepers`.
2. Run the **Refresh player projections** workflow (Actions tab) and load `supabase/seed/players-*.sql`.
3. GMs pick keepers → commissioner finalizes → set the order → draft.

Play fair, play hard and play to win.
