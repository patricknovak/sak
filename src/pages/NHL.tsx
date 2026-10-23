// NHL centre: every game live (the score and the clock are the league's, the same on every page; the goals with their
// clips, the box scores and the three stars come from the NHL's feed), where and whether you can watch each one, team
// radio, which GMs have skin in each game, the NHL standings, the week's schedule, news, injuries, the insiders and the
// leaders. Watch live joined it on 11 October 2026: the scores tab is now where a GM finds tonight's games to watch.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBrand } from '../lib/brand';
import { Link, useSearchParams } from 'react-router-dom';
import { useLeague, useSport } from '../lib/store';
import { hub } from '../lib/nhlhub';
import { fmtPts, fmtTime } from '../lib/format';
import { PageHeader, Section, TeamBadge } from '../components/ui';
import { ExternalLink, Radio, Settings2, Tv, Users } from 'lucide-react';
import { InjuriesTab, LeadersTab, NewsTab, TeamsTab } from '../components/NhlMore';
import { TopTab } from '../components/NhlTop';
import { countryOf, playerFor, verdict } from '../lib/watch';
import { WATCH_GUIDE } from '../lib/watchGuide';
import { rpc, supabase } from '../lib/supabase';
import { isStart } from '../lib/lineupKit';
import { DONE, LIVE, NET, openTab } from '../components/LiveWatch';
import { fmtDay, status, useOverlay, type HubGame as Game, type Scores } from '../lib/nhlGame';
import { MARK, NhlGameCard, TONE, type Stake } from '../components/NhlGameCard';
import { useGameSheet } from '../components/GameSheet';
import { useThreadCounts } from '../components/GameThread';
import type { Player } from '../lib/types';

type Row = { abbrev: string; name: string; common: string; logo: string | null; conf: string; confAbbrev: string; div: string; divAbbrev: string; gp: number; w: number; l: number; otl: number; pts: number; pct: number; row: number; rw: number; gf: number; ga: number; diff: number; home: string; away: string; l10: string; streak: string; clinch: string | null; divRank: number; confRank: number; leagueRank: number; wildcard: number };

export default function NHL() {
  const sport = useSport();
  const brand = useBrand();
  const { me, players, rosters, team, teams, leagueDay, dayPoints, pointsDay, refresh, gamesLive } = useLeague();
  const sheet = useGameSheet();
  const { one } = useOverlay();
  const [params, setParams] = useSearchParams();
  // the insiders' X feed is off for now (23 October 2026); an old ?t=x link opens the news instead
  const tab = ((params.get('t') === 'x' ? 'news' : params.get('t')) as 'top' | 'scores' | 'standings' | 'schedule' | 'news' | 'injuries' | 'leaders' | 'teams') || 'top';
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('t', t); return n; });
  const [date, setDate] = useState(leagueDay);
  const [feed, setFeed] = useState<Scores | null>(null);
  const [standings, setStandings] = useState<{ asOf: string; rows: Row[] } | null>(null);
  const [week, setWeek] = useState<{ prev: string | null; next: string | null; days: { date: string; games: Game[] }[] } | null>(null);
  const [weekDate, setWeekDate] = useState(leagueDay);
  // follow the league day (it holds on last night until its final game ends), unless you've paged elsewhere
  const [lastDay, setLastDay] = useState(leagueDay);
  useEffect(() => {
    if (leagueDay === lastDay) return;
    setDate((d) => (d === lastDay ? leagueDay : d));
    setWeekDate((d) => (d === lastDay ? leagueDay : d));
    setLastDay(leagueDay);
  }, [leagueDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'div' | 'conf' | 'league' | 'wc'>('div');

  // a reply without its games (the feed hiccuped) reads as no games, not a crashed page
  const loadScores = useCallback(async (d: string) => { try { const s = await hub<Scores>('scores', { date: d }); setFeed({ ...s, games: s?.games ?? [] }); setErr(null); } catch (e) { setErr((e as Error).message); } }, []);
  useEffect(() => { if (tab === 'scores') loadScores(date); }, [tab, date, loadScores]);
  // the scores and clocks move with the league's own (every page shows the same); the feed is read again each minute
  // while a game is on for the shots, the goals and the broadcasters, every five minutes otherwise
  const scores = useMemo(() => (feed ? { ...feed, games: feed.games.map(one) } : null), [feed, one]);
  const anyLive = !!scores?.games.some((g) => LIVE.has(g.state));
  useEffect(() => {
    if (tab !== 'scores' || date !== leagueDay) return;
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') loadScores(date); }, anyLive ? 60_000 : 300_000);
    return () => window.clearInterval(i);
  }, [tab, date, anyLive, loadScores]);
  useEffect(() => { if (tab === 'standings' && !standings) hub<{ asOf: string; rows: Row[] }>('standings').then(setStandings, (e) => setErr(e.message)); }, [tab, standings]);
  useEffect(() => { if (tab === 'schedule') hub<typeof week>('schedule', { date: weekDate }).then(setWeek, (e) => setErr(e.message)); }, [tab, weekDate]);

  // every league player by NHL club: whose he is and whether he starts tonight (today's lineup is the live one)
  const byClub = useMemo(() => {
    const m = new Map<string, { p: Player; team_id: number; start: boolean }[]>();
    for (const r of rosters) {
      const p = players.get(r.player_id);
      if (!p?.nhl_team || r.slot === 'IR') continue;
      m.set(p.nhl_team, [...(m.get(p.nhl_team) ?? []), { p, team_id: r.team_id, start: isStart(r.slot) }]);
    }
    return m;
  }, [rosters, players]);
  const stakeOf = useCallback((g: Pick<Game, 'home' | 'away'>): Stake => {
    const all = [...(byClub.get(g.away.abbrev) ?? []), ...(byClub.get(g.home.abbrev) ?? [])];
    const mine = all.filter((x) => x.team_id === me?.id).sort((a, b) => Number(b.start) - Number(a.start) || b.p.proj - a.p.proj);
    const others = new Map<number, number>();
    for (const x of all) if (x.team_id !== me?.id && x.start) others.set(x.team_id, (others.get(x.team_id) ?? 0) + 1);
    return { mine, starters: mine.filter((x) => x.start).length, others: [...others].sort((a, b) => b[1] - a[1]), league: all.filter((x) => x.start).length };
  }, [byClub, me?.id]);
  const gmsIn = (g: Pick<Game, 'home' | 'away'>) => { const s = stakeOf(g); return [...(s.starters ? [[me!.id, s.starters] as [number, number]] : []), ...s.others]; };
  const favOf = (abbrev: string) => teams.filter((t) => t.fav_nhl === abbrev);

  // fantasy points for the day on screen: tonight's are the store's (the same every page shows), another day's read once
  const [oldFp, setOldFp] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    if (tab !== 'scores' || date === pointsDay) return;
    let alive = true;
    supabase.from('league_games').select('player_id,fpts').eq('date', date).limit(2000)
      .then(({ data }) => { if (alive) setOldFp(new Map((data ?? []).map((r) => [r.player_id as number, Number(r.fpts)]))); });
    return () => { alive = false; };
  }, [tab, date, pointsDay]);
  const fp = useMemo(() => (date === pointsDay ? new Map([...dayPoints].map(([id, x]) => [id, x.fpts])) : oldFp), [date, pointsDay, dayPoints, oldFp]);
  const threads = useThreadCounts(tab === 'scores' ? scores?.games.map((g) => g.id) ?? [] : []);

  // the night as Watch live had it: on now, then still to come by how much of your team is in it, then the finals
  const rows = useMemo(() => {
    const out = (scores?.games ?? []).map((g) => ({ g, v: verdict(g.tv, me?.tv), s: stakeOf(g) }));
    const rank = (r: (typeof out)[number]) => (LIVE.has(r.g.state) ? 0 : DONE.has(r.g.state) ? 2 : 1);
    return out.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? a.g.start.localeCompare(b.g.start) : 0) || b.s.starters - a.s.starters || a.g.start.localeCompare(b.g.start));
  }, [scores, me?.tv, stakeOf]);
  const pick = rows.filter((r) => !DONE.has(r.g.state) && r.s.starters > 0).sort((a, b) => b.s.starters - a.s.starters || Number(b.v.state === 'yes' || b.v.state === 'free') - Number(a.v.state === 'yes' || a.v.state === 'free') || b.s.league - a.s.league)[0];
  const [saving, setSaving] = useState(false);
  const haveAll = async (on: boolean) => {
    setSaving(true);
    try { await rpc('set_tv', { p_tv: { ...(me?.tv ?? {}), all: on } }); await refresh(['teams']); } finally { setSaving(false); }
  };

  const standingsView = useMemo(() => {
    if (!standings) return [];
    const rows = standings.rows;
    const by = (k: keyof Row) => [...rows].sort((a, b) => (a[k] as number) - (b[k] as number));
    if (view === 'league') return [{ title: 'NHL', rows: by('leagueRank') }];
    if (view === 'conf') return ['Eastern', 'Western'].map((c) => ({ title: c, rows: by('confRank').filter((r) => r.conf === c) }));
    if (view === 'wc') return ['Eastern', 'Western'].flatMap((c) => {
      const divs = [...new Set(rows.filter((r) => r.conf === c).map((r) => r.div))];
      return [...divs.map((d) => ({ title: `${d} (top 3)`, rows: by('divRank').filter((r) => r.div === d).slice(0, 3) })),
        { title: `${c} wild card`, rows: by('wildcard').filter((r) => r.conf === c && r.wildcard > 0) }];
    });
    const divs = [...new Set(rows.map((r) => r.div))];
    return divs.map((d) => ({ title: d, rows: by('divRank').filter((r) => r.div === d) }));
  }, [standings, view]);

  return (
    <div className="space-y-4">
      <PageHeader icon={<Radio size={22} className="text-goal" />} title={sport.words.centre ?? 'NHL centre'} sub="Every game live, where you can watch it and who in the league has skin in it, then the news, injuries, insiders, standings, leaders, teams and the schedule" />
      <div className="scroll-x flex gap-1">
        {/* the league's own night first: the scoreboard, lit while a game is on */}
        <Link to="/scoreboard" className={`tab flex shrink-0 items-center gap-1.5 ${gamesLive ? 'bg-goal/15 text-white ring-1 ring-goal/40' : 'bg-white/[.05]'}`}>{gamesLive ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-goal" /> : '📡'} {brand.short} tonight</Link>
        {([['top', '🔥 Top'], ['scores', '🏒 Scores'], ['news', '📰 News'], ['injuries', '🩹 Injuries'], ['standings', '🏆 Standings'], ['leaders', '📈 Leaders'], ['teams', '🛡️ Teams'], ['schedule', '📅 Schedule']] as const).map(([k, l]) => <button key={k} className={`tab shrink-0 ${tab === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {err && <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">NHL data didn’t load: {err}</div>}

      {tab === 'scores' && (
        <>
          <div className="flex items-center gap-2">
            <button className="btn-ghost btn-sm" disabled={!scores?.prev} onClick={() => scores?.prev && setDate(scores.prev)}>‹ {scores?.prev ? fmtDay(scores.prev) : ''}</button>
            <div className="flex-1 text-center"><div className="font-bold">{date === leagueDay ? 'Tonight' : fmtDay(date)}</div>{date !== leagueDay ? <button className="text-xs text-sky-300" onClick={() => setDate(leagueDay)}>Back to tonight</button> : <div className="text-[11px] text-mute">{fmtDay(date)}</div>}</div>
            <button className="btn-ghost btn-sm" disabled={!scores?.next} onClick={() => scores?.next && setDate(scores.next)}>{scores?.next ? fmtDay(scores.next) : ''} ›</button>
          </div>
          {scores && scores.games.length > 0 && <WatchHero rows={rows} fp={fp} live={anyLive} saving={saving} onAll={haveAll} />}
          {!scores && !err && <div className="h-40 animate-pulse rounded-3xl bg-white/[.04]" />}
          {scores && scores.games.length === 0 && <div className="card p-6 text-center text-sm text-mute">No NHL games on {fmtDay(date)}.</div>}
          {pick && (
            <Section title="The one to watch">
              <NhlGameCard g={pick.g} v={pick.v} stake={pick.s} fp={fp} talk={threads.get(pick.g.id)} hero />
            </Section>
          )}
          {rows.length > 0 && (
            <Section title={date === leagueDay ? 'Every game tonight' : 'Every game'} right={anyLive ? <span className="text-[11px] text-mute">Live, as it happens</span> : undefined}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{rows.filter((r) => r !== pick).map((r) => <NhlGameCard key={r.g.id} g={r.g} v={r.v} stake={r.s} fp={fp} talk={threads.get(r.g.id)} />)}</div>
              {!me?.tv?.all && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[10px] text-mute">
                {(['yes', 'maybe', 'no'] as const).map((k) => <span key={k}><span className={`mr-1 inline-grid h-4 min-w-4 place-items-center rounded-full px-1 ring-1 ${TONE[k]}`}>{MARK[k]}</span>{{ yes: 'You can watch', maybe: 'Regional, if you’re in the area', no: 'Needs a service you don’t have' }[k]}</span>)}
              </div>}
            </Section>
          )}
          {rows.some((r) => !DONE.has(r.g.state) && (r.s.others.length || r.s.starters)) && (
            <Section title="Where the league has skin in it">
              <div className="card divide-y divide-white/[.05] p-1">
                {teams.filter((t) => t.role !== 'spectator').map((t) => {
                  const in_ = rows.filter((r) => !DONE.has(r.g.state)).map((r) => ({ r, n: t.id === me?.id ? r.s.starters : r.s.others.find(([id]) => id === t.id)?.[1] ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
                  if (!in_.length) return null;
                  return (
                    <div key={t.id} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${t.id === me?.id ? 'bg-gold/[.06]' : ''}`}>
                      <TeamBadge team={t} size={28} />
                      <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white">{t.id === me?.id ? 'You' : t.gm_name}</div>
                        <div className="flex flex-wrap gap-1 pt-0.5">{in_.slice(0, 6).map(({ r, n }) => <button key={r.g.id} type="button" onClick={() => sheet.open(r.g.id, { hint: r.g })} className="num rounded-full bg-white/[.05] px-2 py-px text-[10px] text-slate-300 ring-1 ring-white/10 hover:bg-white/10">{r.g.away.abbrev}-{r.g.home.abbrev} <b className="text-white">{n}</b></button>)}</div></div>
                      <span className="num shrink-0 text-lg font-black text-white">{in_.reduce((k, x) => k + x.n, 0)}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-1.5 px-1 text-[11px] text-mute">Starters each GM has in the games still to finish. Tap a game for its thread, or <Link to="/chat" className="text-sky-300">talk in chat →</Link></p>
            </Section>
          )}
          {scores && <WatchGuide country={countryOf(me?.tv)} />}
        </>
      )}

      {tab === 'standings' && (
        <>
          <div className="scroll-x flex items-center gap-1">
            {([['div', 'Division'], ['conf', 'Conference'], ['wc', 'Wild card'], ['league', 'League']] as const).map(([k, l]) => <button key={k} className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${view === k ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`} onClick={() => setView(k)}>{l}</button>)}
            {standings && <span className="ml-auto shrink-0 text-[11px] text-mute">{standings.asOf === 'now' ? 'Live' : `Final, ${standings.asOf}`}</span>}
          </div>
          {!standings && !err && <div className="p-6 text-center text-sm text-mute">Loading…</div>}
          {standingsView.map((grp) => (
            <Section key={grp.title} title={grp.title}>
              <div className="card overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="text-mute"><tr>{['#', 'Team', 'GP', 'W', 'L', 'OTL', 'PTS', 'P%', 'ROW', 'GF', 'GA', 'DIFF', 'Home', 'Away', 'L10', 'Strk'].map((h, i) => <th key={h} className={`px-2 py-1.5 font-semibold ${i === 1 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-white/[.05]">
                    {grp.rows.map((r, i) => {
                      const favs = favOf(r.abbrev);
                      return (
                        <tr key={r.abbrev} className={i < 3 && (view === 'div' || view === 'wc') ? 'bg-white/[.02]' : ''}>
                          <td className="num px-2 py-1.5 text-right text-mute">{view === 'league' ? r.leagueRank : view === 'conf' ? r.confRank : view === 'wc' && r.wildcard ? `WC${r.wildcard}` : r.divRank}</td>
                          <td className="px-2 py-1.5"><div className="flex items-center gap-1.5 whitespace-nowrap">{r.logo && <img src={r.logo} alt="" className="h-5 w-5" />}<span className="font-semibold">{r.name}</span>{r.clinch && <span className="rounded bg-white/10 px-1 text-[10px]">{r.clinch}</span>}{favs.map((t) => <span key={t.id} title={`${t.gm_name}'s team`}><TeamBadge team={t} size={14} /></span>)}</div></td>
                          {[r.gp, r.w, r.l, r.otl].map((v, k) => <td key={k} className="num px-2 py-1.5 text-right">{v}</td>)}
                          <td className="num px-2 py-1.5 text-right font-bold">{r.pts}</td>
                          <td className="num px-2 py-1.5 text-right">{r.pct.toFixed(3).replace(/^0/, '')}</td>
                          {[r.row, r.gf, r.ga].map((v, k) => <td key={k} className="num px-2 py-1.5 text-right">{v}</td>)}
                          <td className={`num px-2 py-1.5 text-right ${r.diff > 0 ? 'text-emerald-300' : r.diff < 0 ? 'text-red-300' : ''}`}>{r.diff > 0 ? '+' : ''}{r.diff}</td>
                          {[r.home, r.away, r.l10, r.streak].map((v, k) => <td key={k} className="num px-2 py-1.5 text-right">{v}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          ))}
          {standings && <p className="px-1 text-[11px] text-mute">Team badges mark GMs’ favourite NHL teams. x = clinched playoff spot, y = division, z = conference, p = Presidents’ Trophy, e = eliminated.</p>}
        </>
      )}

      {tab === 'schedule' && (
        <>
          <div className="flex items-center gap-2">
            <button className="btn-ghost btn-sm" disabled={!week?.prev} onClick={() => week?.prev && setWeekDate(week.prev)}>‹ Week</button>
            <div className="flex-1 text-center text-sm font-bold">{week?.days[0] ? `${fmtDay(week.days[0].date)} – ${fmtDay(week.days[week.days.length - 1].date)}` : ''}</div>
            <button className="btn-ghost btn-sm" disabled={!week?.next} onClick={() => week?.next && setWeekDate(week.next)}>Week ›</button>
          </div>
          {!week && !err && <div className="p-6 text-center text-sm text-mute">Loading…</div>}
          {week?.days.map((d) => (
            <Section key={d.date} title={`${fmtDay(d.date)} · ${d.games.length} game${d.games.length === 1 ? '' : 's'}`}>
              {d.games.length === 0 ? <div className="card p-3 text-sm text-mute">Off day.</div> : (
                <div className="card divide-y divide-white/[.05]">
                  {d.games.map((g) => {
                    const gms = gmsIn(g);
                    return (
                      <button key={g.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[.03]" onClick={() => sheet.open(g.id, { hint: { ...g, date: d.date } })}>
                        <span className="num w-16 shrink-0 text-xs text-mute">{DONE.has(g.state) || LIVE.has(g.state) ? status(g) : fmtTime(g.start)}</span>
                        {g.away.logo && <img src={g.away.logo} alt="" className="h-5 w-5" />}<span className="font-semibold">{g.away.abbrev}</span>
                        <span className="text-mute">@</span>
                        {g.home.logo && <img src={g.home.logo} alt="" className="h-5 w-5" />}<span className="font-semibold">{g.home.abbrev}</span>
                        {(DONE.has(g.state) || LIVE.has(g.state)) && <span className="num ml-1 font-bold">{g.away.score}-{g.home.score}</span>}
                        <span className="ml-auto flex items-center gap-1 text-[11px] text-mute">{g.tv.slice(0, 2).map((t) => NET[t.network] ?? t.network).join(' · ')}{gms.length > 0 && <span className="ml-1 flex items-center gap-0.5">{gms.slice(0, 4).map(([t]) => <TeamBadge key={t} team={team(t)} size={12} />)}</span>}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Section>
          ))}
        </>
      )}

      {tab === 'top' && <TopTab onGame={(g) => sheet.open(g.id, { hint: g as unknown as Game })} />}
      {tab === 'news' && <NewsTab />}
      {tab === 'injuries' && <InjuriesTab />}
      {tab === 'leaders' && <LeadersTab />}
      {tab === 'teams' && <TeamsTab onGame={(g) => sheet.open(g.id, { hint: g as Game })} />}

    </div>
  );
}

type WatchRow = { g: Game; v: ReturnType<typeof verdict>; s: Stake };

// the night at a glance, from the GM's side of the couch: how many games, how many they can watch on what they have,
// their starters and their points so far, and their TV setup (Watch live's header, 11 October 2026)
function WatchHero({ rows, fp, live, saving, onAll }: { rows: WatchRow[]; fp: Map<number, number>; live: boolean; saving: boolean; onAll: (on: boolean) => void }) {
  const { me } = useLeague();
  const games = rows.length;
  const watchable = rows.filter((r) => r.v.state === 'yes' || r.v.state === 'free').length;
  const mine = rows.reduce((n, r) => n + r.s.starters, 0);
  const pts = rows.reduce((n, r) => n + r.s.mine.reduce((k, x) => k + (fp.get(x.p.id) ?? 0), 0), 0);
  const player = playerFor(me?.tv?.provider);
  const setup = me?.tv?.all || me?.tv?.provider || (me?.tv?.services ?? []).length;
  const country = countryOf(me?.tv);
  return (
    <div className="card-hero overflow-hidden p-4">
      <div className="relative space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {([['Games', String(games), live ? `${rows.filter((r) => LIVE.has(r.g.state)).length} on now` : 'on the slate'], ['You can watch', setup ? String(watchable) : '?', setup ? `of ${games}` : 'set up below'], ['Your starters', String(mine), pts ? `${fmtPts(pts)} pts so far` : 'playing']] as const).map(([k, v, s]) => (
            <div key={k} className="min-w-0 rounded-2xl bg-black/25 px-2.5 py-2 ring-1 ring-white/10">
              <div className="text-[10px] font-bold uppercase leading-tight tracking-[.12em] text-white/60">{k}</div>
              <div className="num text-2xl font-black leading-tight text-white">{v}</div>
              <div className="text-[10px] leading-tight text-white/60">{s}</div>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-2 text-xs leading-snug text-white/80">
          <Tv className="mt-px h-4 w-4 shrink-0 text-gold" />
          {me?.tv?.all ? <span className="min-w-0 flex-1">You have <b className="text-white">every service</b>: every game opens straight in its broadcaster’s player{me.tv.provider ? <> or your <b className="text-white">{me.tv.provider}</b> player</> : ''}.</span>
            : setup ? <span className="min-w-0 flex-1">Watching from {country === 'CA' ? 'Canada 🇨🇦' : 'the US 🇺🇸'}{me?.tv?.provider ? <> with <b className="text-white">{me.tv.provider}</b>{player ? ` (${player.name})` : ''}</> : ''}{(me?.tv?.services ?? []).length ? <> · {(me?.tv?.services ?? []).length} streaming service{(me?.tv?.services ?? []).length === 1 ? '' : 's'}</> : ''}</span>
            : <span className="min-w-0 flex-1">Tell us your TV provider and streaming services, and every game says whether you can watch it.</span>}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {me && <button type="button" disabled={saving} onClick={() => onAll(!me.tv?.all)} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ring-1 ${me.tv?.all ? 'bg-emerald-400/20 text-emerald-100 ring-emerald-400/50' : 'bg-gold text-[#0b1220] ring-gold'}`}>{me.tv?.all ? '✓ I have them all' : 'I have them all'}</button>}
          <Link to="/profile" className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-semibold text-white ring-1 ring-white/15"><Settings2 className="h-3.5 w-3.5" /> {setup ? 'Change' : 'Set up'}</Link>
        </div>
      </div>
    </div>
  );
}

// how to see every game, from the research (docs/WATCH-LIVE.md): the options for where the GM watches from first, folded
// away until asked for
function WatchGuide({ country }: { country: 'CA' | 'US' }) {
  const [c, setC] = useState<'CA' | 'US'>(country);
  useEffect(() => setC(country), [country]);
  const g = WATCH_GUIDE[c];
  if (!WATCH_GUIDE.CA.options.length) return null;
  return (
    <details className="card group overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold text-white"><Tv className="h-4 w-4 text-gold" /> How to see every game <span className="ml-auto text-xs font-normal text-sky-300 group-open:hidden">Open</span></summary>
      <div className="space-y-2 border-t border-white/[.06] p-3">
        <div className="flex gap-1">{(['CA', 'US'] as const).map((k) => <button key={k} type="button" onClick={() => setC(k)} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c === k ? 'bg-gold text-[#0b1220]' : 'bg-white/[.05] text-mute'}`}>{k === 'CA' ? '🇨🇦 Canada' : '🇺🇸 US'}</button>)}</div>
        <p className="px-1 text-xs leading-snug text-slate-300">{g.intro}</p>
        {g.options.map((o) => (
          <div key={o.name} className="rounded-2xl bg-white/[.03] p-3 ring-1 ring-white/[.06]">
            <div className="flex flex-wrap items-start gap-2">
              <span className="text-xl leading-none">{o.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="font-bold text-white">{o.name}</span>{o.tag && <span className="rounded-full bg-gold/15 px-2 py-px text-[10px] font-bold uppercase tracking-wider text-gold ring-1 ring-gold/30">{o.tag}</span>}</div>
                <div className="text-xs font-semibold text-slate-200">{o.price}</div>
                <p className="mt-1 text-xs leading-snug text-mute">{o.covers}</p>
              </div>
              {o.url && <button type="button" onClick={() => openTab(o.url!)} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[.06] px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15">Open <ExternalLink className="h-3 w-3" /></button>}
            </div>
          </div>
        ))}
        {g.together.length > 0 && (
          <div className="rounded-2xl bg-white/[.03] p-3 ring-1 ring-white/[.06]">
            <div className="mb-1 flex items-center gap-1.5 font-bold text-white"><Users className="h-4 w-4 text-gold" /> Watching together</div>
            <ul className="space-y-1 text-xs leading-snug text-mute">{g.together.map((t) => <li key={t}>• {t}</li>)}</ul>
          </div>
        )}
        <p className="px-1 text-[11px] leading-snug text-mute">{g.note}</p>
      </div>
    </details>
  );
}
