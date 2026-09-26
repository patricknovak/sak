// NHL hub: every game live (scores, clock, goals with highlight clips, box scores, three stars), the NHL
// standings, the week's schedule, where to watch, team radio to listen live, and which SaK GMs have
// skin in each game.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { etToday, fmtTime } from '../lib/format';
import { PageHeader, Section, Sheet, TeamBadge } from '../components/ui';
import { ExternalLink, Headphones, Play, Radio, Tv } from 'lucide-react';

type NTeam = { id: number; abbrev: string; name: string; place: string; score: number | null; sog: number | null; logo: string | null; radio: string | null; record: string | null };
type Goal = { period: number; type?: string; time: string; playerId: number; name: string; team: string; strength: string; modifier: string; goalsToDate: number; away: number; home: number; mugshot: string | null; assists: { playerId: number; name: string; n: number }[]; clip: string | null };
type Game = { id: number; date?: string; type: number; state: string; scheduleState: string; start: string; venue: string; period: { n: number; type: string } | null; clock: { time: string; running: boolean; intermission: boolean } | null; home: NTeam; away: NTeam; outcome: string | null; tv: { network: string; market: string; country: string }[]; goals: Goal[]; recap: string | null; condensed: string | null; link: string | null };
type Skater = { id: number; num: number; name: string; pos: string; g: number; a: number; pts: number; pm: number; pim: number; sog: number; hit: number; blk: number; toi: string; fo: number };
type Goalie = { id: number; num: number; name: string; pos: 'G'; sa: string; svp: number | null; ga: number; toi: string; decision: string | null; starter: boolean };
type Detail = Game & { scoring: { period: number; type: string; goals: Goal[] }[]; stars: { star: number; playerId: number; team: string; name: string; pos: string; g?: number; a?: number; pts?: number; svp?: number; ga?: number; headshot: string | null }[]; penalties: { period: number; items: { time: string; team: string; who: string; desc: string; min: number }[] }[]; box: { home: { forwards: Skater[]; defense: Skater[]; goalies: Goalie[] } | null; away: { forwards: Skater[]; defense: Skater[]; goalies: Goalie[] } | null } | null };
type Row = { abbrev: string; name: string; common: string; logo: string | null; conf: string; confAbbrev: string; div: string; divAbbrev: string; gp: number; w: number; l: number; otl: number; pts: number; pct: number; row: number; rw: number; gf: number; ga: number; diff: number; home: string; away: string; l10: string; streak: string; clinch: string | null; divRank: number; confRank: number; leagueRank: number; wildcard: number };

const LIVE = new Set(['LIVE', 'CRIT']), DONE = new Set(['OFF', 'FINAL']);
const BRIGHTCOVE = (id: string) => `https://players.brightcove.net/6415718365001/default_default/index.html?videoId=${id}`;
const NET: Record<string, string> = { SN: 'Sportsnet', SNP: 'Sportsnet Pacific', SNW: 'Sportsnet West', SNO: 'Sportsnet Ontario', SNE: 'Sportsnet East', SN1: 'Sportsnet One', SN360: 'Sportsnet 360', TVAS: 'TVA Sports', CBC: 'CBC', ESPN: 'ESPN', 'ESPN+': 'ESPN+', ABC: 'ABC', TNT: 'TNT', TBS: 'TBS', MAX: 'Max', HULU: 'Hulu', NHLN: 'NHL Network', PRIME: 'Prime Video', AMZN: 'Prime Video', SCRIPPS: 'Scripps' };

async function hub<T>(task: string, q: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ task, ...q }).toString();
  const { data, error } = await supabase.functions.invoke(`nhl-hub?${qs}`, { method: 'GET' });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}
const status = (g: Game) => {
  if (g.scheduleState === 'PPD') return 'Postponed';
  if (g.scheduleState === 'CNCL') return 'Cancelled';
  if (DONE.has(g.state)) return g.outcome && g.outcome !== 'REG' ? `Final/${g.outcome}` : 'Final';
  if (LIVE.has(g.state)) {
    if (g.clock?.intermission) return `End ${per(g)}`;
    return `${per(g)} · ${g.clock?.time ?? ''}`;
  }
  return fmtTime(g.start);
};
const per = (g: Game) => (!g.period ? '' : g.period.type === 'REG' ? `P${g.period.n}` : g.period.type);
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// NHL team radio (HLS): Safari plays it natively, everyone else through hls.js loaded on demand
function RadioPlayer({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let hls: { destroy: () => void } | null = null;
    (async () => {
      if (el.canPlayType('application/vnd.apple.mpegurl')) { el.src = url; el.play().catch(() => {}); return; }
      try {
        const Hls = (await import('hls.js')).default;
        if (!Hls.isSupported()) { setErr('This browser can’t play the stream.'); return; }
        const h = new Hls(); hls = h; h.loadSource(url); h.attachMedia(el);
        h.on(Hls.Events.MANIFEST_PARSED, () => { el.play().catch(() => {}); });
        h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal?: boolean }) => { if (d.fatal) setErr('Stream unavailable right now (it usually starts near puck drop).'); });
      } catch { setErr('Could not load the player.'); }
    })();
    return () => { hls?.destroy(); el.pause(); };
  }, [url]);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm">
      <Headphones size={16} className="shrink-0 text-emerald-300" />
      <div className="min-w-0 flex-1"><div className="truncate font-semibold">{label} radio</div>{err && <div className="text-xs text-amber-200">{err}</div>}</div>
      <audio ref={ref} controls className="h-8 max-w-[45%]" />
      <button className="text-xs text-mute" onClick={onClose}>✕</button>
    </div>
  );
}

function Video({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs"><span className="font-semibold">{title}</span><button className="text-mute" onClick={onClose}>✕</button></div>
      <div className="aspect-video w-full"><iframe title={title} src={BRIGHTCOVE(id)} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
    </div>
  );
}

export default function NHL() {
  const { players, rosters, owner, team, teams } = useLeague();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('t') as 'scores' | 'standings' | 'schedule') || 'scores';
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('t', t); return n; });
  const [date, setDate] = useState(etToday());
  const [scores, setScores] = useState<{ date: string; prev: string | null; next: string | null; games: Game[] } | null>(null);
  const [standings, setStandings] = useState<{ asOf: string; rows: Row[] } | null>(null);
  const [week, setWeek] = useState<{ prev: string | null; next: string | null; days: { date: string; games: Game[] }[] } | null>(null);
  const [weekDate, setWeekDate] = useState(etToday());
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Game | null>(null);
  const [view, setView] = useState<'div' | 'conf' | 'league' | 'wc'>('div');

  const loadScores = useCallback(async (d: string) => { try { setScores(await hub('scores', { date: d })); setErr(null); } catch (e) { setErr((e as Error).message); } }, []);
  useEffect(() => { if (tab === 'scores') loadScores(date); }, [tab, date, loadScores]);
  // live games refresh every 30 seconds, a slate that hasn't started every 2 minutes
  const anyLive = !!scores?.games.some((g) => LIVE.has(g.state));
  useEffect(() => {
    if (tab !== 'scores' || date !== etToday()) return;
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') loadScores(date); }, anyLive ? 30_000 : 120_000);
    return () => window.clearInterval(i);
  }, [tab, date, anyLive, loadScores]);
  useEffect(() => { if (tab === 'standings' && !standings) hub<{ asOf: string; rows: Row[] }>('standings').then(setStandings, (e) => setErr(e.message)); }, [tab, standings]);
  useEffect(() => { if (tab === 'schedule') hub<typeof week>('schedule', { date: weekDate }).then(setWeek, (e) => setErr(e.message)); }, [tab, weekDate]);

  // which SaK GMs have players in a game (by NHL team)
  const byNhl = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    for (const r of rosters) { const p = players.get(r.player_id); if (!p?.nhl_team) continue; const t = m.get(p.nhl_team) ?? new Map(); t.set(r.team_id, (t.get(r.team_id) ?? 0) + 1); m.set(p.nhl_team, t); }
    return m;
  }, [rosters, players]);
  const gmsIn = (g: Game) => { const m = new Map<number, number>(); for (const ab of [g.home.abbrev, g.away.abbrev]) for (const [t, n] of byNhl.get(ab) ?? []) m.set(t, (m.get(t) ?? 0) + n); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const favOf = (abbrev: string) => teams.filter((t) => t.fav_nhl === abbrev);

  const GameCard = ({ g }: { g: Game }) => {
    const live = LIVE.has(g.state), done = DONE.has(g.state);
    const gms = gmsIn(g);
    return (
      <button onClick={() => setOpen(g)} className={`card w-full p-3 text-left transition active:scale-[.99] ${live ? 'border-goal/40 shadow-[0_0_0_1px_rgba(239,42,79,.25)]' : ''}`}>
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className={`font-bold uppercase tracking-wider ${live ? 'text-goal' : 'text-mute'}`}>{live && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-goal align-middle" />}{status(g)}{g.type === 1 ? ' · preseason' : g.type === 3 ? ' · playoffs' : ''}</span>
          <span className="text-mute">{g.tv.slice(0, 2).map((t) => NET[t.network] ?? t.network).join(' · ')}</span>
        </div>
        {[g.away, g.home].map((t, i) => {
          const win = done && t.score != null && t.score > ((i === 0 ? g.home : g.away).score ?? 0);
          return (
            <div key={t.abbrev} className={`flex items-center gap-2 py-1 ${done && !win ? 'opacity-60' : ''}`}>
              {t.logo ? <img src={t.logo} alt="" className="h-7 w-7" /> : <span className="h-7 w-7" />}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.place ? `${t.place} ${t.name}` : t.name} <span className="text-xs font-normal text-mute">{t.abbrev}{t.record && !done && !live ? ` · ${t.record}` : ''}</span></span>
              {t.sog != null && (live || done) && <span className="num w-10 text-right text-[11px] text-mute">{t.sog} SOG</span>}
              <span className={`num w-8 text-right font-display text-2xl font-extrabold ${win ? 'text-white' : ''}`}>{t.score ?? ''}</span>
            </div>
          );
        })}
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-mute">
          {gms.length ? <>SaK: {gms.slice(0, 5).map(([t, n]) => <span key={t} className="flex items-center gap-0.5"><TeamBadge team={team(t)} size={14} />{n}</span>)}{gms.length > 5 && <span>+{gms.length - 5}</span>}</> : <span>No SaK players in this one</span>}
          {(g.recap || g.condensed) && <span className="ml-auto flex items-center gap-1 text-sky-300"><Play size={11} /> recap</span>}
          {g.home.radio && !done && <span className={`${g.recap ? '' : 'ml-auto'} flex items-center gap-1 text-emerald-300`}><Headphones size={11} /> radio</span>}
        </div>
      </button>
    );
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
      <PageHeader icon={<Radio size={22} className="text-goal" />} title="NHL" sub="Scores, standings, schedule, highlights and radio, with your SaK players flagged in every game" />
      <div className="flex gap-1">
        {([['scores', '🏒 Scores'], ['standings', '🏆 Standings'], ['schedule', '📅 Schedule']] as const).map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setTab(k)}>{l}</button>)}
        <Link to="/scoreboard" className="tab ml-auto bg-white/[.05]">📡 SaK scoreboard</Link>
      </div>
      {err && <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">NHL data didn’t load: {err}</div>}

      {tab === 'scores' && (
        <>
          <div className="flex items-center gap-2">
            <button className="btn-ghost btn-sm" disabled={!scores?.prev} onClick={() => scores?.prev && setDate(scores.prev)}>‹ {scores?.prev ? fmtDay(scores.prev) : ''}</button>
            <div className="flex-1 text-center"><div className="font-bold">{fmtDay(date)}</div>{date !== etToday() && <button className="text-xs text-sky-300" onClick={() => setDate(etToday())}>Today</button>}</div>
            <button className="btn-ghost btn-sm" disabled={!scores?.next} onClick={() => scores?.next && setDate(scores.next)}>{scores?.next ? fmtDay(scores.next) : ''} ›</button>
          </div>
          {!scores && !err && <div className="p-6 text-center text-sm text-mute">Loading…</div>}
          {scores && scores.games.length === 0 && <div className="card p-6 text-center text-sm text-mute">No NHL games on {fmtDay(date)}.</div>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{scores?.games.map((g) => <GameCard key={g.id} g={g} />)}</div>
          {anyLive && <p className="text-center text-[11px] text-mute">Live: refreshes every 30 seconds.</p>}
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
                    const gms = gmsIn({ ...g, date: d.date });
                    return (
                      <button key={g.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[.03]" onClick={() => setOpen({ ...g, date: d.date })}>
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

      <GameSheet g={open} onClose={() => setOpen(null)} gmsIn={gmsIn} teamOf={team} ownerOf={(id) => { const o = owner.get(id); return o ? team(o.team_id) : undefined; }} inPool={(id) => players.has(id)} />
    </div>
  );
}

type TeamOf = ReturnType<typeof useLeague>['team'];
function GameSheet({ g, onClose, gmsIn, teamOf, ownerOf, inPool }: { g: Game | null; onClose: () => void; gmsIn: (g: Game) => [number, number][]; teamOf: TeamOf; ownerOf: (id: number) => ReturnType<TeamOf>; inPool: (id: number) => boolean }) {
  const [d, setD] = useState<Detail | null>(null);
  const [video, setVideo] = useState<{ id: string; title: string } | null>(null);
  const [radio, setRadio] = useState<{ url: string; label: string } | null>(null);
  const [side, setSide] = useState<'away' | 'home'>('away');
  useEffect(() => {
    setD(null); setVideo(null); setRadio(null);
    if (!g) return;
    let alive = true;
    const load = () => hub<Detail>('game', { id: String(g.id) }).then((x) => { if (alive) setD(x); }, () => {});
    load();
    const i = LIVE.has(g.state) ? window.setInterval(load, 30_000) : 0;
    return () => { alive = false; if (i) window.clearInterval(i); };
  }, [g?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g) return null;
  const x: Game = d ?? g;
  const live = LIVE.has(x.state), done = DONE.has(x.state);
  const gms = gmsIn(x);
  const Owner = ({ id }: { id: number }) => { const o = ownerOf(id); return o ? <span title={`${o.gm_name}'s player`} className="ml-1 inline-flex align-middle"><TeamBadge team={o} size={13} /></span> : null; };
  const Name = ({ id, name }: { id: number; name: string }) => inPool(id) ? <Link to={`/player/${id}`} className="hover:underline" onClick={onClose}>{name}</Link> : <>{name}</>;
  const box = d?.box?.[side];
  return (
    <Sheet open={!!g} onClose={onClose} wide title={<span className="flex items-center gap-2">{x.away.abbrev} @ {x.home.abbrev} <span className={`text-xs font-normal ${live ? 'text-goal' : 'text-mute'}`}>{status(x)}</span></span>}>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl bg-white/[.04] p-3">
          {[x.away, x.home].map((t, i) => (
            <div key={t.abbrev} className={`flex items-center gap-2 ${i === 1 ? 'flex-row-reverse text-right' : ''}`}>
              {t.logo && <img src={t.logo} alt="" className="h-12 w-12" />}
              <div className="min-w-0"><div className="truncate font-bold">{t.place ? `${t.place} ${t.name}` : t.name}</div><div className="text-[11px] text-mute">{t.sog != null && (live || done) ? `${t.sog} shots` : t.record ?? ''}</div></div>
            </div>
          )).reduce<React.ReactNode[]>((acc, el, i) => (i === 1 ? [...acc, <div key="score" className="num text-center font-display text-4xl font-extrabold">{x.away.score ?? '–'}<span className="text-mute"> : </span>{x.home.score ?? '–'}</div>, el] : [el]), [])}
        </div>
        <div className="text-center text-xs text-mute">{x.venue}{x.date ? ` · ${fmtDay(x.date)}` : ''} · {fmtTime(x.start)}{x.tv.length > 0 && <> · 📺 {x.tv.map((t) => `${NET[t.network] ?? t.network}${t.country === 'CA' ? ' 🇨🇦' : t.country === 'US' ? ' 🇺🇸' : ''}`).join(', ')}</>}</div>

        {/* watch, listen, replay */}
        <div className="flex flex-wrap gap-1.5">
          {x.link && <a href={x.link} target="_blank" rel="noreferrer" className="btn-ghost btn-sm"><Tv size={14} /> Watch on NHL.com <ExternalLink size={11} /></a>}
          {[x.away, x.home].filter((t) => t.radio).map((t) => <button key={t.abbrev} className={`btn-ghost btn-sm ${radio?.url === t.radio ? 'text-emerald-300' : ''}`} onClick={() => setRadio(radio?.url === t.radio ? null : { url: t.radio!, label: t.abbrev })}><Headphones size={14} /> {t.abbrev} radio</button>)}
          {x.recap && <button className="btn-ghost btn-sm" onClick={() => setVideo({ id: x.recap!, title: 'Game recap' })}><Play size={14} /> Recap</button>}
          {x.condensed && <button className="btn-ghost btn-sm" onClick={() => setVideo({ id: x.condensed!, title: 'Condensed game' })}><Play size={14} /> Condensed game</button>}
        </div>
        {radio && <RadioPlayer url={radio.url} label={radio.label} onClose={() => setRadio(null)} />}
        {video && <Video id={video.id} title={video.title} onClose={() => setVideo(null)} />}
        {!live && !done && <p className="text-xs text-mute">Live streams are on the broadcasters listed above (Sportsnet+, ESPN+, NHL.tv where available). Radio and the highlight clips play right here.</p>}

        {gms.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="text-mute">SaK players in this game:</span>{gms.map(([t, n]) => <span key={t} className="flex items-center gap-1 rounded-full bg-white/[.05] px-2 py-0.5"><TeamBadge team={teamOf(t)} size={14} />{teamOf(t)?.gm_name} <span className="num text-mute">{n}</span></span>)}</div>
        )}

        {(d?.scoring?.some((p) => p.goals.length) || x.goals.length > 0) && (
          <Section title="Scoring">
            <div className="card divide-y divide-white/[.05]">
              {(d?.scoring ?? [{ period: 0, type: 'REG', goals: x.goals }]).flatMap((p) => p.goals.map((gl, i) => (
                <div key={`${p.period}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                  {gl.mugshot ? <img src={gl.mugshot} alt="" className="h-9 w-9 rounded-full bg-white/10 object-cover" /> : <span className="h-9 w-9 rounded-full bg-white/10" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold"><Name id={gl.playerId} name={gl.name} /> <span className="text-xs font-normal text-mute">({gl.goalsToDate})</span><Owner id={gl.playerId} />{gl.strength !== 'ev' && <span className="ml-1 rounded bg-white/10 px-1 text-[10px] uppercase">{gl.strength}</span>}{gl.modifier && gl.modifier !== 'none' && <span className="ml-1 rounded bg-white/10 px-1 text-[10px]">{gl.modifier.replace(/-/g, ' ')}</span>}</div>
                    <div className="truncate text-xs text-mute">{gl.assists.length ? gl.assists.map((a) => `${a.name} (${a.n})`).join(', ') : 'Unassisted'} · {p.period ? (p.type === 'REG' ? `P${p.period}` : p.type) : gl.type === 'REG' ? `P${gl.period}` : gl.type} {gl.time}</div>
                  </div>
                  <span className="num text-xs text-mute">{gl.team}</span>
                  <span className="num w-10 text-right text-sm font-bold">{gl.away}-{gl.home}</span>
                  {gl.clip && <button className="btn-ghost btn-sm px-2" title="Watch the goal" onClick={() => setVideo({ id: gl.clip!, title: `${gl.name} goal` })}><Play size={14} /></button>}
                </div>
              )))}
            </div>
          </Section>
        )}

        {d?.stars && d.stars.length > 0 && (
          <Section title="Three stars">
            <div className="grid grid-cols-3 gap-2">
              {d.stars.map((s) => (
                <div key={s.star} className="card flex items-center gap-2 p-2 text-xs">
                  {s.headshot ? <img src={s.headshot} alt="" className="h-9 w-9 rounded-full bg-white/10 object-cover" /> : null}
                  <div className="min-w-0"><div className="truncate font-semibold">{'⭐'.repeat(s.star)} <Name id={s.playerId} name={s.name} /><Owner id={s.playerId} /></div><div className="text-mute">{s.team} · {s.pos === 'G' ? `${s.svp != null ? s.svp.toFixed(3).replace(/^0/, '') : ''} SV%, ${s.ga} GA` : `${s.g}G ${s.a}A`}</div></div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {d?.box && (
          <Section title="Box score" right={<div className="flex gap-1">{(['away', 'home'] as const).map((s) => <button key={s} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${side === s ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`} onClick={() => setSide(s)}>{x[s].abbrev}</button>)}</div>}>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="text-mute"><tr>{['Skater', 'G', 'A', 'P', '+/-', 'PIM', 'SOG', 'HIT', 'BLK', 'TOI'].map((h, i) => <th key={h} className={`px-2 py-1.5 font-semibold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-white/[.05]">
                  {box && [...box.forwards, ...box.defense].map((p) => (
                    <tr key={p.id} className={p.pts > 0 ? 'text-white' : 'text-slate-300'}>
                      <td className="whitespace-nowrap px-2 py-1"><span className="text-mute">{p.pos} {p.num}</span> <Name id={p.id} name={p.name} /><Owner id={p.id} /></td>
                      {[p.g, p.a, p.pts, p.pm > 0 ? `+${p.pm}` : p.pm, p.pim, p.sog, p.hit, p.blk, p.toi].map((v, k) => <td key={k} className="num px-2 py-1 text-right">{v}</td>)}
                    </tr>
                  ))}
                </tbody>
                <thead className="text-mute"><tr>{['Goalie', 'SA', 'SV%', 'GA', 'TOI', 'Dec', '', '', '', ''].map((h, i) => <th key={i} className={`px-2 py-1.5 font-semibold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-white/[.05]">
                  {box?.goalies.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap px-2 py-1"><span className="text-mute">G {p.num}</span> <Name id={p.id} name={p.name} /><Owner id={p.id} />{p.starter ? '' : <span className="ml-1 text-[10px] text-mute">relief</span>}</td>
                      {[p.sa, p.svp != null ? p.svp.toFixed(3).replace(/^0/, '') : '–', p.ga, p.toi, p.decision ?? '', '', '', '', ''].map((v, k) => <td key={k} className="num px-2 py-1 text-right">{v}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {d?.penalties?.some((p) => p.items.length) && (
          <Section title="Penalties">
            <div className="card divide-y divide-white/[.05] text-xs">
              {d.penalties.flatMap((p) => p.items.map((it, i) => <div key={`${p.period}-${i}`} className="flex items-center gap-2 px-3 py-1.5"><span className="num w-14 text-mute">P{p.period} {it.time}</span><span className="w-10 font-semibold">{it.team}</span><span className="flex-1 truncate">{it.who}</span><span className="text-mute">{it.desc.replace(/-/g, ' ')} · {it.min} min</span></div>))}
            </div>
          </Section>
        )}
        {!d && <div className="p-4 text-center text-xs text-mute">Loading the box score…</div>}
      </div>
    </Sheet>
  );
}
