# Claims vs product (16 October 2026)

Marketing pages audited against `src/`, `supabase/`, `worker/`, and the pool docs. Softened copy shipped in the
same pull request; product gaps that need real build work stay listed here.

## Status key

- **true** — code delivers it today
- **partial** — mostly true; wording tightened
- **planned** — honest as “being built” / “coming”
- **false** — oversold before this pass (fixed in copy)

## Table (high-visibility claims)

| Claim | Where | Status | Fix in this PR |
|---|---|---|---|
| Free to start / never money / no app | Home, FAQs, meta | true | Kept |
| Live scoring, live room, draft clock, league voice | Home #live / #voice | true | Kept; voice scoped to fantasy depth |
| AI-enhanced *everything* | Pillar | partial → softened | “AI-enhanced fantasy” + pool voice |
| Every sport / on every sport you argue about | Hero, OG, mission | false → softened | Named six sports + questions |
| 11 kinds of sports pool | Strip / road | partial | **12** (added win totals card) |
| Rank the teams = final order | Kind grid | partial | “Rank clubs once; points for every win” |
| Box pool as generic sports | Kind grid | partial | Deep-link `comp=nhl-2026-27&kind=players` |
| Win totals | Missing on home | true in product | Card added → NBA wins |
| Bring your league (done) | Join, fantasy card, hockey FAQ | partial | Honest: roster import live; full move building |
| Masters as a product surface | Ticker, #callit | false | Replaced with DIY / show wording |
| Bachelor / award nights as open | Chips, together calendar | planned | Marked “coming”; Traitors open |
| Fantasy football from waitlist | `#join` select | false | “NFL / sports pools” |
| Free tier “12 teams / 30 players” | #tiers | planned / unenforced | Dropped numbers; “everything free until paid” |
| Centre for every sport (full box scores) | Feats | partial | “Each sport we run”; NHL deepest |
| App stores / Plus / Premium | #ship, #tiers | planned | Kept as Planned |
| Women’s soccer (WSL/NWSL) + WWC pack | together | true | Kept |
| Road “thread for every pool game” this season | #road | stale | Removed (already in Just shipped) |

## Left for product (not copy)

1. Self-serve full league move (settings + every past season in one flow)
2. Native app-store builds
3. Paid tier gating (Plus / Premium)
4. Soccer / basketball fantasy
5. Bachelor / Oscars / award-night packs
6. Golf / Masters as a fed event (DIY questions only today)

## Patrick hand-offs

None required to ship the copy. Optional: skim Love Is Blind and sport landings after deploy for tone.
