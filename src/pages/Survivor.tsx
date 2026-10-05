import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { rpc } from '../lib/supabase';
import { Empty, PageHeader, Section, TeamBadge, useAction } from '../components/ui';
import { Crest } from '../components/Crest';

// Last one standing (migration 157): every matchweek each player still in picks one club to win, never the same club
// twice; a draw or a loss and they're out, and a matchweek with no pick is out too. The last one in wins. Picks lock at
// their match's kick-off and settle themselves at the final whistle.
interface Club { id: number; name: string; short: string | null; logo: string | null }
interface Fixture { id: number; kickoff: string; state: string; home: Club; away: Club; home_score: number | null; away_score: number | null }
interface Pick { gameweek: number; club_id: number | null; short: string | null; name: string | null; logo: string | null; result: 'through' | 'out' | 'missed' | 'void' | null; locked: boolean }
interface Player { team_id: number; alive: boolean; out_gw: number | null; picks: Pick[] }
export interface Board { id: number; competition: string; competition_name: string; start_gw: number; status: 'open' | 'done'; winners: number[] | null; gameweek: number | null; fixtures: Fixture[]; players: Player[] }
interface Round { competition: string; name: string; short: string; gameweek: number; first_kickoff: string; matches: number }

export function useSurvivor() {
  const [board, setBoard] = useState<Board | null | undefined>(undefined);
  const load = useCallback(async () => {
    const id = await rpc<number | null>('survivor_current').catch(() => null);
    setBoard(id ? await rpc<Board>('survivor_board', { p_survivor: id }).catch(() => null) : null);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { board, reload: load };
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const RESULT = { through: { t: '✓', cls: 'bg-emerald-400/20 text-emerald-200 ring-emerald-400/40' }, out: { t: '✗', cls: 'bg-red-500/20 text-red-200 ring-red-400/40' },
  missed: { t: '–', cls: 'bg-red-500/15 text-red-300 ring-red-400/30' }, void: { t: '↺', cls: 'bg-white/10 text-mute ring-white/15' } } as const;

// the host starts one from the next matchweek of a competition the feed carries
export function SurvivorStart({ onStarted }: { onStarted: () => void }) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const { busy, run } = useAction();
  useEffect(() => { rpc<Round[]>('soccer_rounds').then(setRounds, () => setRounds([])); }, []);
  if (!rounds.length) return null;
  return (
    <Section title="Last one standing">
      <div className="card space-y-3 p-4">
        <p className="text-sm text-slate-300">Every matchweek, everyone picks one club to win. Never the same club twice; a draw or a loss and you&apos;re out. The last one in wins it.</p>
        {rounds.map((r) => (
          <div key={r.competition} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[.04] p-3">
            <Shield className="h-6 w-6 shrink-0 text-gold" />
            <div className="min-w-0 flex-1"><div className="font-semibold text-white">{r.name}</div><div className="text-xs text-mute">From matchweek {r.gameweek} · first kick-off {when(r.first_kickoff)}</div></div>
            <button type="button" className="btn-gold shrink-0" disabled={busy} onClick={() => run(async () => { await rpc('survivor_start', { p_competition: r.competition, p_start_gw: r.gameweek }); onStarted(); }, 'Last one standing is on')}>Start it</button>
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
  const mine = board.players.find((p) => p.team_id === me?.id);
  const alive = board.players.filter((p) => p.alive).length;
  const pick = mine?.picks.find((p) => p.gameweek === board.gameweek);
  const won = board.status === 'done' && board.winners?.includes(me?.id ?? -1);
  return (
    <Link to="/survivor" className="card flex items-center gap-3 p-4 transition hover:border-gold/30">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/15"><Shield className="h-6 w-6 text-gold" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-white">Last one standing</span>
        <span className="block text-xs text-mute">{board.status === 'done' ? (won ? 'You won it 🏆' : 'It’s over') : `${board.competition_name} · matchweek ${board.gameweek ?? '–'} · ${alive} still in`}</span>
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
  if (board === undefined) return <div className="h-60 animate-pulse rounded-3xl bg-white/[.04]" />;
  if (!board) return (
    <div className="space-y-5">
      <PageHeader icon={<Shield className="h-6 w-6 text-gold" />} title="Last one standing" sub="Pick a winner every matchweek. Lose once and you're out." />
      {me?.is_commish ? <SurvivorStart onStarted={reload} /> : <Empty icon="🛡️" title="Not started yet">The host starts it from a soccer matchweek.</Empty>}
    </div>
  );
  const mine = board.players.find((p) => p.team_id === me?.id);
  const used = new Set((mine?.picks ?? []).filter((p) => p.club_id && p.result !== 'void' && p.gameweek !== board.gameweek).map((p) => p.club_id));
  const current = mine?.picks.find((p) => p.gameweek === board.gameweek);
  const alive = board.players.filter((p) => p.alive);
  const canPick = board.status === 'open' && !!mine?.alive && me?.role === 'gm';
  const winners = (board.winners ?? []).map((id) => teams.find((t) => t.id === id)?.gm_name).filter(Boolean);
  const pickClub = (c: Club) => run(async () => { await rpc('survivor_pick', { p_survivor: board.id, p_club: c.id }); await reload(); }, `${c.name} it is`);
  return (
    <div className="space-y-5">
      <PageHeader icon={<Shield className="h-6 w-6 text-gold" />} title="Last one standing"
        sub={board.status === 'done' ? `${board.competition_name} · it's over` : `${board.competition_name} · matchweek ${board.gameweek ?? '–'} · ${alive.length} of ${board.players.length} still in`} />

      {board.status === 'done' ? (
        <div className="card-hero p-5 text-center"><div className="relative"><div className="text-5xl">🏆</div><div className="h-display text-shine mt-2 text-3xl">{winners.join(' and ') || 'Nobody'}</div><div className="mt-1 text-sm text-white/70">Last one standing</div></div></div>
      ) : mine && (
        <div className={`rounded-2xl border p-4 ${mine.alive ? 'border-emerald-400/30 bg-emerald-500/[.07]' : 'border-red-400/30 bg-red-500/[.07]'}`}>
          <div className="font-display text-2xl font-extrabold text-white">{mine.alive ? 'You’re in' : 'You’re out'}</div>
          <div className="text-sm text-slate-300">{mine.alive
            ? (current ? `Your pick for matchweek ${board.gameweek}: ${current.name}. You can change it until its match kicks off.` : `Pick a club to win in matchweek ${board.gameweek}. No pick and you're out.`)
            : `Out in matchweek ${mine.out_gw ?? '–'}. Watch the rest fight it out.`}</div>
        </div>
      )}

      {board.status === 'open' && board.fixtures.length > 0 && (
        <Section title={`Matchweek ${board.gameweek}`}>
          <div className="space-y-2">
            {board.fixtures.map((f) => {
              const locked = new Date(f.kickoff).getTime() <= now || f.state !== 'scheduled';
              const side = (c: Club, where: 'Home' | 'Away') => {
                const on = current?.club_id === c.id, gone = used.has(c.id);
                return (
                  <button type="button" disabled={!canPick || locked || gone || busy} onClick={() => pickClub(c)}
                    className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition disabled:cursor-default
                      ${on ? 'border-gold bg-gold/15 shadow-[0_0_18px_rgb(var(--gold-rgb)/.25)]' : gone ? 'border-white/[.04] opacity-40' : 'border-white/10 bg-white/[.03] enabled:hover:bg-white/[.07]'}`}>
                    <Crest c={c} size={34} />
                    <span className="text-balance text-sm font-semibold leading-tight text-white">{c.name}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${on ? 'text-gold' : 'text-mute'}`}>{on ? 'Your pick' : gone ? 'Used' : where}</span>
                  </button>
                );
              };
              return (
                <div key={f.id} className="card p-2.5">
                  <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-mute">
                    <span>{f.state === 'final' ? 'Full time' : locked ? 'Kicked off' : when(f.kickoff)}</span>
                    {f.state === 'final' && <b className="num text-sm text-white">{f.home_score} - {f.away_score}</b>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">{side(f.home, 'Home')}{side(f.away, 'Away')}</div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-xs text-mute">A win after ninety minutes takes you through. A called-off match lets you through and gives you the club back.</p>
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
                      <span key={k.gameweek} title={`Matchweek ${k.gameweek}`} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ${k.result ? RESULT[k.result].cls : 'bg-white/[.06] text-slate-200 ring-white/15'}`}>
                        {k.club_id && k.logo ? <Crest c={k} size={14} /> : null}{k.club_id ? <>{k.short ?? k.name} {k.result ? RESULT[k.result].t : ''}</> : 'No pick'}
                      </span>
                    ))}
                  </div>
                </div>
                <span className={`chip shrink-0 ${p.alive ? 'border-emerald-400/40 text-emerald-200' : 'text-mute'}`}>{p.alive ? 'In' : `Out · MW${p.out_gw ?? ''}`}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-mute">Everyone else&apos;s pick shows once its match kicks off.</p>
      </Section>
    </div>
  );
}
