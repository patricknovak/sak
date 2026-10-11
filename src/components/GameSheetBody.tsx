// The game sheet's body (GameSheet.tsx holds the provider and loads this the first time a game is opened).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Headphones, Play, Tv } from 'lucide-react';
import { useLeague, useSport } from '../lib/store';
import { hub } from '../lib/nhlhub';
import { supabase } from '../lib/supabase';
import { fmtPts, fmtTime, STAT_LABELS, teamLogo } from '../lib/format';
import { countryOf, verdict, watchOptions } from '../lib/watch';
import { DONE, LIVE, fmtDay, overlay, status, type Detail, type HubGame, type NTeam } from '../lib/nhlGame';
import { NET, Video, WatchBox } from './LiveWatch';
import { Section, Sheet, TeamBadge } from './ui';
import { GameSwings, GameThread, LeagueInGame, useThreadCounts } from './GameThread';
import { GameLines } from './GameLines';
import { GameBook } from './Book';
import { VerdictPill } from './NhlGameCard';
import { useGameSheet, type GameTab } from './GameSheet';
import type { Game as DbGame } from '../lib/types';

// a game the feed hasn't answered for yet, drawn from the games table: enough for the header and the tabs
const club = (abbrev: string, score: number | null): NTeam => ({ id: 0, abbrev, name: abbrev, place: '', score, sog: null, logo: teamLogo(abbrev), radio: null, record: null });
const fromDb = (g: DbGame): HubGame => ({
  id: g.id, date: g.date, type: 2, state: g.state, scheduleState: 'OK', start: g.start_utc, venue: '', period: null, clock: null,
  home: club(g.home, g.home_score), away: club(g.away, g.away_score), outcome: null, tv: [], goals: [], recap: null, condensed: null, link: null,
});

type PG = { player_id: number; nhl_team: string | null; fpts: number; stats: Record<string, number> };

export default function GameSheet({ id, hint, tab: asked, onClose }: { id: number; hint?: HubGame; tab?: GameTab; onClose: () => void }) {
  const { me, games, dayPoints, pointsDay, owner, team, players } = useLeague();
  const brand = useBrandShort();
  const { radio, setRadio } = useGameSheet();
  const db = games.find((g) => g.id === id);
  const [d, setD] = useState<Detail | null>(null);
  const [video, setVideo] = useState<{ id: string; title: string } | null>(null);
  const [side, setSide] = useState<'away' | 'home'>('away');
  const base: HubGame | null = d ?? hint ?? (db ? fromDb(db) : null);
  const x = base ? overlay(base, db) : null;
  const live = !!x && LIVE.has(x.state), done = !!x && DONE.has(x.state);
  const date = x?.date ?? db?.date;
  const threads = useThreadCounts([id]);
  const talk = threads.get(id) ?? 0;
  // the thread first when it was asked for; the game otherwise
  const [tab, setTab] = useState<GameTab>(asked ?? 'game');

  // the feed's game: read when the sheet opens and every 30 seconds while the game is on (the edge caches it, so a
  // league watching the same game costs one call to the function)
  useEffect(() => {
    let alive = true;
    const load = () => hub<Detail>('game', { id: String(id) }).then((r) => { if (alive && r) setD(r); }, () => {});
    load();
    const i = live ? window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000) : 0;
    return () => { alive = false; if (i) window.clearInterval(i); };
  }, [id, live]);

  // fantasy points: tonight's are the store's (the same numbers every page shows); an earlier game is read once
  const [old, setOld] = useState<PG[] | null>(null);
  const tonight = !!date && date === pointsDay;
  useEffect(() => {
    if (tonight) return;
    let alive = true;
    supabase.from('league_games').select('player_id,nhl_team,fpts,stats').eq('game_id', id)
      .then(({ data }) => { if (alive) setOld(((data ?? []) as PG[]).map((r) => ({ ...r, fpts: Number(r.fpts) }))); });
    return () => { alive = false; };
  }, [id, tonight]);
  const rows: PG[] = useMemo(() => (tonight ? [...dayPoints].filter(([, v]) => v.game_id === id).map(([player_id, v]) => ({ player_id, nhl_team: v.nhl_team, fpts: v.fpts, stats: v.stats })) : old ?? []), [tonight, dayPoints, id, old]);
  const fp = useMemo(() => new Map(rows.map((r) => [r.player_id, r.fpts])), [rows]);

  if (!x) return null;
  const v = verdict(x.tv, me?.tv);
  const watch = watchOptions(x.tv, me?.tv);
  const nets = [...new Set(x.tv.filter((t) => t.country === countryOf(me?.tv)).map((t) => NET[t.network] ?? t.network))];
  const ownerOf = (pid: number) => { const o = owner.get(pid); return o ? team(o.team_id) : undefined; };
  const Owner = ({ pid }: { pid: number }) => { const o = ownerOf(pid); return o ? <span title={`${o.gm_name}'s player`} className="ml-1 inline-flex align-middle"><TeamBadge team={o} size={13} /></span> : null; };
  const Name = ({ pid, name }: { pid: number; name: string }) => (players.has(pid) ? <Link to={`/player/${pid}`} className="hover:underline" onClick={onClose}>{name}</Link> : <>{name}</>);
  const box = d?.box?.[side];

  const TABS: [GameTab, string, string][] = [['game', '🏒', 'Game'], ['thread', '💬', 'Thread'], ['box', '📋', 'Box score'], ['more', '📈', 'Lines & bets']];

  return (
    <Sheet open onClose={onClose} wide title={<span className="flex items-center gap-2">{x.away.abbrev} @ {x.home.abbrev} <span className={`text-xs font-normal ${live ? 'text-goal' : 'text-mute'}`}>{status(x)}</span></span>}>
      <div className="space-y-3">
        {/* the score */}
        <div className={`relative overflow-hidden rounded-2xl p-3 ring-1 ${live ? 'bg-gradient-to-b from-goal/[.12] to-white/[.03] ring-goal/30' : 'bg-white/[.04] ring-white/[.06]'}`}>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <TeamSide t={x.away} live={live} done={done} />
            <div className="text-center">
              <div className="num font-display text-4xl font-extrabold leading-none">{x.away.score ?? '–'}<span className="text-mute"> : </span>{x.home.score ?? '–'}</div>
              <div className={`mt-1 text-[11px] font-bold uppercase tracking-wider ${live ? 'text-goal' : 'text-mute'}`}>{live && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-goal align-middle" />}{status(x)}</div>
            </div>
            <TeamSide t={x.home} live={live} done={done} right />
          </div>
          <div className="mt-2 text-center text-[11px] text-mute">{x.venue ? `${x.venue} · ` : ''}{date ? fmtDay(date) : ''} · {fmtTime(x.start)}{x.tv.length > 0 && <> · 📺 {x.tv.map((t) => `${NET[t.network] ?? t.network}${t.country === 'CA' ? ' 🇨🇦' : t.country === 'US' ? ' 🇺🇸' : ''}`).join(', ')}</>}</div>
        </div>

        <div className="grid grid-cols-4 gap-1 rounded-2xl border border-white/[.07] bg-white/[.03] p-1">
          {TABS.map(([k, icon, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
              className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-bold leading-tight transition ${tab === k ? 'bg-white text-ice shadow-[0_6px_18px_-8px_rgba(255,255,255,.6)]' : 'text-slate-300 hover:bg-white/[.05]'}`}>
              <span className="text-base leading-none">{icon}</span>{label}
              {k === 'thread' && talk > 0 && <span className={`num absolute right-1 top-1 rounded-full px-1.5 text-[10px] ${tab === k ? 'bg-black/15' : 'bg-sky-400/25 text-sky-100'}`}>{talk}</span>}
            </button>
          ))}
        </div>

        {tab === 'game' && (
          <div className="space-y-3">
            {/* watch, listen, replay */}
            {!done && x.tv.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><VerdictPill g={x} v={v} /></div>}
            {!done && watch.length > 0 && <WatchBox watch={watch} channels={nets.length ? nets : x.tv.map((t) => NET[t.network] ?? t.network)} sn={x.sn ?? hint?.sn} />}
            <div className="flex flex-wrap gap-1.5">
              {[x.away, x.home].filter((t) => t.radio && !done).map((t) => (
                <button key={t.abbrev} type="button" className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${radio?.url === t.radio ? 'bg-emerald-400/20 text-emerald-100 ring-emerald-400/50' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}
                  onClick={() => setRadio(radio?.url === t.radio ? null : { url: t.radio!, label: t.abbrev })}><Headphones size={14} /> {radio?.url === t.radio ? 'Listening:' : ''} {t.abbrev} radio</button>
              ))}
              {x.recap && <button type="button" className="inline-flex items-center gap-1 rounded-full bg-white/[.06] px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15" onClick={() => setVideo({ id: x.recap!, title: 'Game recap' })}><Play size={14} /> Recap</button>}
              {x.condensed && <button type="button" className="inline-flex items-center gap-1 rounded-full bg-white/[.06] px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15" onClick={() => setVideo({ id: x.condensed!, title: 'Condensed game' })}><Play size={14} /> Condensed game</button>}
              {x.link && <a href={x.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-white/[.04] px-3 py-1.5 text-xs font-semibold text-slate-200 ring-1 ring-white/10"><Tv size={14} /> NHL.com <ExternalLink size={11} /></a>}
            </div>
            {video && <Video id={video.id} title={video.title} onClose={() => setVideo(null)} />}

            <LeagueInGame lines={rows} />
            <GameSwings gameId={id} />
            {talk > 0 && tab === 'game' && <button type="button" onClick={() => setTab('thread')} className="flex w-full items-center gap-2 rounded-2xl bg-white/[.04] px-3 py-2 text-left text-sm ring-1 ring-white/[.07] hover:bg-white/[.06]"><span>💬</span><span className="min-w-0 flex-1 text-slate-200">{talk} {talk === 1 ? 'message' : 'messages'} in the league’s thread for this game</span><span className="text-sky-300">›</span></button>}

            {(d?.scoring?.some((p) => p.goals.length) || x.goals.length > 0) && (
              <Section title="Scoring">
                <div className="card divide-y divide-white/[.05]">
                  {(d?.scoring ?? [{ period: 0, type: 'REG', goals: x.goals }]).flatMap((p) => p.goals.map((gl, i) => (
                    <div key={`${p.period}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                      {gl.mugshot ? <img src={gl.mugshot} alt="" className="h-9 w-9 rounded-full bg-white/10 object-cover" /> : <span className="h-9 w-9 rounded-full bg-white/10" />}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold leading-tight"><Name pid={gl.playerId} name={gl.name} /> <span className="text-xs font-normal text-mute">({gl.goalsToDate})</span><Owner pid={gl.playerId} />{gl.strength !== 'ev' && <span className="ml-1 rounded bg-white/10 px-1 text-[10px] uppercase">{gl.strength}</span>}{gl.modifier && gl.modifier !== 'none' && <span className="ml-1 rounded bg-white/10 px-1 text-[10px]">{gl.modifier.replace(/-/g, ' ')}</span>}</div>
                        <div className="text-xs leading-snug text-mute">{gl.assists.length ? gl.assists.map((a) => `${a.name} (${a.n})`).join(', ') : 'Unassisted'} · {p.period ? (p.type === 'REG' ? `P${p.period}` : p.type) : gl.type === 'REG' ? `P${gl.period}` : gl.type} {gl.time}</div>
                      </div>
                      <span className="num text-xs text-mute">{gl.team}</span>
                      <span className="num w-10 text-right text-sm font-bold">{gl.away}-{gl.home}</span>
                      {gl.clip && <button type="button" className="btn-ghost btn-sm px-2" title="Watch the goal" onClick={() => setVideo({ id: gl.clip!, title: `${gl.name} goal` })}><Play size={14} /></button>}
                    </div>
                  )))}
                </div>
              </Section>
            )}

            {d?.stars && d.stars.length > 0 && (
              <Section title="Three stars">
                <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
                  {d.stars.map((s) => (
                    <div key={s.star} className="card flex items-center gap-2 p-2 text-xs">
                      {s.headshot ? <img src={s.headshot} alt="" className="h-9 w-9 rounded-full bg-white/10 object-cover" /> : null}
                      <div className="min-w-0"><div className="font-semibold leading-tight">{'⭐'.repeat(s.star)} <Name pid={s.playerId} name={s.name} /><Owner pid={s.playerId} /></div><div className="text-mute">{s.team} · {s.pos === 'G' ? `${s.svp != null ? s.svp.toFixed(3).replace(/^0/, '') : ''} SV%, ${s.ga} GA` : `${s.g}G ${s.a}A`}</div></div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {d?.penalties?.some((p) => p.items.length) && (
              <Section title="Penalties">
                <div className="card divide-y divide-white/[.05] text-xs">
                  {d.penalties.flatMap((p) => p.items.map((it, i) => <div key={`${p.period}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5"><span className="num w-14 text-mute">P{p.period} {it.time}</span><span className="w-10 font-semibold">{it.team}</span><span className="min-w-0 flex-1">{it.who}</span><span className="text-mute">{it.desc.replace(/-/g, ' ')} · {it.min} min</span></div>))}
                </div>
              </Section>
            )}
            {!d && !done && !live && <div className="rounded-2xl bg-white/[.03] p-4 text-center text-xs text-mute">The goals, the stars and the box score fill in once the puck drops.</div>}
          </div>
        )}

        {tab === 'thread' && <GameThread game={{ id }} lines={rows} chatOnly />}

        {tab === 'box' && (d?.box ? (
          <Section title="Box score" right={<div className="flex gap-1">{(['away', 'home'] as const).map((s) => <button key={s} type="button" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${side === s ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`} onClick={() => setSide(s)}>{x[s].abbrev}</button>)}</div>}>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="text-mute"><tr><th className="px-2 py-1.5 text-left font-semibold">Skater</th><th className="px-2 text-right font-semibold text-gold" title="Fantasy points in this game">{brand}</th>{['G', 'A', 'P', '+/-', 'PIM', 'SOG', 'HIT', 'BLK', 'TOI'].map((h) => <th key={h} className="px-2 py-1.5 text-right font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-white/[.05]">
                  {box && [...box.forwards, ...box.defense].map((p) => (
                    <tr key={p.id} className={ownerOf(p.id) ? 'bg-sky-500/[.06] text-white' : p.pts > 0 ? 'text-white' : 'text-slate-300'}>
                      <td className="whitespace-nowrap px-2 py-1"><span className="text-mute">{p.pos} {p.num}</span> <Name pid={p.id} name={p.name} /><Owner pid={p.id} /></td>
                      <FpCell v={fp.get(p.id)} />
                      {[p.g, p.a, p.pts, p.pm > 0 ? `+${p.pm}` : p.pm, p.pim, p.sog, p.hit, p.blk, p.toi].map((v, k) => <td key={k} className="num px-2 py-1 text-right">{v}</td>)}
                    </tr>
                  ))}
                </tbody>
                <thead className="text-mute"><tr><th className="px-2 py-1.5 text-left font-semibold">Goalie</th><th className="px-2 text-right font-semibold text-gold">{brand}</th>{['SA', 'SV%', 'GA', 'TOI', 'Dec', '', '', '', ''].map((h, i) => <th key={i} className="px-2 py-1.5 text-right font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-white/[.05]">
                  {box?.goalies.map((p) => (
                    <tr key={p.id} className={ownerOf(p.id) ? 'bg-sky-500/[.06]' : ''}>
                      <td className="whitespace-nowrap px-2 py-1"><span className="text-mute">G {p.num}</span> <Name pid={p.id} name={p.name} /><Owner pid={p.id} />{p.starter ? '' : <span className="ml-1 text-[10px] text-mute">relief</span>}</td>
                      <FpCell v={fp.get(p.id)} />
                      {[p.sa, p.svp != null ? p.svp.toFixed(3).replace(/^0/, '') : '–', p.ga, p.toi, p.decision ?? '', '', '', '', ''].map((v, k) => <td key={k} className="num px-2 py-1 text-right">{v}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-mute">{brand} = fantasy points under this league’s scoring. Shaded players are on a {brand} roster; points move about a minute behind the NHL.</p>
          </Section>
        ) : <LeagueBox rows={rows} away={x.away.abbrev} home={x.home.abbrev} onClose={onClose} />)}

        {tab === 'more' && (
          <div className="space-y-4">
            <Section title="Lines"><GameLines gameId={x.id} date={date} live={live} away={x.away} home={x.home} onOpen={onClose} /></Section>
            <Section title="Bet this game"><GameBook gameId={x.id} away={x.away} home={x.home} /></Section>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function useBrandShort() {
  const { brand } = useLeague();
  return brand.short;
}

function TeamSide({ t, live, done, right }: { t: NTeam; live: boolean; done: boolean; right?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col items-center gap-1 text-center sm:flex-row sm:gap-2 ${right ? 'sm:flex-row-reverse sm:text-right' : 'sm:text-left'}`}>
      {t.logo ? <img src={t.logo} alt="" className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" /> : <span className="h-11 w-11" />}
      <div className="min-w-0">
        <div className="text-sm font-bold leading-tight">{t.place ? <><span className="hidden sm:inline">{t.place} </span>{t.name}</> : t.name}</div>
        <div className="text-[11px] text-mute">{t.sog != null && (live || done) ? `${t.sog} shots` : t.record ?? t.abbrev}</div>
      </div>
    </div>
  );
}

// a player's fantasy points in the box score: gold when he scored, red when he cost points
const FpCell = ({ v }: { v: number | undefined }) => (
  <td className={`num px-2 py-1 text-right font-bold ${v == null ? 'text-mute' : v > 0 ? 'text-gold' : v < 0 ? 'text-red-300' : 'text-slate-400'}`}>{v == null ? '–' : fmtPts(v)}</td>
);

// the box score from the league's own numbers, when the NHL's feed hasn't one to give (the scoring the league counts)
const SKATER = ['g', 'a', 'pm', 'sog', 'hit', 'blk', 'pim', 'ppp'];
const GOALIE = ['sa', 'sv', 'ga', 'w'];
function LeagueBox({ rows, away, home, onClose }: { rows: PG[]; away: string; home: string; onClose: () => void }) {
  const { players, owner, team, brand } = useLeague();
  const sport = useSport();
  if (!rows.length) return <div className="rounded-2xl bg-white/[.03] p-6 text-center text-sm text-mute">No box score yet: it fills in once the puck drops (about a minute behind the NHL).</div>;
  const sides = [away, home].map((abbr) => {
    const mine = rows.filter((r) => r.nhl_team === abbr).map((r) => ({ ...r, p: players.get(r.player_id) }));
    const goalie = (r: (typeof mine)[number]) => r.p?.pos === 'G' || r.stats.sv != null;
    return { abbr, skaters: mine.filter((r) => !goalie(r)).sort((a, b) => b.fpts - a.fpts), goalies: mine.filter(goalie) };
  });
  const owned = (id: number) => { const r = owner.get(id); return r ? team(r.team_id) : undefined; };
  return (
    <div className="space-y-4">
      {sides.map((s) => (
        <div key={s.abbr}>
          <div className="mb-1 flex items-center gap-1.5 font-semibold"><img src={teamLogo(s.abbr)} alt="" className="h-5 w-5" />{s.abbr}</div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-right text-xs">
              <thead className="bg-boards/60 text-mute"><tr><th className="px-2 py-1.5 text-left">{sport.words.skater ?? 'Skater'}</th><th className="px-2 text-gold">{brand.short}</th>{SKATER.map((k) => <th key={k} className="px-1.5">{STAT_LABELS[k]}</th>)}</tr></thead>
              <tbody className="divide-y divide-white/[.05]">{s.skaters.map((r) => <LeagueRow key={r.player_id} r={r} keys={SKATER} t={owned(r.player_id)} onClose={onClose} />)}</tbody>
              {s.goalies.length > 0 && <>
                <thead className="bg-boards/60 text-mute"><tr><th className="px-2 py-1.5 text-left">{sport.words.goalie ?? 'Goalie'}</th><th className="px-2 text-gold">{brand.short}</th>{GOALIE.map((k) => <th key={k} className="px-1.5">{STAT_LABELS[k]}</th>)}<th colSpan={SKATER.length - GOALIE.length} /></tr></thead>
                <tbody className="divide-y divide-white/[.05]">{s.goalies.map((r) => <LeagueRow key={r.player_id} r={r} keys={GOALIE} pad={SKATER.length - GOALIE.length} t={owned(r.player_id)} onClose={onClose} />)}</tbody>
              </>}
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function LeagueRow({ r, keys, pad, t, onClose }: { r: PG & { p?: { name: string } }; keys: string[]; pad?: number; t: ReturnType<ReturnType<typeof useLeague>['team']>; onClose: () => void }) {
  return (
    <tr className={t ? 'bg-sky-500/[.06]' : ''}>
      <td className="max-w-[160px] px-2 py-1 text-left"><Link to={`/player/${r.player_id}`} onClick={onClose} className="hover:underline">{r.p?.name ?? `#${r.player_id}`}</Link>{t && <span className="ml-1 inline-flex align-middle"><TeamBadge team={t} size={13} /></span>}</td>
      <td className={`num px-2 font-semibold ${r.fpts < 0 ? 'text-red-300' : 'text-gold'}`}>{fmtPts(r.fpts, 1)}</td>
      {keys.map((k) => <td key={k} className="num px-1.5">{k === 'pm' && (r.stats[k] ?? 0) > 0 ? '+' : ''}{r.stats[k] ?? 0}</td>)}
      {pad ? <td colSpan={pad} /> : null}
    </tr>
  );
}
