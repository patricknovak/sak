import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { hub } from '../lib/nhlhub';
import { useLeague } from '../lib/store';
import { TeamBadge } from './ui';
import { GameStatusChip } from './GameStatus';

// A game's lines, the way the clubs ice them: four forward lines (LW · C · RW), three defence pairs and the goalies,
// for each club. Worked out by nhl-hub from the NHL's shift charts (who shared the most 5-on-5 time): a game that has
// started shows its own lines, one that hasn't shows each club's lines from its last game. Every card says who owns
// the player in this league (or that he's free), tonight's status, and the GM's own players glow gold.
export interface LinePlayer { id: number; name: string; num: number; pos: string; toi: number; starter?: boolean }
interface ClubLines { from: 'this' | 'last'; ref: { id: number; date: string; opp: string | null }; forwards: (LinePlayer | null)[][]; defense: (LinePlayer | null)[][]; goalies: LinePlayer[]; extras: LinePlayer[] }
interface Lines { away: ClubLines | null; home: ClubLines | null }
type Club = { abbrev: string; name: string; logo: string | null };
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function GameLines({ gameId, date, live, away, home, onOpen }: { gameId: number; date?: string; live: boolean; away: Club; home: Club; onOpen?: () => void }) {
  const { owner, team, players, me } = useLeague();
  const [lines, setLines] = useState<Lines | null>(null);
  const [failed, setFailed] = useState(false);
  const [side, setSide] = useState<'away' | 'home'>('away');
  useEffect(() => {
    setLines(null); setFailed(false);
    let alive = true;
    const load = () => hub<Lines>('lines', { id: String(gameId) }).then((x) => { if (alive) setLines(x); }, () => { if (alive) setFailed(true); });
    load();
    // a live game's lines change as the coach juggles them
    const i = live ? window.setInterval(load, 120_000) : 0;
    return () => { alive = false; if (i) window.clearInterval(i); };
  }, [gameId, live]);

  const club = side === 'away' ? away : home;
  const L = lines?.[side];

  // one player: his number and who owns him on top, his name on its own line (a long name wraps between words, never
  // mid-word), then tonight's status
  const card = (p: LinePlayer | null, k: string, tag?: string) => {
    if (!p) return <div key={k} className="min-h-[62px] rounded-xl border border-dashed border-white/10" />;
    const o = owner.get(p.id);
    const t = o ? team(o.team_id) : undefined;
    const mine = !!me && o?.team_id === me.id;
    const inPool = players.has(p.id);
    const body = (
      <div className={`relative flex h-full min-h-[62px] flex-col rounded-xl border px-2 pb-1.5 pt-1 transition ${mine ? 'border-gold/70 bg-gradient-to-br from-gold/25 to-white/[.03] shadow-[0_0_18px_-6px_rgb(var(--gold-rgb)/.6)]' : 'border-white/10 bg-gradient-to-br from-white/[.09] to-white/[.02]'} ${inPool ? 'hover:border-sky-400/50' : ''}`}>
        <div className="flex items-center justify-between gap-1">
          <span className="font-display text-lg font-extrabold leading-none text-white/80">{p.num}</span>
          {t ? <span title={`${t.gm_name}'s player`} className="inline-flex items-center gap-0.5 rounded-full bg-black/35 py-px pl-px pr-1 text-[9px] font-bold text-slate-200"><TeamBadge team={t} size={13} />{t.abbrev}</span>
            : inPool ? <span title="Free agent in this league" className="rounded-full bg-emerald-500/20 px-1.5 py-px text-[9px] font-bold text-emerald-300">FA</span> : null}
        </div>
        <div className="mt-0.5 text-[13px] font-bold leading-tight text-slate-100 [overflow-wrap:normal]">{p.name}</div>
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
          {tag && <span className="rounded-full bg-sky-500/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-sky-200">{tag}</span>}
          <GameStatusChip id={p.id} date={date} />
        </div>
      </div>
    );
    return inPool ? <Link key={k} to={`/player/${p.id}`} onClick={onOpen} className="block h-full">{body}</Link> : <div key={k} className="h-full">{body}</div>;
  };

  const head = (labels: string[]) => (
    <div className={`grid gap-1.5 text-center text-[11px] font-bold uppercase tracking-[.18em] text-mute ${labels.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>{labels.map((l) => <div key={l}>{l}</div>)}</div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1 rounded-full bg-white/[.05] p-1">
          {(['away', 'home'] as const).map((s) => {
            const c = s === 'away' ? away : home;
            return (
              <button key={s} onClick={() => setSide(s)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition ${side === s ? 'bg-white/15 text-white shadow' : 'text-mute hover:text-slate-200'}`}>
                {c.logo && <img src={c.logo} alt="" className="h-5 w-5" />}{c.abbrev}
              </button>
            );
          })}
        </div>
      </div>
      {!lines && !failed && <div className="card h-40 animate-pulse" />}
      {failed && <div className="card p-3 text-center text-xs text-mute">Lines aren’t available right now.</div>}
      {lines && !L && <div className="card p-3 text-center text-xs text-mute">{club.abbrev} hasn’t played yet this season, so there are no lines to show.</div>}
      {L && (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[.05] to-transparent p-2.5">
          {/* the club's crest, large and faint, behind the lines */}
          {club.logo && <img src={club.logo} alt="" aria-hidden className="pointer-events-none absolute -right-10 top-6 h-64 w-64 opacity-[.07]" />}
          <div className="relative space-y-3">
            <div className="text-[11px] text-mute">
              {L.from === 'this' ? (live ? 'Tonight, as the coach is rolling them (5-on-5 time together so far)' : 'As they played this game (5-on-5 time together)')
                : `As they lined up last game, ${fmtDay(L.ref.date)} ${L.ref.opp ?? ''}`.trim() + ' · from the NHL’s shift charts'}
            </div>
            <div className="space-y-1.5">
              {head(['LW', 'C', 'RW'])}
              {L.forwards.map((line, i) => <div key={i} className="grid grid-cols-3 gap-1.5">{line.map((p, j) => card(p, `f${i}${j}`))}</div>)}
            </div>
            <div className="space-y-1.5">
              {head(['LD', 'RD'])}
              {L.defense.map((pair, i) => <div key={i} className="grid grid-cols-2 gap-1.5">{pair.map((p, j) => card(p, `d${i}${j}`))}</div>)}
            </div>
            {L.goalies.length > 0 && (
              <div className="space-y-1.5">
                {head(['Goalies'])}
                <div className="grid grid-cols-2 gap-1.5">{L.goalies.slice(0, 2).map((g, i) => card(g, `g${i}`, g.starter ? (L.from === 'this' ? 'Started' : 'Started last game') : undefined))}</div>
              </div>
            )}
            {L.extras.length > 0 && <div className="text-[11px] text-mute">Also dressed: {L.extras.map((p) => `#${p.num} ${p.name}`).join(', ')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
