# Watch live: seeing every NHL game, legally, in 2026-27

Researched 6 and 7 October 2026 for Patrick's ask: "Make a new section for watch live and do some deep research on how to
provide live sports streaming to the SaK league for all NHL games." Prices are before tax and change often. Items marked
**[unconfirmed]** were not checked against a 2026-27 source and come from earlier seasons or a single secondary source.
The section is `#/watch` (`src/pages/WatchLive.tsx`); its guide is `src/lib/watchGuide.ts`.

**The rule.** SaK can't stream NHL games. The rights belong to the broadcasters, and no licence for live NHL video exists
that a small app can buy: Sportradar's live streams go only to licensed sportsbooks. Restreaming, screen-sharing a game,
shared logins and VPNs around blackouts all break the rights-holders' terms. What SaK can do is take every GM to the
right player in one tap, know what each GM can watch, and be the room the league watches in.

The 2026-27 season opened on 29 September 2026. It is 84 games, the first regular season to start before October.

## 1. Who has the games

### Canada

- **Rogers/Sportsnet holds every national game.** The deal runs 12 years, 2026-27 to 2037-38, for about C$11 billion.
  - 550+ national games, and 150 regional blackouts lifted.
  - **Saturday Night Hockey** replaces Hockey Night in Canada.
  - **Monday Night Hockey streams only on Sportsnet+**. Viewers who get Sportsnet through a TV provider pay a $12.99 a month add-on; Rogers Xfinity TV Plus and Ultimate include it.
  - The Canucks have 33 national games: 24 Saturdays and 9 Mondays.
- **CBC and Hockey Night in Canada no longer carry the NHL**, from this season. Citytv doesn't either. There is effectively no free NHL in Canada.
- **Prime Video has Wednesdays.** It is a 12-year sub-licence: 27 national games in English and French, and two first-round and one second-round playoff series a year. The games are included in Prime ($99 a year or $9.99 a month). Prime's old Monday package has ended.
- **TVA Sports has the French rights:** up to 350 national games, 32 Canadiens games and all Canadiens playoff games.
- **TSN's regional games:**
  - TSN has the Jets (TSN3), Senators (TSN5), Canadiens in English (TSN2) and some Leafs games (TSN4).
  - RDS has the Habs and Sens in French.
  - TSN's own subscription costs $29.99 a month or $249.99 a year, from 14 April 2026.
  - Outside their regions these games have come with Sportsnet+ Premium **[unconfirmed for 2026-27]**.
- **Sportsnet+ prices** (from 22 September 2026):

  | Tier | Monthly | Annual | NHL |
  |---|---|---|---|
  | Standard | $34.99 | $269.99 | Every Sportsnet national game, Monday Night Hockey, your region's Sportsnet games, the playoffs Sportsnet carries |
  | Premium | $44.99 | $344.99 | Standard plus every out-of-market game (Centre Ice), with a choice of home or away feed |

- **Blackouts:** regional games stay in the team's territory on its regional rights-holder. Out-of-market games are on Premium. Prime's Wednesdays and the Sportsnet+ Mondays are exclusive to them.

### United States

- **ESPN and ABC:** 100 national games, 47 of them streaming only (on ESPN, Disney+ and Hulu). Prices from 17 September 2026:
  - **ESPN Select** ($13.99 a month): includes **NHL Power Play**, 1,050+ out-of-market games.
  - **ESPN Unlimited** ($31.99 a month): adds the ESPN, ESPN2 and ABC channels.
- **TNT:** 72 games on TNT and truTV, streaming on **HBO Max Standard** ($18.49). Basic with Ads has no live sports. TNT also has the 2027 Stanley Cup Final.
- **Local TV after the FanDuel Sports Network shut down:**
  - **Prime Video** streams the Hurricanes, Ducks, Blue Jackets, Stars, Wild and Blues locally. The NHL produces the CAR, CBJ, MIN and STL broadcasts, and Fubo carries those channels too.
  - **DAZN** has the MSG teams (Rangers, Islanders, Devils, Sabres) and the Kings.
  - Scripps over-the-air stations and team apps carry Tampa, Florida, Vegas and Nashville.
  - Utah has Mammoth+. The Kraken have KONG over the air.
  - The Red Wings are on Detroit SportsNet, the Bruins on NESN 360, the Penguins on SNP 360, the Capitals on Monumental+, and the Flyers and Sharks on Peacock's regional add-on.
  - Most per-team prices come from one secondary source **[unconfirmed]**.
- **Outside North America:** NHL.TV is now only on DAZN, in about 200 countries.

## 2. The cheapest way to see every game

| Where | Bundle | A year, before tax |
|---|---|---|
| BC (most of the league) | Sportsnet+ Premium annual + Prime | **$443.99** (about $497 with GST and PST) |
| BC, Canucks only | Sportsnet+ Standard + Prime | $368.99 |
| Ontario, Quebec, Manitoba | Add TSN for the home team's regional games | about $694 |
| United States | ESPN Unlimited + HBO Max Standard (+ the local team's option) | about US$505 (+ $0 to $240) |

## 3. Watching together

| Option | 2026 | Live NHL? |
|---|---|---|
| Prime Video Watch Party | Ended 31 March 2024 | No |
| Disney+ GroupWatch | Removed 18 September 2023 | No |
| Teleparty | ESPN on its paid tier; no Sportsnet+ or TSN; built for on-demand, not live | No |
| Apple SharePlay | The ESPN app supports it for some live sports (US); the NHL app doesn't; Sportsnet+, TSN and Prime **[unconfirmed]** | ESPN only |
| Discord Go Live, any screen share | Retransmits the stream: breaks the services' terms, and DRM shows a black screen anyway | Not legal |

**There is no legal synced watch party for NHL streams in Canada.** The legal pattern is the one Watch live builds:
- each GM watches on their own subscription;
- the league shares the room: live scores, players' points, chat and the moments.

Live games have no playback position to keep in step, so a second screen works naturally.

## 4. What an app can offer around a live game

1. **Where to watch, per game.**
   - The NHL schedule (`/v1/schedule/{date}`, `/v1/score/{date}`) lists `tvBroadcasts` for each game: network, `countryCode` (CA/US) and `market` (N national, H home, A away).
   - Watch live reads them through nhl-hub. It maps each network to a service in `src/lib/watch.ts`, and opens the broadcaster's page or the GM's own TV provider's player in a new tab.
   - Sportsnet+ and TSN publish no deep-link format.
   - ESPN's app scheme (`sportscenter://...showWatchStream`) is undocumented and its ids change, so plain web links it is.
2. **Official NHL video.**
   - After a game, the score feed has `threeMinRecap` and `condensedGame`. Each goal has a `highlightClip` and a sharing URL (nhl.com/video/...). All are Brightcove ids.
   - **The NHL's terms of service (updated 29 October 2025):**
     - embedding NHL content is for non-commercial use only, and can be switched off at any time;
     - embeds may not compete with NHL services;
     - scraping is forbidden;
     - sites must not link to NHL content "in any website that requires registration". SaK requires a login.
   - NHL centre and Watch live play these clips in the NHL's own Brightcove player today. The safer pattern is plain outbound links to the nhl.com sharing URLs, or YouTube embeds of the NHL's and Sportsnet's own highlight uploads. **A decision for Patrick** (section 6).
3. **Team radio.**
   - The schedule lists an HLS `radioLink` per team (`d2igy0yla8zi0u.cloudfront.net/...`). It is NHL.com's own player feed, and the same terms apply.
   - Linking to the station or the nhl.com game page is the safe form.
   - The Canucks' radio moved to 104.9 Kiss Radio after Sportsnet 650 closed.
4. **A live rink tracker.**
   - Play-by-play (`/gamecenter/{id}/play-by-play`) has x/y coordinates, the zone and the type of every shot, hit, faceoff and goal. That is enough to draw a live event map within seconds.
   - The goal-replay tracking (`pptReplayUrl`) refuses requests without an nhl.com referrer. It isn't meant for third parties, so leave it.
   - Full live puck and player tracking is licensed through Sportradar only.
5. **Licensed providers.**
   - **Sportradar** is the NHL's official data and betting-video partner. It has a free 30-day developer trial; production is priced by quote, in the thousands a month **[estimate]**.
   - **STN Video** syndicates NHL highlights to approved US news publishers, ad-supported.
   - **WSC Sports** sells to rights-holders.
   - No licence lets a small app embed live NHL video.
6. **Referrals.**
   - ESPN has an affiliate programme through Impact, US only **[unconfirmed terms]**.
   - None was found for Sportsnet+, TSN or the NHL.

## 5. What the section does

`#/watch`, Watch live, under More in hockey leagues:
- **Tonight at a glance:**
  - the games, and how many are on now;
  - how many the GM can watch with what they have;
  - their starters playing, with points so far.
- **The one to watch:** the game with the most of their starters in it.
- **Every game:** live first, then still to come (most of your starters first), then finals. Each card shows:
  - whether you can watch it and where:
    - ✓ on a service you have, or a national channel in your TV package;
    - ~ a regional feed, in your package if you live in the team's area;
    - 🔒 needs a service you don't have;
  - a one-tap **Watch on ...** button;
  - team radio;
  - your players with live fantasy points;
  - the other GMs with starters in it;
  - the NHL's recap and condensed game after the final.
- **I have them all** (Patrick, 7 October 2026: "Please make it such there is no limits to get into the content as I already have access to all the content via subscriptions").
  - It is a one-tap switch on the page and on My profile, saved in `teams.tv.all` through `set_tv`.
  - When it is on, nothing is marked locked, and every game opens straight in the broadcaster's player for the GM's country (or their TV provider's).
- **Where the league has skin in it:** every GM's starters in the games still to finish, with a link to chat.
- **How to see every game:** the bundles above for Canada and the US, and how the league watches together.

## 6. Recommendations and decisions

1. **Each GM uses their own account, always.**
   - For BC: Sportsnet+ Premium and Prime, $443.99 a year.
   - In Ontario, Quebec and Manitoba, add TSN.
   - In the US: ESPN Unlimited and HBO Max, plus the local team's option.
2. **The watch-together room is ours, not a stream.** Next steps:
   - a chat thread per game;
   - "your player scored" moments from the play-by-play;
   - the live rink tracker from play-by-play coordinates.
3. **Decision for Patrick: NHL video and radio inside the app.** The clips and radio NHL centre and Watch live play inline come from NHL.com. The NHL's terms forbid embedding in a site that requires registration. Two choices:
   - **Recommended:** link out to nhl.com's video pages and the stations;
   - keep them inline while SaK is a private, non-commercial league, and switch to links before Super Pools charges anyone.
4. **Skip paid live-video licensing.** It isn't sold at this scale.
5. **Before Super Pools takes money:** re-read the broadcasters' and the NHL's terms with a lawyer, and keep the "where to watch" links plain web links.

## Sources (season or date each applies to)

- Rogers 12-year deal: https://www.nhl.com/news/nhl-rogers-announce-12-year-rights-deal
- Sportsnet+ prices from 22 Sept 2026: https://www.iphoneincanada.ca/2026/09/22/sportsnet-plus-price-increase-canada-nhl-2026/
- 550+ games, 150 blackouts lifted, Monday Night Hockey on Sportsnet+: https://www.sportsvideo.org/2026/09/10/sportsnet-removes-150-blackouts-for-more-national-nhl-games-than-ever-in-2026-2027-season/
- Standard vs Premium: https://thehockeynews.com/nhl/toronto-maple-leafs/latest-news/streaming-maple-leafs-games-just-got-more-expensive-again
- Canucks' national games and radio: https://canucksarmy.com/news/sportsnet-broadcast-33-vancouver-canucks-games-nationally-elliotte-friedman-kevin-bieksa-returning-saturday-night-hockey
- HNIC leaves CBC (16 June 2026): https://www.cp24.com/news/sports/2026/06/16/hockey-night-in-canada-wont-return-to-cbc-this-fall/
- Prime Video Wednesdays in Canada: https://www.iphoneincanada.ca/2026/09/03/amazon-prime-video-nhl-schedule-in-canada/
- TVA French sub-licence: https://www.sportsvideo.org/2026/09/08/rogers-and-quebecor-announce-12-year-french-language-nhl-sublicensing-deal/
- TSN price from 14 April 2026: https://mobilesyrup.com/2026/04/10/bell-media-hikes-price-of-tsn-subscription-bundles/
- 2026-27 schedule (29 Sept, 84 games): https://www.nhl.com/news/nhl-announces-2026-27-regular-season-schedule
- ESPN's 100 games and Power Play: https://espnpressroom.com/press-release/espn-announces-100-exclusive-national-hockey-league-games-for-2026-27-season/
- ESPN prices from 17 Sept 2026: https://www.sportsmediawatch.com/2026/08/espn-unlimited-first-price-increase-september/
- TNT's 72 games: https://press.wbd.com/us/media-release/tnt-sports-unveils-blockbuster-72-game-nhl-tnt-schedule-2026-27-nhl-regular-season
- US local TV by team (Sept 2026): https://www.sportsmediawatch.com/2026/09/smw-faq-nhl-broadcasts-2026-27/
- Prime local for six teams: https://www.nhl.com/news/prime-video-to-stream-nhl-games-in-6-local-markets
- NHL's how-to-watch page: https://nhl.com/info/how-to-watch-and-stream-nhl-games
- NHL.TV on DAZN: https://www.nhl.com/video/nhltv-information
- Prime Watch Party ended: https://www.engadget.com/twitch-is-ending-its-pandemic-era-prime-video-watch-parties-110004438.html
- Disney+ GroupWatch removed: https://www.techradar.com/streaming/disney-plus-just-removed-one-of-its-best-friends-and-family-focused-features
- Teleparty services: https://ww1.teleparty.com/support
- ESPN SharePlay: https://imore.com/espn-adds-shareplay-support-live-sports-and-more
- Discord terms (29 Sept 2025): https://discord.com/terms
- NHL terms of service (29 Oct 2025): https://www.nhl.com/info/terms-of-service
- Sportradar and the NHL: https://nhl.com/news/nhl-sportradar-10-year-partnership-325502590
- STN Video and the NHL: https://www.stnvideo.com/press/stn-partners-with-nhl/
- NHL web API, checked live 6-7 Oct 2026: https://api-web.nhle.com/v1/schedule/2026-10-06 , https://api-web.nhle.com/v1/score/2026-10-05 , https://api-web.nhle.com/v1/gamecenter/2026020001/play-by-play
