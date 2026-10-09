import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { rpc } from '../lib/supabase';
import { Empty, PageHeader, Section, TeamBadge, useAction } from '../components/ui';
import { Crest } from '../components/Crest';
import type { PoolEvent } from '../lib/poolGames';
import { HostResult, useOverrides } from '../components/HostResult';
import { chance, useMarket } from '../lib/market';

// Last one standing (migrations 157 and 173): every round each player still in picks one side to win, never the same
// one twice; a loss (or a draw, where the sport has them) and they're out, and a round with no pick is out too. The last
// one in wins; whoever is still in when the last round is done shares it. Picks lock at their game's start and settle
// themselves at the final whistle. The words are the sport's: soccer's matchweeks and clubs, the NFL's weeks and teams, a
// tournament's rounds (the Eliminator, migration 212).
interface Club { id: number; name: string; short: string | null; logo: string | null }
interface Fixture { id: number; kickoff: string; state: string; home: Club; away: Club; home_score: number | null; away_score: number | null }
interface Pick { gameweek: number; club_id: number | null; short: string | null; name: string | null; logo: string | null; result: 'through' | 'out' | 'missed' | 'void' | null; locked: boolean }
interface Player { team_id: number; alive: boolean; out_gw: number | null; picks: Pick[] }
export interface Board {
  id: number; competition: string; competition_name: string; start_gw: number; end_gw?: number; status: 'open' | 'done'; winners: number[] | null;
  gameweek: number | null; fixtures: Fixture[]; players: Player[];
  // older copies of the database send none of these: soccer's words
  word?: string; club_word?: string; match_word?: string; draws?: boolean;
}

export function useSurvivor() {
  const [board, setBoard] = useState<Board | null | undefined>(undefined);
  const load = useCallback(async () => {
    const id = await rpc<number | null>('survivor_current').catch(() => null);
    setBoard(id ? await rpc<Board>('survivor_board', { p_survivor: id }).catch(() => null) : null);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { board, reload: load };
}

// the sport's words for a board
function words(b: Board) {
  const W = b.word ?? 'Matchweek';
  const short = ({ Matchweek: 'MW', Week: 'Wk', Round: 'Rd' } as Record<string, string>)[W] ?? W;
  return { W, w: W.toLowerCase(), short, club: b.club_word ?? 'club', match: b.match_word ?? 'match', draws: b.draws ?? true };
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const RESULT = { through: { t: '✓', cls: 'bg-emerald-400/20 text-emerald-200 ring-emerald-400/40' }, out: { t: '✗', cls: 'bg-red-500/20 text-red-200 ring-red-400/40' },
  missed: { t: '–', cls: 'bg-red-500/15 text-red-300 ring-red-400/30' }, void: { t: '↺', cls: 'bg-white/10 text-mute ring-white/15' } } as const;

// the host starts one from the next round of any competition played in rounds the feed carries
export function SurvivorStart({ onStarted }: { onStarted: () => void }) {
  const [events, setEvents] = useState<PoolEvent[]>([]);
  const { busy, run } = useAction();
  useEffect(() => { rpc<PoolEvent[]>('pool_event_list').then((e) => setEvents((e ?? []).filter((x) => x.kinds.includes('survivor'))), () => setEvents([])); }, []);
  if (!events.length) return null;
  return (
    <Section title="Last one standing">
      <div className="card space-y-3 p-4">
        <p className="text-sm text-slate-300">Every round, everyone picks one winner. Never the same side twice; lose once and you&apos;re out. The last one in wins it, and whoever is still in at the end shares it.</p>
        {events.map((e) => (
          <div key={e.competition} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[.04] p-3">
            <Shield className="h-6 w-6 shrink-0 text-gold" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-white">{e.name}</div>
              <div className="text-xs text-mute">{e.open_label} to {e.final_label}{e.next_lock ? ` · first lock ${when(e.next_lock)}` : ''}</div>
            </div>
            <button type="button" className="btn-gold shrink-0" disabled={busy} onClick={() => run(async () => { await rpc('survivor_start', { p_competition: e.competition, p_start_gw: e.open_round }); onStarted(); }, 'Last one standing is on')}>Start it</button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// the card on the pool's home page
export function SurvivorCard() {
  const { me } = useLeague();
  const { board } = useSurvivor();
  if (!board) return null;
  const { w } = words(board);
  const mine = board.players.find((p) => p.team_id === me?.id);
  const alive = board.players.filter((p) => p.alive).length;
  const pick = mine?.picks.find((p) => p.gameweek === board.gameweek);
  const won = board.status === 'done' && board.winners?.includes(me?.id ?? -1);
  return (
    <Link to="/survivor" className="card flex items-center gap-3 p-4 transition hover:border-gold/30">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/15"><Shield className="h-6 w-6 text-gold" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-white">Last one standing</span>
        <span className="block text-xs text-mute">{board.status === 'done' ? (won ? 'You won it 🏆' : 'It’s over') : `${board.competition_name} · ${w} ${board.gameweek ?? '–'} · ${alive} still in`}</span>
      </span>
      {board.status === 'open' && mine && (mine.alive
        ? <span className={`chip shrink-0 ${pick ? 'border-emerald-400/40 text-emerald-200' : 'border-amber-400/40 text-amber-200'}`}>{pick ? `Picked ${pick.short ?? pick.name}` : 'Pick now'}</span>
        : <span className="chip shrink-0 text-mute">Out</span>)}
    </Link>
  );
}

export default function Survivor() {
  const { me, teams } = useLeague();
  const now = useNow(30000);
  const { board, reload } = useSurvivor();
  const { busy, run } = useAction();
  // the host entering this round's pick for a player who asked
  const [actAs, setActAs] = useState<number | null>(null);
  const { overrides, reload: reloadOverrides } = useOverrides((board?.fixtures ?? []).map((f) => f.id));
  // the market's chance for each side: last one standing is a hunt for the safest pick you haven't used
  const market = useMarket((board?.fixtures ?? []).map((f) => f.id));
  if (board === undefined) return <div className="h-60 animate-pulse rounded-3xl bg-white/[.04]" />;
  if (!board) return (
    <div className="space-y-5">
      <PageHeader icon={<Shield className="h-6 w-6 text-gold" />} title="Last one standing" sub="Pick a winner every round. Lose once and you're out." />
      {me?.is_commish ? <SurvivorStart onStarted={reload} /> : <Empty icon="🛡️" title="Not started yet">The host starts it on a competition played in rounds: soccer&apos;s matchweeks, the NFL&apos;s weeks, or a tournament&apos;s rounds as the Eliminator.</Empty>}
    </div>
  );
  const { W, w, short, club, match, draws } = words(board);
  const alive = board.players.filter((p) => p.alive);
  const open = board.status === 'open';
  const proxy = actAs != null ? board.players.find((p) => p.team_id === actAs && p.alive) ?? null : null;
  const proxyName = proxy ? teams.find((t) => t.id === proxy.team_id)?.gm_name ?? 'them' : null;
  const mine = board.players.find((p) => p.team_id === me?.id);
  // whose picks the buttons show: the player the host is picking for, else your own
  const who = proxy ?? mine;
  const used = new Set((who?.picks ?? []).filter((p) => p.club_id && p.result !== 'void' && p.gameweek !== board.gameweek).map((p) => p.club_id));
  const current = who?.picks.find((p) => p.gameweek === board.gameweek);
  const canPick = open && (proxy ? true : !!mine?.alive && me?.role === 'gm');
  const winners = (board.winners ?? []).map((id) => teams.find((t) => t.id === id)?.gm_name).filter(Boolean);
  const pickClub = (c: Club) => run(async () => {
    if (proxy) await rpc('survivor_host_pick', { p_survivor: board.id, p_team: proxy.team_id, p_club: c.id });
    else await rpc('survivor_pick', { p_survivor: board.id, p_club: c.id });
    await reload();
  }, proxy ? `${c.name} for ${proxyName}` : `${c.name} it is`);
  const others = board.players.filter((p) => p.alive && p.team_id !== me?.id);
  return (
    <div className="space-y-5">
      <PageHeader icon={<Shield className="h-6 w-6 text-gold" />} title="Last one standing"
        sub={board.status === 'done' ? `${board.competition_name} · it's over` : `${board.competition_name} · ${w} ${board.gameweek ?? '–'}${board.end_gw ? ` of ${board.end_gw}` : ''} · ${alive.length} of ${board.players.length} still in`} />

      {board.status === 'done' ? (
        <div className="card-hero p-5 text-center"><div className="relative"><div className="text-5xl">🏆</div><div className="h-display text-shine mt-2 text-3xl">{winners.join(' and ') || 'Nobody'}</div><div className="mt-1 text-sm text-white/70">Last one standing</div></div></div>
      ) : proxy ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/[.08] p-4">
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-extrabold text-amber-100">Picking for {proxyName}</div>
            <div className="text-sm text-amber-100/80">Tap a {club} for {W.toLowerCase()} {board.gameweek}. It replaces any pick they made, until its {match} starts, and they hear that you did it.</div>
          </div>
          <button type="button" className="btn-ghost shrink-0" onClick={() => setActAs(null)}>Done</button>
        </div>
      ) : mine && (
        <div className={`rounded-2xl border p-4 ${mine.alive ? 'border-emerald-400/30 bg-emerald-500/[.07]' : 'border-red-400/30 bg-red-500/[.07]'}`}>
          <div className="font-display text-2xl font-extrabold text-white">{mine.alive ? 'You’re in' : 'You’re out'}</div>
          <div className="text-sm text-slate-300">{mine.alive
            ? (current ? `Your pick for ${w} ${board.gameweek}: ${current.name}. You can change it until its ${match} starts.` : `Pick a ${club} to win in ${w} ${board.gameweek}. No pick and you're out.`)
            : `Out in ${w} ${mine.out_gw ?? '–'}. Watch the rest fight it out.`}</div>
        </div>
      )}

      {open && me?.is_commish && !proxy && others.length > 0 && (
        <div className="card p-3">
          <div className="label mb-2">Host · pick for a player who asked</div>
          <div className="flex flex-wrap gap-1.5">
            {others.map((p) => {
              const t = teams.find((x) => x.id === p.team_id);
              return <button key={p.team_id} type="button" onClick={() => setActAs(p.team_id)} className="rounded-full bg-white/[.04] px-3 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/[.08]">{t?.gm_name ?? t?.name}</button>;
            })}
          </div>
        </div>
      )}

      {open && board.fixtures.length > 0 && (
        <Section title={`${W} ${board.gameweek}`}>
          <div className="space-y-2">
            {board.fixtures.map((f) => {
              const locked = new Date(f.kickoff).getTime() <= now || f.state !== 'scheduled';
              const side = (c: Club, where: 'Home' | 'Away') => {
                const on = current?.club_id === c.id, gone = used.has(c.id);
                const mk = market.get(f.id), p = mk ? (where === 'Home' ? mk.home : mk.away) : null;
                return (
                  <button type="button" disabled={!canPick || locked || gone || busy} onClick={() => pickClub(c)}
                    className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition disabled:cursor-default
                      ${on ? 'border-gold bg-gold/15 shadow-[0_0_18px_rgb(var(--gold-rgb)/.25)]' : gone ? 'border-white/[.04] opacity-40' : locked ? 'border-white/[.06] opacity-60' : 'border-white/10 bg-white/[.03] enabled:hover:bg-white/[.07]'}`}>
                    <Crest c={c} size={34} />
                    <span className="text-balance text-sm font-semibold leading-tight text-white">{c.name}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${on ? 'text-gold' : 'text-mute'}`}>{on ? (proxy ? 'Their pick' : 'Your pick') : gone ? 'Used' : where}</span>
                    {p != null && !gone && <span className={`num text-[11px] font-semibold ${p >= 0.7 ? 'text-emerald-300' : 'text-slate-300'}`}>{chance(p)} to win</span>}
                  </button>
                );
              };
              return (
                <div key={f.id} className="card p-2.5">
                  <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-mute">
                    <span>{overrides.has(f.id) ? 'Settled by the host' : f.state === 'final' ? 'Final' : locked ? 'Under way' : when(f.kickoff)}</span>
                    {f.state === 'final' && <b className="num text-sm text-white">{f.home_score} - {f.away_score}</b>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">{side(f.home, 'Home')}{side(f.away, 'Away')}</div>
                  <HostResult fixture={f} home={f.home} away={f.away} override={overrides.get(f.id)} draws={draws} onDone={() => { reload(); reloadOverrides(); }} />
                </div>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-xs text-mute">{draws
            ? `A win after ninety minutes takes you through. A called-off ${match} lets you through and gives you the ${club} back.`
            : `A win takes you through; a tie puts you out. A called-off ${match} lets you through and gives you the ${club} back.`}
            {board.end_gw ? ` It runs to ${w} ${board.end_gw}; whoever is still in then shares it.` : ''}</p>
        </Section>
      )}

      <Section title="The field">
        <div className="card divide-y divide-white/[.05] p-1">
          {board.players.map((p) => {
            const t = teams.find((x) => x.id === p.team_id);
            return (
              <div key={p.team_id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${p.team_id === me?.id ? 'bg-gold/[.06]' : ''} ${p.alive ? '' : 'opacity-60'}`}>
                <TeamBadge team={t} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="break-words font-semibold text-white">{t?.gm_name ?? t?.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.picks.length === 0 && <span className="text-xs text-mute">No picks shown yet</span>}
                    {p.picks.map((k) => (
                      <span key={k.gameweek} title={`${W} ${k.gameweek}`} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ${k.result ? RESULT[k.result].cls : 'bg-white/[.06] text-slate-200 ring-white/15'}`}>
                        {k.club_id && k.logo ? <Crest c={k} size={14} /> : null}{k.club_id ? <>{k.short ?? k.name} {k.result ? RESULT[k.result].t : ''}</> : 'No pick'}
                      </span>
                    ))}
                  </div>
                </div>
                {board.status === 'done' && board.winners?.includes(p.team_id)
                  ? <span className="chip shrink-0 border-gold/50 text-gold">Won</span>
                  : <span className={`chip shrink-0 ${p.alive && open ? 'border-emerald-400/40 text-emerald-200' : 'text-mute'}`}>{p.alive ? (open ? 'In' : 'Out') : `Out · ${short}${p.out_gw ?? ''}`}</span>}
              </div>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-mute">Everyone else&apos;s pick shows once its {match} starts.</p>
      </Section>
    </div>
  );
}
