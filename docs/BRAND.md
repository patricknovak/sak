# Super Pools: brand and positioning

The standing reference for how Super Pools is named, described, sold and drawn. The landing page
(`landing/index.html`), the product constants (`src/lib/brand.ts`, `PRODUCT`) and anything written about the
product follow this. The SaK league keeps its own brand (`leagues.brand`); this document is about the product
the league runs on.

## 1. What we are selling, in one breath

Super Pools is a fantasy hockey league site with a commissioner's assistant built in. It scores the league
from the NHL box scores every night, settles the side bets, sets the lineups GMs planned weeks ago, runs the
draft, and gives the league a voice that posts the recap, grades the trades and answers "who should I
start?" in the chat. The commissioner runs the league. Super Pools does the bookkeeping.

**Tagline:** The hockey pool that runs itself.

**Positioning statement.** For commissioners of serious hockey pools (keeper and dynasty leagues, six to
fourteen teams, friends who have played together for years) who are tired of doing the league's bookkeeping
by hand on a platform built for football, Super Pools is the league site that does the chores and keeps the
whole life of the league in one place: scoring, lineups, draft, trades, side bets, money and the chat. Unlike
Yahoo, ESPN, Fantrax or Sleeper, it was built by a keeper league that has run on it every night of the season,
and it treats the chat, the bets and the league's history as the point, not a sidebar.

## 2. Who it is for

- **The buyer is the commissioner.** One subscription per league per season. The commissioner pays or splits
  it with the GMs. Every message on the landing page speaks to the person who runs the league and wants to
  stop running the spreadsheet.
- **The users are the GMs.** Eight to fourteen people who check the app on their phone every night of the
  season. Phone-first is a brand rule, not a technical note.
- **Hockey first, Canada first.** "Pool" is the Canadian word for a fantasy league, which is why the product
  is called what it is. The NHL is the only sport at launch.
- **Not for:** public leagues of strangers, pick'em and survivor pools, daily fantasy, betting for money.

## 3. The three things we say

Every page, post and pitch leans on these three, in this order.

1. **It runs itself.** Points from the box scores as the games happen, every player locked at his own puck
   drop, corrections for a month after. Lineups set up to sixty days ahead or left to the auto-pilot. Side bets,
   props, pools and the coin book settled from the box scores with no one keeping score by hand.
2. **It talks back.** A league voice, named by the league (Garry in SaK), that posts the daily recap, power
   rankings, trade grades and keeper reports, answers questions in the chat, and talks trash on request.
3. **It was built by a league, not a media company.** Thirteen seasons of keeper-league rules are baked in:
   keepers and the top-scorer rule, a draft room with a clock and a TV board, trade review windows, IR rules,
   acquisition limits, the money between friends. The founding league runs on it every night and feels every
   bug first.

Proof we can use today: the SaK Superleague (est. 2013) has run its 2026-27 season on Super Pools from the
keeper deadline through the draft and every game night since. Say that, with the year. Do not invent user
counts, testimonials or press.

## 4. How we compare

The long version, with sources, is `docs/MARKET.md`.

| | Yahoo / ESPN | Fantrax | Sleeper | Super Pools |
|---|---|---|---|---|
| Hockey | an afterthought to football | deep, dated | none | the only sport |
| Keeper leagues | basic | strong | basic | built around them |
| Scoring | nightly | nightly | nightly | live from the box scores, per-player locks, corrections |
| Side bets, book | no | no | no | yes, settled from the box scores |
| League voice | no | no | no | yes, named per league |
| Chat | sidebar | sidebar | the product | the league's living room |
| Who built it | media company | fantasy company (Markham, Ontario) | social app | a keeper league |
| Price | free with ads, $60-80 a year per user for the tools | free, $130 a league for the full rules | free, funded by picks and prediction markets | one subscription per league per season |

We never name competitors on the landing page. We describe the difference ("built for football", "you keep
the score yourself") and let the reader fill in the name.

## 5. Voice

Hockey-league plain English. The way a good commissioner writes the Sunday email: short, specific, dry.

- Say: GM, pool and league (both, interchangeably), puck drop, box score, keeper, the book, the draft room,
  the league voice. Name features by what they do ("lineups weeks ahead"), not by a brand name.
- Avoid: "AI-powered", "revolutionize", "platform", "seamless", "unlock", "supercharge", any exclamation
  mark, any em dash, emoji in copy (icons in the UI are fine).
- "AI" appears in the domain and in the mechanism, not in the name and not in the headline. The headline
  sells what the assistant does for the league, not that it is an assistant.
- One idea per sentence. Phone width first: a headline is at most six words, a card is two sentences.
- Humour is dry and about hockey or the league, never about the reader.

## 6. Visual identity

**Name and wordmark.** Super Pools, two words, capitalised. The wordmark is SUPER in gold italic black
weight and POOLS in ink, set in Barlow Condensed, with no "AI" badge. The domain superpoolsai.com appears in
the footer and in the lockup for print, never inside the wordmark.

**The mark.** A faceoff dot: a gold ring, a gold centre dot and the four hash marks. It is where every game
starts and where every player on Super Pools locks (his own puck drop); it is also a circle, a pool. On the
app icon it sits on a Night tile with rounded corners. The gold ring is the one thing it shares with the SaK
icon, which is the lineage.

**Colour.**

| Token | Hex | Use |
|---|---|---|
| Night | `#0b1220` | page background |
| Boards | `#111b30` | cards, panels |
| Ink | `#eef2ff` | text |
| Mute | `#94a3b8` | secondary text |
| Gold | `#f7c548` | the accent: the ring, the primary button, one word per headline |
| Ice | `#38bdf8` | links, lines, the second accent |
| Red line | `#ef2a4f` | alerts and the centre line only, never decoration |

Dark is the default and the only theme on the landing page; the app has the same palette. Gold is used once
per screen as the thing to look at. Ice is for lines and links. Nothing else is coloured.

**Type.** Barlow Condensed (900 italic for the gold word, 900 for headlines, 700 for labels) and Inter (400
body, 600 emphasis). The landing page self-hosts both so it depends on nothing at load.

**Imagery.** Screens of the product on a phone, the TV draft board, the box score. No stock photography of
hockey players, no generated art, no mascots.

## 7. Where it applies today

- `landing/index.html`: the only public surface. Hero, the three things, how a season goes, who built it,
  the waitlist (writes to `public.waitlist` through PostgREST with the publishable key).
- `landing/icon.svg`, `landing/og.png`: the mark and the share card. The share card is rendered from
  `landing/og.html` with the pre-installed headless Chromium (`landing/README.md` has the command).
- `src/lib/brand.ts`, `PRODUCT`: name, tagline, domain, URL. Shown in the app footer and anywhere the product
  (not the league) is named.
- Emails from hello@superpoolsai.com: Patrick's own voice and sign-off; the product voice above applies to
  the copy, not to the correspondence.
