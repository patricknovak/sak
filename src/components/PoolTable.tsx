// The pool's Table (migration 169): every game the pool runs, one tap apart, each ranked the same way whatever its kind.
// The main game leads; the arrows count from where the day began; a row that can no longer finish first says so.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronRight, Dices } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { kindOf, outOfIt, type BoardGame, type BoardRow } from '../lib/poolScoreboard';
import { Coins } from './Pool';
import { Rank, TeamBadge } from './ui';

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// up or down since the day began
export function Move({ n, size = 12 }: { n: number | null | undefined; size?: number }) {
  if (!n) return null;
  return n > 0
    ? <span className="inline-flex items-center gap-px text-[11px] font-bold text-emerald-300" title={`Up ${n} today`}><ArrowUp size={size} strokeWidth={3} />{n}</span>
    : <span className="inline-flex items-center gap-px text-[11px] font-bold text-red-300" title={`Down ${-n} today`}><ArrowDown size={size} strokeWidth={3} />{-n}</span>;
}

// a score as its kind counts it: coins, points or weeks survived
export function BoardScore({ g, v, big }: { g: BoardGame; v: number; big?: boolean }) {
  const k = kindOf(g.kind);
  if (k.coins) return <Coins n={v} />;
  return <>{fmt(v)}<span className={`ml-1 font-sans font-bold text-mute ${big ? 'text-sm' : 'text-[11px]'}`}>{k.unit(v)}</span></>;
}

// the chips that switch between games, the main one first and crowned
export function GameChips({ games, sel, onPick }: { games: BoardGame[]; sel: string; onPick: (key: string) => void }) {
  if (games.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {games.map((g) => (
        <button key={g.key} type="button" onClick={() => onPick(g.key)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 transition ${g.key === sel ? 'bg-gold text-ice ring-gold' : 'bg-white/[.04] text-slate-200 ring-white/10 hover:bg-white/[.08]'}`}>
          <span aria-hidden>{g.crown ? '👑' : kindOf(g.kind).icon}</span>{g.title}
          {g.status === 'done' && <span className={`rounded-full px-1.5 py-px text-[9px] uppercase tracking-wider ${g.key === sel ? 'bg-black/15' : 'bg-white/10 text-mute'}`}>Final</span>}
        </button>
      ))}
    </div>
  );
}

// the caller's place in a game, as the hero of its table
export function MyPlace({ g, solo }: { g: BoardGame; solo?: boolean }) {
  const m = g.mine;
  const k = kindOf(g.kind);
  const second = g.rows.find((r) => r.rank > 1);
  // coins carry their emoji and run to four figures: a size down so three tiles fit a 360 px phone
  const val = `font-display font-extrabold text-white ${k.coins ? 'text-lg' : 'text-2xl'}`;
  const tile = 'min-w-0 overflow-hidden rounded-2xl bg-black/25 px-3 py-2 ring-1 ring-white/10';
  return (
    <div className="relative overflow-hidden rounded-3xl border border-gold/25 p-4" style={{ background: 'radial-gradient(120% 120% at 0% 0%, rgb(var(--gold-rgb)/.22), transparent 60%), linear-gradient(160deg,#18142c,#0b1222 75%)' }}>
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/20 text-2xl" aria-hidden>{k.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold uppercase tracking-[.2em] text-gold">
            {g.crown && !solo && <span>👑 Main game</span>}<span className={g.status === 'open' ? 'text-emerald-300' : 'text-mute'}>{g.status === 'open' ? '● On' : 'Final'}</span>
          </div>
          <div className="break-words font-display text-xl font-extrabold leading-tight text-white">{g.title}</div>
          <p className="mt-0.5 text-xs leading-snug text-mute">{k.blurb}</p>
        </div>
      </div>
      {m ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className={tile}><div className="label">Place</div>
            <div className="flex items-baseline gap-1.5 font-display text-2xl font-extrabold text-white">{ordinal(m.rank)}<Move n={m.move} /></div>
            <div className="text-[11px] text-mute">of {g.members}</div></div>
          <div className={tile}><div className="label">{k.coins ? 'Worth' : 'Score'}</div>
            <div className={`${val} whitespace-nowrap`}><BoardScore g={g} v={m.score} big /></div>
            <div className="text-[11px] text-mute">{m.line ?? ''}</div></div>
          <div className={tile}><div className="label">{m.rank === 1 ? 'Lead' : 'To first'}</div>
            <div className={`${val} whitespace-nowrap`}>{m.rank === 1 ? (second ? <BoardScore g={g} v={m.score - second.score} big /> : '–') : <BoardScore g={g} v={m.behind} big />}</div>
            <div className="text-[11px] text-mute">{m.possible != null && g.status === 'open' ? `${fmt(m.possible)} still possible` : m.rank === 1 ? 'over 2nd' : 'behind'}</div></div>
        </div>
      ) : <p className="mt-3 text-sm text-mute">You’re watching this one: members’ places are below.</p>}
      <Link to={g.link} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-300">Open {g.title.replace(/^The /, 'the ')} <ChevronRight size={14} /></Link>
    </div>
  );
}

// one game's table
export function BoardRows({ g, extra }: { g: BoardGame; extra?: (r: BoardRow) => React.ReactNode }) {
  const { teams, me } = useLeague();
  return (
    <div className="card divide-y divide-white/[.05] p-1">
      {g.rows.map((r) => {
        const t = teams.find((x) => x.id === r.team_id);
        const out = outOfIt(g, r);
        return (
          <div key={r.team_id} className={`flex items-center gap-3 rounded-xl px-3 py-3 ${r.team_id === me?.id ? 'bg-gold/[.07]' : ''} ${r.alive === false || out ? 'opacity-70' : ''}`}>
            <div className="flex w-7 shrink-0 flex-col items-center gap-0.5"><Rank n={r.rank} /><Move n={r.move} size={10} /></div>
            <TeamBadge team={t} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="break-words font-semibold text-white">{t?.gm_name ?? t?.name}</span>
                {r.alive === true && <span className="rounded-full bg-emerald-400/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-400/30">{g.status === 'done' ? 'Won it' : 'Still in'}</span>}
                {out && <span className="rounded-full bg-white/[.06] px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-mute ring-1 ring-white/10">Can’t catch first</span>}
              </div>
              {/* the chip already says "Still in" or "Won it": the line only adds what the chip doesn't */}
              <div className="text-xs text-mute">{r.alive === true && /^(Still in|Won it)$/.test(r.line ?? '') ? null : r.line}{extra?.(r)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`num font-display text-xl font-extrabold ${r.rank === 1 ? 'text-gold' : 'text-white'}`}><BoardScore g={g} v={r.score} /></div>
              {r.possible != null && g.status === 'open' && <div className="text-[11px] text-mute">{fmt(r.possible)} possible</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// each member's chance of finishing first (migrations 175 and 176): a pick'em or Pick the series still open is played
// out a thousand times from the pool's own picks; anything else has none to show yet
export function useChances(g: BoardGame | undefined) {
  const [chances, setChances] = useState<Map<number, number> | null>(null);
  const id = g && (g.kind === 'pickem' || g.kind === 'series') && g.status === 'open' && g.key.startsWith('game:') ? Number(g.key.slice(5)) : null;
  useEffect(() => {
    setChances(null);
    if (!id) return;
    let live = true;
    rpc<{ team_id: number; chance: number }[]>('pool_game_chances', { p_game: id })
      .then((r) => { if (live) setChances(new Map((r ?? []).map((x) => [x.team_id, Number(x.chance)]))); }, () => {});
    return () => { live = false; };
  }, [id]);
  return chances;
}

const pctOf = (x: number) => (x > 0 && x < 0.01 ? '<1%' : x > 0.99 && x < 1 ? '>99%' : `${Math.round(x * 100)}%`);

// the caller's chance beside the favourite's, and every member's as one bar
export function ChanceCard({ g, chances }: { g: BoardGame; chances: Map<number, number> }) {
  const { teams, me } = useLeague();
  const rows = [...chances.entries()].sort((a, b) => b[1] - a[1]);
  const mine = me ? chances.get(me.id) : undefined;
  const [favId, fav] = rows[0] ?? [0, 0];
  const name = (id: number) => { const t = teams.find((x) => x.id === id); return t?.gm_name ?? t?.name ?? ''; };
  const shown = rows.filter(([, c]) => c >= 0.005);
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gold/15"><Dices className="h-5 w-5 text-gold" /></span>
        <div className="min-w-0 flex-1">
          <div className="label">Chance to win</div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            {mine != null ? <span className="font-display text-3xl font-extrabold text-white">{pctOf(mine)}</span> : null}
            <span className="text-sm text-mute">{mine != null ? (favId === me?.id ? 'you’re the favourite' : `${name(favId)} is the favourite at ${pctOf(fav)}`) : `${name(favId)} leads the odds at ${pctOf(fav)}`}</span>
          </div>
        </div>
      </div>
      {/* every member's share of the thousand runs, the favourite first; each part names its member on hover and below */}
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-white/[.06]">
        {shown.map(([id, c], i) => {
          const t = teams.find((x) => x.id === id);
          return <span key={id} title={`${name(id)} ${pctOf(c)}`} className={i ? 'ml-0.5' : ''} style={{ width: `${c * 100}%`, background: id === me?.id ? 'rgb(var(--gold-rgb))' : t?.color ?? 'rgb(148 163 184)', opacity: id === me?.id ? 1 : 0.7 }} />;
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mute">
        {shown.slice(0, 4).map(([id, c]) => <span key={id} className={id === me?.id ? 'font-semibold text-gold' : ''}>{name(id)} {pctOf(c)}</span>)}
        {shown.length > 4 && <span>+{shown.length - 4} more</span>}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-mute">{g.kind === 'series'
        ? `${g.title} played out a thousand times from here: each series game by game from where it stands, its odds from how the pool picked it; a series you haven’t picked yet as a guess.`
        : `The ${g.title.replace(/^The /, '')} played out a thousand times from here: each match drawn from the market’s view where there is one, else from how the pool picked it; a match you haven’t picked as a guess.`}</p>
    </div>
  );
}
