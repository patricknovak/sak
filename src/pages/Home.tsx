import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { realtimeChannel, supabase } from '../lib/supabase';
import type { Bet, Message, Trade } from '../lib/types';
import { ago, fmtDateTime, fmtPts, ordinal, etToday, readable } from '../lib/format';
import { Countdown, Rank, Section, Stat, TeamBadge, TeamName, TeamStack } from '../components/ui';
import { ArrowRight, ClipboardList, Lock, Megaphone, MessageCircle, Radio, Trophy } from 'lucide-react';
import { PlayerRow, usePlayerSheet } from '../components/PlayerCard';
import { SEASONS } from '../data/history';
import { PushCard } from '../components/PushCard';

export default function Home() {
  const { me, league, teams, team, standings, rosters, players, draft, picks, gamesByTeam, online } = useLeague();
  const now = useNow(1000);
  const nav = useNavigate();
  const { open, sheet } = usePlayerSheet();
  const [feed, setFeed] = useState<Message[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [todayPts, setTodayPts] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    const load = () => {
      supabase.from('messages').select('*').eq('channel', 'general').order('id', { ascending: false }).limit(8).then(({ data }) => setFeed((data ?? []) as Message[]));
      supabase.from('bets').select('*').in('status', ['open', 'accepted']).order('id', { ascending: false }).then(({ data }) => setBets((data ?? []) as Bet[]));
      supabase.from('trades').select('*').in('status', ['proposed', 'accepted']).then(({ data }) => setTrades((data ?? []) as Trade[]));
    };
    load();
    const ch = realtimeChannel('home-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'channel=eq.general' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // today's live fantasy points per player
  useEffect(() => {
    if (league?.phase !== 'season') return;
    const load = () => supabase.from('player_games').select('player_id,fpts').eq('date', etToday())
      .then(({ data }) => setTodayPts(new Map((data ?? []).map((r) => [r.player_id, Number(r.fpts)]))));
    load();
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [league?.phase]);

  const table = useMemo(() => [...standings].sort((a, b) => a.rank - b.rank), [standings]);
  const mine = standings.find((s) => s.team_id === me?.id);
  const leader = table[0];
  const myStarters = rosters.filter((r) => r.team_id === me?.id && !['BN', 'IR'].includes(r.slot))
    .map((r) => ({ r, p: players.get(r.player_id)! })).filter((x) => x.p);
  const playingTonight = myStarters.filter((x) => gamesByTeam(x.p.nhl_team));
  const benchedPlaying = rosters.filter((r) => r.team_id === me?.id && r.slot === 'BN')
    .map((r) => players.get(r.player_id)!).filter((p) => p && gamesByTeam(p.nhl_team));
  const current = picks.find((p) => p.overall === draft?.current_overall && p.season === draft?.season);
  const myPicks = picks.filter((p) => p.team_id === me?.id && p.season === draft?.season && p.overall && !p.player_id).sort((a, b) => a.overall! - b.overall!);
  const lastChamp = SEASONS[0].rows[0];

  const phase = league?.phase;
  const myBets = bets.filter((b) => b.creator_team === me?.id || b.opponent_team === me?.id || (b.status === 'open' && !b.opponent_team));
  const myTrades = trades.filter((t) => t.to_team === me?.id || t.from_team === me?.id || (me?.is_commish && t.status === 'accepted'));

  const lastRows = SEASONS[0].rows;
  const top = phase === 'season' ? Math.max(1, ...table.map((s) => Number(s.points))) : Math.max(1, ...lastRows.map((r) => r.points));
  const onlineTeams = teams.filter((t) => online.has(t.id));
  const More = ({ to, label }: { to: string; label: string }) => <Link to={to} className="flex items-center gap-1 text-xs font-semibold text-sky-300">{label}<ArrowRight size={13} /></Link>;

  return (
    <div className="stagger space-y-5">
      {/* hero */}
      <div className="card-hero p-4 sm:p-6" style={{ '--tc': me?.color } as React.CSSProperties}>
        <div className="pointer-events-none absolute -right-6 -top-8 select-none text-[160px] leading-none opacity-[.09] sm:text-[220px]">{me?.emoji}</div>
        <div className="relative flex items-center gap-3.5">
          <TeamBadge team={me ?? undefined} size={60} ring />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white/70">Welcome back, {me?.gm_name}</div>
            <div className="h-display text-shine truncate text-[30px] leading-[1.05] sm:text-4xl">{me?.name}</div>
            {me?.motto && <div className="truncate text-xs italic text-white/70">“{me.motto}”</div>}
          </div>
        </div>

        <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
          {phase === 'keepers' && (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3.5 backdrop-blur">
              <div className="label flex items-center gap-1.5 text-white/70"><Lock size={12} /> Keeper deadline</div>
              <div className="mt-2">{league?.keeper_deadline ? <Countdown ms={new Date(league.keeper_deadline).getTime() - now} size="md" /> : <span className="h-display text-2xl">TBD</span>}</div>
              <div className="mt-1 text-xs text-white/60">{league?.keeper_deadline && fmtDateTime(league.keeper_deadline)} · keep up to {league?.keepers}</div>
              <Link to="/keepers" className={`mt-3 w-full ${me?.keepers_submitted ? 'btn-ghost' : 'btn-primary pulse-ring'}`}>
                {me?.keepers_submitted ? '✅ Keepers set · edit' : '🔒 Pick your keepers'}
              </Link>
            </div>
          )}
          {(phase === 'predraft' || (phase === 'keepers' && league?.draft_at)) && draft?.status === 'scheduled' && (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3.5 backdrop-blur">
              <div className="label flex items-center gap-1.5 text-white/70"><ClipboardList size={12} /> Draft night</div>
              <div className="mt-2">{league?.draft_at ? <Countdown ms={new Date(league.draft_at).getTime() - now} size="md" /> : <span className="h-display text-2xl">TBD</span>}</div>
              <div className="mt-1 text-xs text-white/60">{league?.draft_at && fmtDateTime(league.draft_at)} · {league?.pick_seconds}s clock · {league?.draft_rounds} rounds</div>
              <Link to="/draft" className="btn-blue mt-3 w-full">📋 Enter the draft room</Link>
            </div>
          )}
          {(draft?.status === 'live' || draft?.status === 'paused') && (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3.5 backdrop-blur sm:col-span-2">
              <div className="label flex items-center gap-1.5 text-white/70"><Radio size={12} className="text-goal" /> {draft.status === 'paused' ? 'Draft paused' : 'Live: on the clock'}</div>
              <div className="mt-2 flex items-center gap-2 text-xl font-bold"><TeamBadge team={team(current?.team_id)} size={32} /><TeamName team={team(current?.team_id)} /></div>
              <div className="mt-1 text-xs text-white/60">Pick #{current?.overall} · your next: {myPicks[0] ? `#${myPicks[0].overall}` : '—'}</div>
              <Link to="/draft" className="btn-primary pulse-ring mt-3 w-full">Enter the draft room</Link>
            </div>
          )}
          {phase === 'season' && mine && (
            <div className="grid grid-cols-3 gap-2 sm:col-span-2">
              <Stat label="Rank" value={ordinal(mine.rank)} sub={`of ${teams.length}`} />
              <Stat label="Points" value={fmtPts(mine.points)} sub={leader && leader.team_id !== me?.id ? `${fmtPts(leader.points - mine.points)} back` : 'Leading 👑'} />
              <Stat label="Today" value={fmtPts(myStarters.reduce((t, x) => t + (todayPts.get(x.p.id) ?? 0), 0))} sub={`${playingTonight.length} playing`} />
            </div>
          )}
        </div>

        {onlineTeams.length > 0 && (
          <div className="relative mt-4 flex items-center gap-2 text-xs text-white/70">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.9)]" />
            <TeamStack teams={onlineTeams} size={22} />
            <span>{onlineTeams.length === 1 ? 'Just you in the barn' : `${onlineTeams.length} GMs in the barn`}</span>
          </div>
        )}
      </div>

      <PushCard hideWhenOn compact />

      {league?.commish_note && (
        <div className="card relative overflow-hidden border-amber-400/30 p-4" style={{ background: 'linear-gradient(135deg, rgba(247,197,72,.16), rgba(15,23,41,.8) 60%)' }}>
          <div className="label flex items-center gap-1.5 text-amber-300"><Megaphone size={13} /> From the commish</div>
          <p className="mt-1.5 whitespace-pre-wrap text-[15px]">{league.commish_note}</p>
        </div>
      )}

      {(myTrades.length > 0 || myBets.some((b) => b.status === 'open' && b.opponent_team === me?.id)) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {myTrades.map((t) => (
            <button key={t.id} onClick={() => nav('/trades')} className="card flex items-center gap-3 p-3 text-left transition active:scale-[.98]">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-400/15 text-xl ring-1 ring-sky-400/30">🔄</span>
              <div className="text-sm">
                {t.to_team === me?.id && t.status === 'proposed' ? <><TeamName team={team(t.from_team)} /> sent you a trade offer</>
                  : t.status === 'accepted' ? <>Trade awaiting commish review: <TeamName team={team(t.from_team)} /> ↔ <TeamName team={team(t.to_team)} /></>
                  : <>Your offer to <TeamName team={team(t.to_team)} /> is pending</>}
              </div>
            </button>
          ))}
          {myBets.filter((b) => b.status === 'open' && b.opponent_team === me?.id).map((b) => (
            <button key={b.id} onClick={() => nav('/bets')} className="card flex items-center gap-3 p-3 text-left transition active:scale-[.98]">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400/15 text-xl ring-1 ring-emerald-400/30">🎲</span>
              <div className="text-sm"><TeamName team={team(b.creator_team)} /> challenged you: <span className="font-semibold">{b.title}</span></div>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section icon={<Trophy size={17} className="text-gold" />} title={phase === 'season' ? 'Standings' : `${SEASONS[0].season} final standings`} right={<More to="/standings" label="All" />}>
          <div className="card divide-y divide-white/[.06] overflow-hidden">
            {phase === 'season'
              ? table.map((s) => {
                const t = team(s.team_id);
                return (
                  <Link key={s.team_id} to={`/team/${s.team_id}`} className={`relative flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/[.03] ${s.team_id === me?.id ? 'bg-white/[.05]' : ''}`}>
                    <Rank n={s.rank} />
                    <TeamBadge team={t} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{t?.name}</div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full" style={{ width: `${(Number(s.points) / top) * 100}%`, background: `linear-gradient(90deg, ${readable(t?.color ?? '#4cc3ff')}, color-mix(in oklab, ${readable(t?.color ?? '#4cc3ff')} 60%, white))` }} /></div>
                    </div>
                    <div className="text-right"><div className="num font-display text-lg font-extrabold">{fmtPts(s.points)}</div>
                      {s.today > 0 && <div className="num text-[11px] font-semibold text-emerald-400">+{fmtPts(s.today)} today</div>}</div>
                  </Link>
                );
              })
              : lastRows.map((r, i) => {
                const t = teams.find((x) => x.name === r.team);
                return (
                  <div key={r.team} className="flex items-center gap-3 px-3 py-2.5">
                    <Rank n={i + 1} />
                    {t ? <TeamBadge team={t} size={30} /> : <div className="h-[30px] w-[30px]" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{r.team} {i === 0 && '🏆'} {r.peter && '🪣'}</div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full" style={{ width: `${(r.points / top) * 100}%`, background: t ? `linear-gradient(90deg, ${readable(t.color)}, color-mix(in oklab, ${readable(t.color)} 60%, white))` : '#4cc3ff' }} /></div>
                    </div>
                    <div className="num font-display text-lg font-extrabold">{fmtPts(r.points, 2)}</div>
                  </div>
                );
              })}
          </div>
          {phase !== 'season' && <p className="mt-2 px-1 text-xs text-mute">Defending champ: <span className="font-semibold text-gold">{lastChamp.team}</span> ({lastChamp.gm}). The Peter: {lastRows[lastRows.length - 1]?.team}.</p>}
        </Section>

        <div className="space-y-5">
          {phase === 'season' && (
            <Section title="Tonight" right={<More to="/team" label="Lineup" />}>
              <div className="card divide-y divide-white/[.06]">
                {playingTonight.length === 0 && <div className="p-4 text-sm text-mute">None of your starters play today.</div>}
                {playingTonight.map(({ r, p }) => (
                  <div key={p.id} className="px-3 py-2">
                    <PlayerRow p={p} onClick={() => open(p.id)} right={<div className="text-right"><div className="text-[10px] text-mute">{r.slot}</div><div className="num font-bold">{fmtPts(todayPts.get(p.id) ?? 0, 1)}</div></div>} />
                  </div>
                ))}
                {benchedPlaying.length > 0 && (
                  <Link to="/team" className="block bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    ⚠️ {benchedPlaying.length} benched player{benchedPlaying.length > 1 ? 's have' : ' has'} a game today: {benchedPlaying.slice(0, 3).map((p) => p.last_name).join(', ')}
                  </Link>
                )}
              </div>
            </Section>
          )}

          <Section icon={<MessageCircle size={17} className="text-blue" />} title="League wire" right={<More to="/chat" label="Chat" />}>
            <div className="card space-y-1 p-2">
              {feed.length === 0 && <div className="p-3 text-sm text-mute">Quiet in here. Someone chirp somebody.</div>}
              {feed.map((m) => (
                <Link to="/chat" key={m.id} className="flex items-start gap-2.5 rounded-xl px-2 py-2 transition hover:bg-white/[.04]">
                  {m.kind === 'system' ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.06] text-sm">📢</span>
                    : m.kind === 'bot' ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-800 text-sm shadow-[0_4px_14px_-4px_rgba(52,211,153,.8)]">🎙️</span>
                    : <TeamBadge team={team(m.team_id)} size={32} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 text-[11px]">
                      <span className={`font-bold ${m.kind === 'bot' ? 'text-emerald-300' : 'text-slate-200'}`}>{m.kind === 'bot' ? 'Garry' : m.kind === 'system' ? 'League' : team(m.team_id)?.gm_name}</span>
                      <span className="text-mute">{ago(m.created_at, now)}</span>
                    </div>
                    <div className={`line-clamp-2 whitespace-pre-line text-sm ${m.kind === 'system' ? 'text-slate-300' : 'text-slate-100'}`}>{m.body}</div>
                  </div>
                </Link>
              ))}
            </div>
          </Section>

          {myBets.filter((b) => b.status === 'accepted').length > 0 && (
            <Section title="Your action" right={<More to="/bets" label="Bets" />}>
              <div className="card divide-y divide-white/[.06]">
                {myBets.filter((b) => b.status === 'accepted').map((b) => (
                  <Link to="/bets" key={b.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                    <span>🎲</span><span className="flex-1 truncate font-medium">{b.title}</span>
                    <span className="text-xs text-mute">vs {team(b.creator_team === me?.id ? b.opponent_team : b.creator_team)?.gm_name}</span>
                  </Link>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
      {sheet}
    </div>
  );
}
