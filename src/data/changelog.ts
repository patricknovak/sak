// What's new: the product's changelog, newest first, for the Features page. Written for GMs in plain hockey English,
// one entry per thing a GM can see or use. Words that differ by league (the voice's name, the coins) come from the
// brand at render time, so entries say "the league's voice", never a name. Add an entry in the same pull request as
// the change.

export interface Change { date: string; icon: string; title: string; body: string; to?: string; tag?: 'formats' | 'commish' | 'draft' | 'everyone' }

export const CHANGELOG: Change[] = [
  { date: '2026-10-04', icon: '⚔️', tag: 'formats', title: 'Head-to-head leagues', to: '/standings',
    body: 'A league can play weekly matchups instead of one season-long total: one opponent a week, a W-L-T table, the week\'s matchups live on Home and Standings, and a phone alert each Monday with your opponent and last week\'s result.' },
  { date: '2026-10-04', icon: '🏆', tag: 'formats', title: 'Playoff brackets', to: '/standings',
    body: 'Head-to-head leagues can finish with a bracket for the top 2 to 8 teams over the season\'s last weeks, byes for the top seeds, and the champion crowned on the Standings page. Payouts follow the bracket.' },
  { date: '2026-10-04', icon: '📊', tag: 'formats', title: 'Categories, season-long or week by week', to: '/standings',
    body: 'Rotisserie ranks every team in each category over the season; head-to-head categories plays each week for them. Tap a matchup to see it category by category.' },
  { date: '2026-10-04', icon: '👥', tag: 'everyone', title: 'Matchups, player by player', to: '/standings',
    body: 'Tap any head-to-head matchup for both lineups side by side: every started player, his games and his points this week.' },
  { date: '2026-10-04', icon: '🎯', tag: 'draft', title: 'Drafting for categories', to: '/players',
    body: 'In a category league the Players page, draft room, cheat sheet and mock draft rank by category value (what a player is worth in your league\'s categories), autodraft picks by it, and Roster vs available compares your players with the free agents on it.' },
  { date: '2026-10-04', icon: '🎯', tag: 'everyone', title: 'Lineup efficiency', to: '/performance',
    body: 'Performance now shows how close your lineups came to the best you could have played each night from the same players: a Lineup column for every team, your share and the night that cost the most, and the most possible beside each day.' },
  { date: '2026-10-04', icon: '🧲', tag: 'formats', title: 'Pickups for your categories', to: '/players?tab=advisor',
    body: 'In a category league the pickup advisor looks for the free agents who help where you trail in the table, plays the move out night by night, and shows what it does to each category: +9 shots, +4 PIM, save percentage up.' },
  { date: '2026-10-04', icon: '🛡️', tag: 'commish', title: 'A commissioner\'s toolkit', to: '/commish',
    body: 'Co-commissioners, a clean handover when a GM walks away, a log of every commissioner action on the League page, a constitution page, your own roster slots, and a setup guide that walks a new league to draft night.' },
  { date: '2026-10-04', icon: '🟣', tag: 'commish', title: 'Your Yahoo past in one go', to: '/league?t=history',
    body: 'A league that played on Yahoo brings every season Yahoo kept, champions to last place, from the League page: connect Yahoo, pick the league, tick the seasons.' },
  { date: '2026-10-04', icon: '📜', tag: 'commish', title: 'Your league\'s past', to: '/league?t=history',
    body: 'Played somewhere else before? The commissioner writes past seasons in, or pastes a final table straight from Yahoo, ESPN, Fantrax or CBS, and the banners, titles and last places fill in.' },
  { date: '2026-10-03', icon: '✉️', tag: 'everyone', title: 'Email sign-in and invites', to: '/profile',
    body: 'Sign in with your email and a password you choose, reset it with a code, and join a league from an invite link. Someone in two leagues switches between them from the menu.' },
  { date: '2026-10-03', icon: '🎲', tag: 'everyone', title: 'Game lines in the NHL centre', to: '/nhl',
    body: 'Every game shows its line, total and the chance it goes to overtime, and you can bet coins on any game straight from the NHL centre.' },
];
