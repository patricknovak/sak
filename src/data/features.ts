// Everything the SaK site does, for the League Features page and the promo video.
// `key` is stable: GM comments are stored against it, so don't rename keys once shipped.

export interface Feature { key: string; icon: string; title: string; blurb: string; points: string[]; to?: string; isNew?: boolean }
export interface FeatureGroup { key: string; title: string; icon: string; tagline: string; features: Feature[] }

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    key: 'draft', title: 'Draft day', icon: '📋', tagline: 'Keepers in, then the best draft night we’ve ever had',
    features: [
      { key: 'keepers', icon: '🔒', title: 'Keepers', to: '/keepers', blurb: 'Pick up to 6 from last season’s roster before the deadline.',
        points: ['Your 2025-26 top scorer can’t be kept, so stars come back into the pool', 'Miss the deadline and the site keeps your top 6 by points', 'See every team’s keepers once they’re locked'] },
      { key: 'draft-room', icon: '⏱️', title: 'Live draft room', to: '/draft', blurb: 'An 18-round snake draft with a pick clock, live for everyone at once.',
        points: ['Star players to build your queue', 'Autodraft takes the best player on your queue (or board) when you’re away', 'Draft chat right beside the board for instant chirps', 'Phone alert when you’re on the clock'] },
      { key: 'draft-tv', icon: '📺', title: 'TV mode and draft sounds', to: '/draft/tv', isNew: true, blurb: 'Cast the full board to the big screen; the horn goes off on every pick.',
        points: ['Huge clock, whole board, last picks on a ticker, auto-scrolls to the round on the clock', 'Goal horn when a pick lands, ticks under ten seconds, a buzzer at zero', 'Sound toggle in the draft room for phones'] },
      { key: 'mock-draft', icon: '🧪', title: 'Mock draft', to: '/mock', blurb: 'Practise against bots for the other seven teams, as many times as you like.',
        points: ['Uses the real player pool and everyone’s keepers', 'Choose your draft slot, number of rounds and pick clock', 'Graded at the end, just like the real thing'] },
      { key: 'report-card', icon: '🎓', title: 'Draft report card', blurb: 'Every team graded A+ to F the moment the last pick lands.',
        points: ['League-relative grades from projected starting lineups', 'Steal of the draft and reach of the night', 'Garry posts the report cards to the chat'] },
      { key: 'future-picks', icon: '🎟️', title: 'Tradable draft picks', to: '/trades', blurb: 'Trade this year’s picks and next year’s, not just players.',
        points: ['Pick ownership tracked round by round', 'Shows up on every team page'] },
    ],
  },
  {
    key: 'season', title: 'Game nights', icon: '🏒', tagline: 'Live scoring, smart lineups and every stat you could want',
    features: [
      { key: 'live-scoring', icon: '📡', title: 'Live scoring', to: '/standings', blurb: 'Fantasy points straight from the NHL, updated every minute during games.',
        points: ['Goals, assists, +/-, PPP, shots, hits, blocks, wins, saves, shutouts and more', 'NHL stat corrections flow in automatically for three days', 'Lineups freeze at each player’s puck drop'] },
      { key: 'scoreboard', icon: '📡', title: 'Live scoreboard', to: '/scoreboard', isNew: true, blurb: 'Game night in one screen: every NHL score and every team’s starters, point by point.',
        points: ['NHL games with period, clock and score', 'Teams ranked by tonight’s points; tap one for every starter’s line', 'Refreshes itself every minute'] },
      { key: 'lineup', icon: '🧩', title: 'Set your lineup', to: '/team', blurb: 'Tap a player, tap where he goes. Locks when his game starts.',
        points: ['2C 2LW 2RW 3D 1Util 2G, 12 bench, 2 IR', 'Shows who plays today and games left this week', 'Warnings for empty slots and benched players who are playing'] },
      { key: 'lineup-tools', icon: '⚙️', title: 'Lineup tools and auto-pilot', to: '/team', isNew: true, blurb: 'The best possible lineup for today, this week or the whole season, in one tap.',
        points: ['An exact optimizer: never wastes a dual-position player', 'Rank by projection, hot hand (last 14 days), season average or rest-of-season (projection blended with this season’s pace)', 'Auto-pilot sets it every morning and again before puck drop', 'Pin players to always start or never start', 'Week planner shows everyone’s games day by day', 'Never overrides a move you made yourself that day'] },
      { key: 'players', icon: '🔍', title: 'Players, stats and pickups', to: '/players', isNew: true, blurb: 'Search every NHL player, slice the stats any way you like, add and drop.',
        points: ['Sort by any stat: goals, assists, PPP, shots, hits, blocks, wins, save % and more', 'Timeframes: projection, rest of season, last season, this season, last 7 / 14 / 30 days', 'Per-game rates, hide injured, minimum games and NHL team filters, plus a full stats table', 'The same tools inside the draft room and the mock draft', '10 free pickups a season, then $30 each, tracked automatically'] },
      { key: 'player-pages', icon: '🪪', title: 'Player pages', blurb: 'Tap any player anywhere for the full picture.',
        points: ['Where his fantasy points come from', 'Game log, season and career stats', 'News, injury notes and upcoming games', 'Who owns him, with a one-tap trade or pickup'] },
      { key: 'team-pages', icon: '🏟️', title: 'Team pages and scouting', blurb: 'Every roster, analysed, with a trade builder built in.',
        points: ['Strengths and weaknesses by position', 'Their picks for this year and next', 'Tick players and picks, then build a trade'] },
      { key: 'trades', icon: '🔄', title: 'Trades', to: '/trades', blurb: 'Offer players and picks; counter, accept or decline.',
        points: ['Commissioner approval on accepted deals', 'Trade deadline enforced', 'Everyone sees completed trades in the chat'] },
      { key: 'standings', icon: '🏆', title: 'Standings and playoffs', to: '/standings', blurb: 'The race for the Johnson and away from the Peter.',
        points: ['Points race chart: every team in its colours, tap a name to follow it', 'Today, yesterday and last-7-days columns', 'Playoffs continue with the same rosters on a separate table', 'Regular season and playoffs each have their own pot'] },
    ],
  },
  {
    key: 'social', title: 'Trash talk', icon: '🔥', tagline: 'Where the league actually lives',
    features: [
      { key: 'chat', icon: '💬', title: 'League chat and DMs', to: '/chat', blurb: 'Trash Talk for everyone, a draft room channel, and private DMs with every GM.',
        points: ['Reactions, replies and @mentions', 'Quick chirps one tap away', 'Unread dots so you never miss a shot'] },
      { key: 'garry', icon: '🎙️', title: 'Garry, the league bot', to: '/chat', isNew: true, blurb: 'Our resident chirper: recaps, nudges and answers, with sass.',
        points: ['Morning recap of last night with a Dangler of the Day coin bonus', 'Calls out sloppy lineups before puck drop', 'Say “Garry” anywhere and ask him anything: standings, players, your lineup, rules, money', 'Your own private “Ask Garry” channel', 'Grades the draft the moment it ends'] },
      { key: 'polls', icon: '📊', title: 'Polls in chat', to: '/chat', isNew: true, blurb: 'Settle it with a vote. Anyone can start one in any channel.',
        points: ['Two to six options, optional closing time', 'Live tallies and who voted for what', 'Change your vote until it closes'] },
      { key: 'weekly', icon: '📰', title: 'Weekly awards and power rankings', to: '/chat', isNew: true, blurb: 'Garry’s Monday column: Team of the Week, Bust of the Week, Player of the Week and the power rankings.',
        points: ['Team of the Week pockets 50 St. Patrick coins', 'Power rankings blend the last 14 days with the standings, with movement arrows', 'Posted to the chat every Monday morning'] },
      { key: 'bets', icon: '🎲', title: 'Side bets and St. Patrick coins', to: '/bets', blurb: 'Put your coins, or real money, where your mouth is.',
        points: ['Everyone started with 1,000 St. Patrick coins', 'Head-to-head bets settle automatically on fantasy points', 'Open bets anyone can take'] },
      { key: 'alerts', icon: '🔔', title: 'Phone alerts', to: '/profile', blurb: 'Buzzes for your draft turn, trade offers, mentions and big moments.',
        points: ['Player alerts: injury status changes, hat tricks, four-point nights and shutouts by your guys', 'Works on iPhone once SaK is on your Home Screen', 'In-app notification bell as well'] },
      { key: 'news', icon: '📰', title: 'News and injuries', to: '/news', blurb: 'NHL headlines and the injury report, tagged to the players they mention.',
        points: ['Updated every couple of hours', 'Injury status refreshed hourly'] },
    ],
  },
  {
    key: 'league', title: 'The league', icon: '🏛️', tagline: 'Since 2013: the money, the history and the rules',
    features: [
      { key: 'money', icon: '💰', title: 'Prize money', to: '/league?t=money', isNew: true, blurb: '$200 a GM: $25 to the SaK Fund, the rest to the pool.',
        points: ['60% for the regular season, 40% for the playoffs', 'Each pot pays 1st, 2nd and 3rd', 'Live projected payouts as the standings move'] },
      { key: 'history', icon: '📜', title: 'League history', to: '/league', blurb: 'Every season since 2013, the all-time table, champions and Peter holders.',
        points: ['The Johnson and The Peter', 'All-time franchise points'] },
      { key: 'rules', icon: '📖', title: 'Rulebook and rule votes', to: '/league?t=rules', blurb: 'The rules in one place, and a vote on changes.',
        points: ['Scoring table always up to date', 'Propose and vote on rule changes'] },
      { key: 'commish', icon: '🛠️', title: 'Commissioner tools', blurb: 'Everything Patrick needs to run the league, plus a system status panel that pages him if anything breaks.',
        points: ['Scoring editor, deadlines, draft settings and money', 'Approve trades, fix rosters, announcements'] },
      { key: 'profile', icon: '🎨', title: 'Your team, your way', to: '/profile', blurb: 'Team name, colours, emoji and motto, shown everywhere.',
        points: ['Name changes announced in the chat', 'Install SaK on your phone like an app'] },
      { key: 'spectators', icon: '🍿', title: 'Spectator passes', isNew: true, blurb: 'Friends can watch the league before they join it.',
        points: ['A login with no team: standings, the draft room, rules and history', 'Chat, DMs and St. Patrick coin side bets', 'The commish can switch chat, DMs, bets or ideas off for any spectator'] },
      { key: 'features', icon: '💡', title: 'This page', to: '/features', isNew: true, blurb: 'See what’s built, comment on it, and suggest what comes next.',
        points: ['Upvote the ideas you want most', 'The commish marks ideas planned, building or shipped'] },
    ],
  },
];

export const ALL_FEATURES = FEATURE_GROUPS.flatMap((g) => g.features);
