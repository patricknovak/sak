// How to see every NHL game, by country, for the Watch live page's guide. From the research in docs/WATCH-LIVE.md
// (prices before tax as of October 2026; they change, so each option opens the seller's own page). Every GM watches on
// their own account: no shared logins, no restreams.
export interface WatchOption { icon: string; name: string; tag?: string; price: string; covers: string; url?: string }
export interface CountryGuide { intro: string; options: WatchOption[]; together: string[]; note: string }

const TOGETHER = [
  'There is no legal synced watch party for NHL streams in Canada: Prime’s Watch Party and Disney’s GroupWatch are gone, and screen-sharing a game on Discord breaks every service’s terms.',
  'So the league watches together here: each GM watches on their own subscription, and the room is this page, the live scoreboard and chat: scores, your players’ points and the moments as they happen.',
  'Live games have no playback position to keep in step, so a second screen works everywhere.',
];

export const WATCH_GUIDE: Record<'CA' | 'US', CountryGuide> = {
  CA: {
    intro: 'Since this season Rogers holds every national NHL game in Canada. CBC and Hockey Night in Canada no longer carry the NHL, and there is effectively no free hockey left. Two subscriptions see every game from BC.',
    options: [
      { icon: '📺', name: 'Sportsnet+ Premium', tag: 'Every game', price: '$344.99 a year, or $44.99 a month', covers: 'Every Sportsnet national game (Saturday Night Hockey, Monday Night Hockey, which now streams only here), the Canucks, Oilers and Flames in their regions, and every out-of-market game with a choice of home or away feed. Through a TV provider, Monday Night Hockey is a $12.99 a month add-on.', url: 'https://www.sportsnetplus.ca/' },
      { icon: '📦', name: 'Prime Video', tag: 'Wednesdays', price: '$99 a year with Prime', covers: '27 Wednesday night national games in English and French, only on Prime, plus three playoff series a year.', url: 'https://www.primevideo.com/' },
      { icon: '🎟️', name: 'Sportsnet+ Standard', price: '$269.99 a year, or $34.99 a month', covers: 'Enough for a Canucks fan: every national game and your region’s Sportsnet games, without the out-of-market ones.', url: 'https://www.sportsnetplus.ca/' },
      { icon: '🟥', name: 'TSN', price: '$249.99 a year, or $29.99 a month', covers: 'Only needed in Ontario, Quebec and Manitoba, for the Jets, Senators, Canadiens and some Leafs games in their own regions. Outside them those games come with Sportsnet+ Premium.', url: 'https://www.tsn.ca/' },
    ],
    together: TOGETHER,
    note: 'Every game from BC: Sportsnet+ Premium and Prime, about $444 a year before tax. Add TSN in Ontario, Quebec or Manitoba for about $694. Regional games stay with the team’s own region; a VPN to get round that breaks every service’s terms.',
  },
  US: {
    intro: 'ESPN and TNT share the national games, NHL Power Play carries the out-of-market ones, and local TV moved from the old regional networks to team apps, over-the-air channels, Prime Video and DAZN.',
    options: [
      { icon: '📺', name: 'ESPN Unlimited', tag: 'National + out-of-market', price: 'About $320 a year, or $31.99 a month', covers: '100 national games on ABC, ESPN and the ESPN app, plus NHL Power Play: 1,050 out-of-market games. ESPN Select ($13.99 a month) has Power Play and the streaming-only games without the ESPN and ABC channels.', url: 'https://www.espn.com/watch/' },
      { icon: '🟦', name: 'HBO Max Standard', price: '$18.49 a month', covers: 'TNT and truTV’s 72 games and the 2027 Stanley Cup Final. Basic with Ads has no live sports.', url: 'https://www.hbomax.com/' },
      { icon: '🏠', name: 'Your team’s local games', price: 'Free over the air, up to about $240 a year', covers: 'Prime Video for the Hurricanes, Ducks, Blue Jackets, Stars, Wild and Blues; DAZN for the Rangers, Islanders, Devils, Sabres and Kings; team apps such as KnightTime+ or Mammoth+ elsewhere. Check your team’s own site.', url: 'https://www.nhl.com/info/how-to-watch-and-stream-nhl-games' },
    ],
    together: TOGETHER,
    note: 'Every game in the US: ESPN Unlimited and HBO Max, about $505 a year, plus your team’s local option. Local games are blacked out on Power Play.',
  },
};
