// What the start page (#/new) and the host's games desk (Picks.tsx) both draw: when a pick locks, which sports play
// best-of series, the prop sheet's game picker and the squares grid's settings. In a file of their own (24 November
// 2026) so the start page, a stranger's first screen, doesn't pull in the whole picks page to draw them.
import { useEffect } from 'react';
import { SIZES, START_WORD, gridGame, gridLabel, paysFor, type Grid, type SheetGame, type SquaresRules } from '../lib/poolGames';

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const lockText = (iso: string | null, tbd = false) => {
  if (!iso) return 'date to be set';
  const d = new Date(iso);
  return tbd ? `${DAY.format(d)}, time to be set` : `${DAY.format(d)}, ${TIME.format(d)}`;
};

// sports whose postseason is played in best-of series: their brackets can carry a bonus for calling the games
export const SERIES_SPORTS = ['mlb', 'nhl', 'nba'];

// which game a prop sheet goes on: the games still to start this week, soonest first, under their week or series, two
// to a row so a full NFL Sunday fits on a phone
const SHORT_TIME = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
export function SheetPicker({ games, on, setOn, dark }: { games: SheetGame[]; on: number; setOn: (id: number) => void; dark?: boolean }) {
  const groups = [...new Set(games.map((g) => g.label))];
  return (
    <div className="space-y-2.5">
      {groups.map((label) => (
        <div key={label}>
          {groups.length > 1 || games.length > 2 ? <div className="mb-1 text-[10px] font-black uppercase tracking-[.14em] text-mute">{label}</div> : null}
          <div className="grid grid-cols-2 gap-1.5">
            {games.filter((g) => g.label === label).map((g) => {
              const sel = g.id === on;
              return (
                <button key={g.id} type="button" onClick={() => setOn(g.id)}
                  className={`rounded-xl px-2.5 py-2 text-left ring-1 transition ${sel ? (dark ? 'bg-white text-[#0b1220] ring-white' : 'bg-gold/[.14] text-white ring-gold/70') : 'bg-white/[.04] text-slate-200 ring-white/10'}`}>
                  <span className="block text-[13px] font-bold leading-snug">{g.game_no ? `Game ${g.game_no} · ` : ''}{g.away} at {g.home}</span>
                  <span className={`block text-[11px] ${sel && dark ? 'text-[#0b1220]/70' : 'text-mute'}`}>{SHORT_TIME.format(new Date(g.kickoff))}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// a grid's settings: which series, its size, the price of a square, when it pays and how often the digits are drawn
export function SquaresKnobs({ grids, on, setOn, grid, setGrid, dark, sport }: {
  grids: Grid[];
  on: number; setOn: (id: number) => void; grid: Omit<SquaresRules, 'series'>; setGrid: (g: Omit<SquaresRules, 'series'>) => void; dark?: boolean; sport?: string;
}) {
  // the sport's own checkpoints: a choice it can't use (baseball's innings on a football grid) falls back to its first
  const pays = paysFor(sport);
  useEffect(() => { if (!pays.some((p) => p.key === grid.pays)) setGrid({ ...grid, pays: pays[0].key }); }, [sport]); // eslint-disable-line react-hooks/exhaustive-deps
  const chip = (sel: boolean) => `rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${sel ? (dark ? 'bg-white text-[#0b1220] ring-white' : 'bg-gold text-[#0b1220] ring-gold') : 'bg-white/[.04] text-slate-200 ring-white/10'}`;
  const row = (label: string, children: React.ReactNode, note?: string) => (
    <div><div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-mute">{label}</div><div className="flex flex-wrap gap-1.5">{children}</div>{note && <p className="mt-1.5 text-[11px] leading-snug text-mute">{note}</p>}</div>
  );
  const cur = grids.find((g) => g.id === on);
  const series = grids.filter((g) => !g.fixture), week = grids.filter((g) => g.fixture);
  return (
    <div className="space-y-3">
      {/* a postseason's few series as chips; an NFL week's games in the game picker, under their week */}
      {grids.length > 1 && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-mute">On</div>
          {series.length > 0 && <div className="flex flex-wrap gap-1.5">{series.map((g) => <button key={g.id} type="button" onClick={() => setOn(g.id)} className={chip(g.id === on)}>{g.short ?? g.label}{g.high && g.low ? ` · ${g.high} v ${g.low}` : ''}</button>)}</div>}
          {week.length > 0 && <div className={series.length ? 'mt-2.5' : ''}><SheetPicker dark={dark} games={week.map(gridGame)} on={on} setOn={setOn} /></div>}
        </div>
      )}
      {cur && <p className="text-xs text-slate-300">{gridLabel(cur)} · {cur.best_of === 1 ? `${(START_WORD[sport ?? ''] ?? 'start').replace(/^./, (c) => c.toUpperCase())} ${lockText(cur.starts_at, cur.tbd)}` : `Game 1 ${lockText(cur.starts_at, cur.tbd)} · up to ${cur.best_of} games`}</p>}
      {row('Grid', SIZES.map((x) => <button key={x.key} type="button" onClick={() => setGrid({ ...grid, size: x.key })} className={chip(grid.size === x.key)}>{x.label}</button>), SIZES.find((x) => x.key === grid.size)!.line)}
      {row('A square costs', [5, 10, 25, 50].map((c) => <button key={c} type="button" onClick={() => setGrid({ ...grid, cost: c })} className={chip(grid.cost === c)}>{c} coins</button>),
        `A full grid is a pot of ${(grid.cost * grid.size * grid.size).toLocaleString()} coins.`)}
      {row('Pays', pays.map((x) => <button key={x.key} type="button" onClick={() => setGrid({ ...grid, pays: x.key })} className={chip(grid.pays === x.key)}>{x.label}</button>), (pays.find((x) => x.key === grid.pays) ?? pays[0]).line)}
      {(cur?.best_of ?? 2) > 1 && row('Digits', ([['once', 'One draw'], ['each', 'Fresh each game']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setGrid({ ...grid, digits: k })} className={chip(grid.digits === k)}>{l}</button>),
        grid.digits === 'once' ? 'The same numbers all series: a good square stays good.' : 'New numbers every game, so a bad square gets another chance.')}
    </div>
  );
}
