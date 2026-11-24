// Events with a page and a start link before they open (24 November 2026). The NFL's playoffs and the Stanley Cup's
// have landing pages people find weeks ahead (landing/nfl-playoff-pools.html, super-bowl-squares.html,
// stanley-cup-playoff-pools.html), and a postseason joins the start page's list only once its field is set. A link that
// names one early (#/new?comp=nfl-post-2026&kind=bracket) used to fall through to the bare first step. Now it opens on
// the league as it stands today, with a line saying when the playoff pool opens and that the host adds it to the same
// pool in a tap (the Host page, Add a game). Once the event is in the list the link opens on it and nothing here is read.
import type { GameKind } from './poolGames';

export type ComingEvent = {
  // what the event is called in a sentence
  name: string;
  // when its pools open, as the line says it
  opens: string;
  // the event to start on until then, and the kind to tick when the link's own kind isn't offered there
  now: string;
  lead: GameKind;
  // the kind the link asked for, in words, by the link's kind
  what: Partial<Record<GameKind, string>>;
};

export const COMING: Record<string, ComingEvent> = {
  'nfl-post-2026': {
    name: 'the NFL playoffs', opens: 'the night the field is set, Sunday January 10', now: 'nfl', lead: 'pickem',
    what: { bracket: 'The playoff bracket', squares: 'The Super Bowl grid', series: 'Playoff picks', survivor: 'The playoff Eliminator', props: 'Playoff prop sheets', sweep: 'The playoff sweepstake' },
  },
  'nhl-post-2027': {
    name: 'the Stanley Cup playoffs', opens: 'the night the field is set, Saturday April 10', now: 'nhl-2026', lead: 'players',
    what: { players: 'The playoff box pool', bracket: 'The playoff bracket', series: 'Playoff series picks', props: 'Playoff prop sheets', squares: 'Playoff squares', sweep: 'The playoff sweepstake' },
  },
};

// the line the start page shows above its steps
export function comingLine(c: ComingEvent, kind: string | null) {
  const what = (kind && c.what[kind as GameKind]) || `A pool on ${c.name}`;
  return { head: `${what} opens ${c.opens}.`, body: 'Start your pool today on what’s on now and get your crew in. The night it opens, add it from the Host page, under Add a game: same pool, same people, one tap.' };
}
