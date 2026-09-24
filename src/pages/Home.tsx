import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { Bet, Message, Trade } from '../lib/types';
import { ago, countdown, fmtDateTime, fmtPts, ordinal } from '../lib/format';
import { Section, Stat, TeamBadge, TeamName } from '../components/ui';
import { PlayerRow, usePlayerSheet } from '../components/PlayerCard';
import { SEASONS } from '../data/history';

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
    const ch = supabase.channel('home-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'channel=eq.general' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // today's live fantasy points per player
  useEffect(() => {
    if (league?.phase !== 'season') return;
    const load = () => supabase.from('player_games').select('player_id,fpts').eq('date', new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))
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

  return (
    <div className="space-y-5">
      {/* hero */}
      <div className="card relative overflow-hidden p-4 sm:p-5" style={{ background: `linear-gradient(135deg, ${me?.color}44, #111a2e 55%)` }}>
        <div className="flex items-center gap-3">
          <TeamBadge team={me ?? undefined} size={56} />
          <div className="min-w-0">
            <div className="text-xs text-mute">Welcome back, {me?.gm_name}</div>
            <div className="h-display truncate text-2xl leading-tight">{me?.name}</div>
            {me?.motto && <div className="truncate text-xs italic text-slate-300">“{me.motto}”</div>}
          </div>
        </div>

        {phase === 'keepers' && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="label">Keeper deadline</div>
              <div className="font-display text-3xl font-bold">{league?.keeper_deadline ? countdown(new Date(league.keeper_deadline).getTime() - now) : 'TBD'}</div>
              <div className="text-xs text-mute">{league?.keeper_deadline && fmtDateTime(league.keeper_deadline)} · keep up to {league?.keepers}</div>
            </div>
            <Link to="/keepers" className={me?.keepers_submitted ? 'btn-ghost' : 'btn-primary pulse-ring'}>
              {me?.keepers_submitted ? '✅ Keepers set · edit' : '🔒 Pick your keepers'}
            </Link>
          </div>
        )}
        {(phase === 'predraft' || (phase === 'keepers' && league?.draft_at)) && draft?.status === 'scheduled' && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="label">Draft night</div>
              <div className="font-display text-3xl font-bold">{league?.draft_at ? countdown(new Date(league.draft_at).getTime() - now) : 'TBD'}</div>
              <div className="text-xs text-mute">{league?.draft_at && fmtDateTime(league.draft_at)} · {league?.pick_seconds}s per pick · {league?.draft_rounds} rounds</div>
            </div>
            <Link to="/draft" className="btn-blue">📋 Draft room</Link>
          </div>
        )}
        {draft?.status === 'live' || draft?.status === 'paused' ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="label">{draft.status === 'paused' ? 'Draft paused' : 'On the clock'}</div>
              <div className="flex items-center gap-2 text-lg font-semibold"><TeamBadge team={team(current?.team_id)} size={24} /><TeamName team={team(current?.team_id)} /></div>
              <div className="text-xs text-mute">Pick #{current?.overall} · your next: {myPicks[0] ? `#${myPicks[0].overall}` : '—'}</div>
            </div>
            <Link to="/draft" className="btn-primary pulse-ring">Enter draft room</Link>
          </div>
        ) : null}
        {phase === 'season' && mine && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="Rank" value={ordinal(mine.rank)} sub={`of ${teams.length}`} />
            <Stat label="Points" value={fmtPts(mine.points)} sub={leader && leader.team_id !== me?.id ? `${fmtPts(leader.points - mine.points)} back` : 'Leading 👑'} />
            <Stat label="Today" value={fmtPts(myStarters.reduce((t, x) => t + (todayPts.get(x.p.id) ?? 0), 0))} sub={`${playingTonight.length} playing`} />
          </div>
        )}
      </div>

      {league?.commish_note && (
        <div className="card border-amber-500/40 bg-amber-500/10 p-4">
          <div className="label text-amber-300">📣 From the commish</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{league.commish_note}</p>
        </div>
      )}

      {(myTrades.length > 0 || myBets.some((b) => b.status === 'open' && b.opponent_team === me?.id)) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {myTrades.map((t) => (
            <button key={t.id} onClick={() => nav('/trades')} className="card flex items-center gap-3 p-3 text-left">
              <span className="text-2xl">🔄</span>
              <div className="text-sm">
                {t.to_team === me?.id && t.status === 'proposed' ? <><TeamName team={team(t.from_team)} /> sent you a trade offer</>
                  : t.status === 'accepted' ? <>Trade awaiting commish review: <TeamName team={team(t.from_team)} /> ↔ <TeamName team={team(t.to_team)} /></>
                  : <>Your offer to <TeamName team={team(t.to_team)} /> is pending</>}
              </div>
            </button>
          ))}
          {myBets.filter((b) => b.status === 'open' && b.opponent_team === me?.id).map((b) => (
            <button key={b.id} onClick={() => nav('/bets')} className="card flex items-center gap-3 p-3 text-left">
              <span className="text-2xl">🎲</span>
              <div className="text-sm"><TeamName team={team(b.creator_team)} /> challenged you: <span className="font-semibold">{b.title}</span></div>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={phase === 'season' ? 'Standings' : `${SEASONS[0].season} final standings`} right={<Link to="/standings" className="text-xs text-sky-300">All →</Link>}>
          <div className="card divide-y divide-line">
            {phase === 'season'
              ? table.map((s) => (
                <Link key={s.team_id} to={`/team/${s.team_id}`} className={`flex items-center gap-3 px-3 py-2.5 ${s.team_id === me?.id ? 'bg-white/5' : ''}`}>
                  <span className="w-5 text-center font-display text-lg text-mute">{s.rank}</span>
                  <TeamBadge team={team(s.team_id)} size={28} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{team(s.team_id)?.name}</div>
                    <div className="text-[11px] text-mute">{team(s.team_id)?.gm_name}{online.has(s.team_id) && <span className="ml-1 text-emerald-400">● online</span>}</div></div>
                  <div className="text-right"><div className="font-display text-lg font-bold">{fmtPts(s.points)}</div>
                    {s.today > 0 && <div className="text-[11px] text-emerald-400">+{fmtPts(s.today)} today</div>}</div>
                </Link>
              ))
              : SEASONS[0].rows.map((r, i) => (
                <div key={r.team} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="w-5 text-center font-display text-lg text-mute">{i + 1}</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{r.team} {i === 0 && '🏆'} {r.peter && '🪣'}</div><div className="text-[11px] text-mute">{r.gm}</div></div>
                  <div className="font-display text-lg font-bold">{fmtPts(r.points, 2)}</div>
                </div>
              ))}
          </div>
          {phase !== 'season' && <p className="mt-2 px-1 text-xs text-mute">Defending champ: {lastChamp.team} ({lastChamp.gm}). The Peter: {SEASONS[0].rows.at(-1)?.team}.</p>}
        </Section>

        <div className="space-y-5">
          {phase === 'season' && (
            <Section title="Tonight" right={<Link to="/team" className="text-xs text-sky-300">Lineup →</Link>}>
              <div className="card divide-y divide-line">
                {playingTonight.length === 0 && <div className="p-4 text-sm text-mute">None of your starters play today.</div>}
                {playingTonight.map(({ r, p }) => (
                  <div key={p.id} className="px-3 py-2">
                    <PlayerRow p={p} onClick={() => open(p.id)} right={<div className="text-right"><div className="text-[10px] text-mute">{r.slot}</div><div className="font-semibold">{fmtPts(todayPts.get(p.id) ?? 0, 1)}</div></div>} />
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

          <Section title="League wire" right={<Link to="/chat" className="text-xs text-sky-300">Chat →</Link>}>
            <div className="card divide-y divide-line">
              {feed.length === 0 && <div className="p-4 text-sm text-mute">Quiet in here. Someone chirp somebody.</div>}
              {feed.map((m) => (
                <Link to="/chat" key={m.id} className="flex items-start gap-2.5 px-3 py-2.5">
                  {m.kind === 'system' ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-boards text-sm">📢</span> : <TeamBadge team={team(m.team_id)} size={28} />}
                  <div className="min-w-0 flex-1">
                    <div className={`line-clamp-2 whitespace-pre-line text-sm ${m.kind === 'system' ? 'text-slate-300' : ''}`}>
                      {m.kind === 'user' && <span className="font-semibold">{team(m.team_id)?.gm_name}: </span>}{m.body}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-mute">{ago(m.created_at, now)}</span>
                </Link>
              ))}
            </div>
          </Section>

          {myBets.filter((b) => b.status === 'accepted').length > 0 && (
            <Section title="Your action" right={<Link to="/bets" className="text-xs text-sky-300">Bets →</Link>}>
              <div className="card divide-y divide-line">
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

      <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-mute">
        <span>Online now:</span>
        {teams.filter((t) => online.has(t.id)).map((t) => <span key={t.id} className="flex items-center gap-1"><TeamBadge team={t} size={18} />{t.gm_name}</span>)}
      </div>
      {sheet}
    </div>
  );
}
