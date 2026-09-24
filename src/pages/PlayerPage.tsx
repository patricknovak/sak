import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, History, Newspaper, Trophy, UserRound } from 'lucide-react';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { Game, NewsItem, Transaction } from '../lib/types';
import { ago, calcFpts, etToday, fmtDate, fmtPts, fmtTime, injuryBadge, NHL_COLORS, NHL_TEAMS, readable, SCORING_STATS, STAT_LABELS, teamLogo } from '../lib/format';
import { PlayerActions } from '../components/PlayerCard';
import { Headshot, NhlLogo, Pos, Section, Skeleton, Stat, TeamBadge, TeamName } from '../components/ui';

interface GameLine { game_id: number; date: string; nhl_team: string; stats: Record<string, number>; fpts: number }
interface Bio {
  number: number | null; birthDate: string | null; birthCity: string | null; birthState: string | null; birthCountry: string | null;
  heightIn: number | null; heightCm: number | null; weightLb: number | null; weightKg: number | null; shoots: string | null;
  draft: { year: number; teamAbbrev: string; round: number; pickInRound: number; overallPick: number } | null; hero: string | null;
  hhof: boolean; top100: boolean; awards: { trophy: string; seasons: number[] }[];
  playoffs: Record<string, number> | null; career: Record<string, number> | null;
  other: { season: number; league: string; team: string; gp: number; g: number | null; a: number | null; pts: number | null; w: number | null; gaa: number | null; svp: number | null }[];
  playoffSeasons: { season: number; team: string; gp: number; g: number | null; a: number | null; pts: number | null; w: number | null; gaa: number | null; svp: number | null }[];
}
type Tab = 'overview' | 'log' | 'career' | 'news';

const seasonLabel = (n: number | string) => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(6)}`; };
const age = (d: string) => { const b = new Date(d), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a; };

export default function PlayerPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const nav = useNavigate();
  const { players, owner, team, league, season, picks } = useLeague();
  const p = players.get(id);
  const r = owner.get(id);
  const [tab, setTab] = useState<Tab>('overview');
  const [log, setLog] = useState<GameLine[] | null>(null);
  const [career, setCareer] = useState<Record<string, number | string>[] | null>(null);
  const [bio, setBio] = useState<Bio | null | undefined>(undefined);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [tx, setTx] = useState<Transaction[]>([]);
  const [upcoming, setUpcoming] = useState<Game[]>([]);

  useEffect(() => {
    if (!id) return;
    window.scrollTo(0, 0);
    setLog(null); setCareer(null); setBio(undefined); setNews([]); setTx([]); setTab('overview');
    supabase.from('player_games').select('game_id,date,nhl_team,stats,fpts').eq('player_id', id).order('date', { ascending: false }).limit(90)
      .then(({ data }) => setLog((data ?? []) as GameLine[]));
    supabase.from('news').select('*').contains('player_ids', [id]).order('published', { ascending: false }).limit(15).then(({ data }) => setNews((data ?? []) as NewsItem[]));
    supabase.from('transactions').select('*').eq('player_id', id).order('id', { ascending: false }).limit(30).then(({ data }) => setTx((data ?? []) as Transaction[]));
    supabase.functions.invoke(`player-info?id=${id}`, { method: 'GET' })
      .then(({ data }) => { setCareer((data?.seasons ?? []) as Record<string, number | string>[]); setBio((data?.bio ?? null) as Bio | null); })
      .catch(() => { setCareer([]); setBio(null); });
  }, [id]);
  useEffect(() => {
    if (!p?.nhl_team) return;
    supabase.from('games').select('*').gte('date', etToday()).or(`home.eq.${p.nhl_team},away.eq.${p.nhl_team}`).order('start_utc').limit(8)
      .then(({ data }) => setUpcoming((data ?? []) as Game[]));
  }, [p?.nhl_team]);

  const goalie = p?.pos === 'G';
  const weights = league?.scoring[goalie ? 'goalie' : 'skater'] ?? {};
  const s = p ? season.get(p.id) : undefined;
  const posRank = useMemo(() => {
    if (!p) return null;
    const same = [...players.values()].filter((x) => x.pos === p.pos).sort((a, b) => b.proj - a.proj);
    return same.findIndex((x) => x.id === p.id) + 1;
  }, [players, p]);
  const draftedAt = picks.find((k) => k.player_id === id);

  // where the fantasy points come from: this season if he's played, otherwise last season
  const breakdownSrc = s && s.gp > 0 ? { label: 'This season', stats: s.totals as Record<string, number> } : p?.last_stats ? { label: '2025-26', stats: p.last_stats } : null;
  const breakdown = useMemo(() => {
    if (!breakdownSrc) return [];
    return Object.entries(weights).filter(([, w]) => w).map(([k, w]) => ({ k, v: Number(breakdownSrc.stats[k] ?? 0), w, pts: w * Number(breakdownSrc.stats[k] ?? 0) }))
      .filter((x) => x.v).sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  }, [breakdownSrc?.label, p?.id, weights]);
  const maxAbs = Math.max(1, ...breakdown.map((b) => Math.abs(b.pts)));
  const allLabels = Object.fromEntries([...SCORING_STATS.skater, ...SCORING_STATS.goalie]);

  if (!p) {
    return players.size ? (
      <div className="card p-6 text-center"><div className="text-4xl">🤷</div><p className="mt-2 text-sm text-mute">We don’t have that player in the SaK pool.</p><button className="btn-ghost mt-3" onClick={() => nav(-1)}>Go back</button></div>
    ) : <div className="space-y-3"><Skeleton className="h-48" /><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  }

  const tc = NHL_COLORS[p.nhl_team ?? ''] ?? '#4cc3ff';
  const inj = injuryBadge(p.injury_status);
  const keys = goalie ? ['gp', 'gs', 'w', 'l', 'otl', 'ga', 'sa', 'sv', 'sho'] : ['gp', 'g', 'a', 'pts', 'pm', 'pim', 'ppg', 'ppp', 'shp', 'gwg', 'sog', 'fow', 'hit', 'blk'];
  const recent = (log ?? []).slice(0, 20).reverse();
  const maxRecent = Math.max(1, ...recent.map((g) => Math.abs(g.fpts)));
  const ownerTeam = r ? team(r.team_id) : undefined;

  return (
    <div className="space-y-4">
      <button onClick={() => nav(-1)} className="flex items-center gap-1 text-sm text-sky-300"><ArrowLeft size={16} /> Back</button>

      {/* hero */}
      <div className="card-hero overflow-hidden p-0" style={{ '--tc': tc } as React.CSSProperties}>
        {bio?.hero && <img src={bio.hero} alt="" className="absolute inset-0 h-full w-full object-cover object-top opacity-35" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b1222] via-[#0b1222]/70 to-transparent" />
        {p.nhl_team && <img src={teamLogo(p.nhl_team)} alt="" className="pointer-events-none absolute -right-8 -top-6 h-44 w-44 opacity-[.12]" />}
        <div className="relative flex items-end gap-4 p-4 pt-16 sm:p-6 sm:pt-24">
          <Headshot p={p} size={96} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white/75">
              <NhlLogo abbr={p.nhl_team} size={18} />{NHL_TEAMS[p.nhl_team ?? ''] ?? 'Not on an NHL roster'}{(bio?.number ?? p.num) != null && <span>· #{bio?.number ?? p.num}</span>}
            </div>
            <h1 className="h-display text-shine break-words text-[30px] leading-[.95] sm:text-5xl">{p.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {p.elig.map((e) => <Pos key={e} p={e} />)}
              {inj && <span className={`chip ${inj.cls}`}>{p.injury_status}</span>}
              {bio?.hhof && <span className="chip border-gold/40 text-gold">Hall of Fame</span>}
              {bio?.top100 && <span className="chip border-gold/40 text-gold">NHL Top 100</span>}
            </div>
          </div>
        </div>
        <div className="relative flex flex-wrap items-center gap-2 border-t border-white/10 bg-black/25 px-4 py-2.5 text-sm backdrop-blur">
          {ownerTeam ? (
            <><TeamBadge team={ownerTeam} size={24} /><span className="text-white/70">On</span><TeamName team={ownerTeam} link /><Pos p={r!.slot} />
              {r!.acquired === 'keeper' && <span className="chip">🔒 Keeper</span>}</>
          ) : <span className="font-semibold text-emerald-300">✅ Free agent in SaK</span>}
          {draftedAt?.overall && <span className="ml-auto text-xs text-white/60">SaK pick #{draftedAt.overall} ({draftedAt.season})</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="This season" value={fmtPts(s?.fpts ?? 0)} sub={`${s?.gp ?? 0} GP · ${s?.gp ? fmtPts((s.fpts ?? 0) / s.gp, 2) : '–'}/gm`} />
        <Stat label="Last 14 days" value={fmtPts(s?.fpts14 ?? 0)} sub="fantasy points" />
        <Stat label="2025-26" value={fmtPts(p.last_fp)} sub={`${p.last_stats?.gp ?? 0} GP · ${p.last_stats?.gp ? fmtPts(p.last_fp / p.last_stats.gp, 2) : '–'}/gm`} />
        <Stat label="Projection" value={fmtPts(p.proj, 0)} sub={`#${p.rank ?? '–'} overall · #${posRank ?? '–'} ${p.pos}`} />
      </div>

      <PlayerActions p={p} />

      {p.injury_status && (
        <div className="card border-red-400/30 p-3 text-sm" style={{ background: 'linear-gradient(135deg, rgba(239,42,79,.14), rgba(15,23,41,.8) 60%)' }}>
          <div className="font-bold text-red-300">🩹 {p.injury_status}{p.injury_date && <span className="ml-2 text-xs font-normal text-mute">updated {ago(p.injury_date)}</span>}</div>
          {p.injury_note && <p className="mt-1 text-slate-300">{p.injury_note}</p>}
        </div>
      )}

      <div className="scroll-x sticky top-[calc(3rem+var(--banner,0px))] z-20 -mx-3 flex gap-1 border-b border-white/[.07] bg-[#070c18]/85 px-3 py-2 backdrop-blur-xl lg:top-[var(--banner,0px)]">
        {([['overview', 'Overview'], ['log', `Game log${log?.length ? ` (${log.length})` : ''}`], ['career', 'Career'], ['news', `News${news.length ? ` (${news.length})` : ''}`]] as const).map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            {breakdown.length > 0 && (
              <Section title={`Where his points come from · ${breakdownSrc!.label}`}>
                <div className="card space-y-1.5 p-3">
                  {breakdown.map((b) => (
                    <div key={b.k} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0 truncate text-slate-300">{allLabels[b.k] ?? b.k}</span>
                      <span className="num w-9 shrink-0 text-right text-mute">{b.v}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[.05]">
                        <div className="h-full rounded-full" style={{ width: `${(Math.abs(b.pts) / maxAbs) * 100}%`, background: b.pts >= 0 ? `linear-gradient(90deg, ${readable(tc)}, color-mix(in oklab, ${readable(tc)} 55%, white))` : '#ef4444' }} />
                      </div>
                      <span className={`num w-14 shrink-0 text-right font-bold ${b.pts < 0 ? 'text-red-300' : ''}`}>{b.pts > 0 ? '+' : ''}{fmtPts(b.pts, 1)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-white/[.07] pt-1.5 text-xs"><span className="text-mute">Total under SaK scoring</span><span className="num font-bold text-gold">{fmtPts(breakdown.reduce((t, b) => t + b.pts, 0), 1)}</span></div>
                </div>
              </Section>
            )}

            {recent.length > 1 && (
              <Section title="Recent form">
                <div className="card p-3">
                  <div className="flex h-28 items-end gap-1">
                    {recent.map((g) => (
                      <div key={g.game_id} className="group relative flex flex-1 flex-col items-center justify-end" title={`${fmtDate(g.date)}: ${fmtPts(g.fpts, 1)}`}>
                        <div className="w-full rounded-t" style={{ height: `${Math.max(3, (Math.abs(g.fpts) / maxRecent) * 100)}%`, background: g.fpts >= 0 ? `linear-gradient(180deg, ${readable(tc)}, color-mix(in oklab, ${readable(tc)} 40%, #0b1222))` : '#ef4444' }} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-mute"><span>{fmtDate(recent[0].date)}</span><span>last {recent.length} games · avg {fmtPts(recent.reduce((t, g) => t + g.fpts, 0) / recent.length, 2)}</span><span>{fmtDate(recent[recent.length - 1].date)}</span></div>
                </div>
              </Section>
            )}

            {(s?.gp ?? 0) > 0 || p.last_stats ? (
              <Section title={s && s.gp > 0 ? 'This season' : '2025-26 stats'}>
                <div className="card grid grid-cols-4 gap-1.5 p-2 sm:grid-cols-7">
                  {keys.map((k) => {
                    const v = s && s.gp > 0 ? (k === 'gp' ? s.gp : s.totals[k]) : p.last_stats?.[k];
                    return <div key={k} className="rounded-lg bg-white/[.04] px-1 py-1.5 text-center"><div className="text-[10px] text-mute">{STAT_LABELS[k]}</div><div className="num text-sm font-bold">{v ?? 0}</div></div>;
                  })}
                </div>
              </Section>
            ) : null}
          </div>

          <div className="space-y-4">
            <Section icon={<UserRound size={16} className="text-blue" />} title="Bio">
              {bio === undefined ? <Skeleton className="h-40" /> : !bio ? <div className="card p-4 text-sm text-mute">No NHL bio available.</div> : (
                <div className="card grid grid-cols-2 gap-px overflow-hidden bg-white/[.06] text-sm">
                  {[
                    ['Age', bio.birthDate ? `${age(bio.birthDate)} (born ${new Date(bio.birthDate + 'T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })})` : '–'],
                    ['Born', [bio.birthCity, bio.birthState, bio.birthCountry].filter(Boolean).join(', ') || '–'],
                    ['Height', bio.heightIn ? `${Math.floor(bio.heightIn / 12)}′${bio.heightIn % 12}″ (${bio.heightCm} cm)` : '–'],
                    ['Weight', bio.weightLb ? `${bio.weightLb} lb (${bio.weightKg} kg)` : '–'],
                    [goalie ? 'Catches' : 'Shoots', bio.shoots === 'L' ? 'Left' : bio.shoots === 'R' ? 'Right' : '–'],
                    ['NHL draft', bio.draft ? `${bio.draft.year} · R${bio.draft.round} #${bio.draft.overallPick} (${bio.draft.teamAbbrev})` : 'Undrafted'],
                  ].map(([k, v]) => <div key={k} className="bg-[#0f1729] px-3 py-2"><div className="label">{k}</div><div className="mt-0.5 font-semibold">{v}</div></div>)}
                </div>
              )}
            </Section>

            {bio?.awards?.length ? (
              <Section icon={<Trophy size={16} className="text-gold" />} title="Hardware">
                <div className="flex flex-wrap gap-1.5">
                  {bio.awards.map((a) => <span key={a.trophy} className="chip border-gold/30 bg-gold/10 py-1 text-gold">🏆 {a.trophy}{a.seasons.length > 1 ? ` ×${a.seasons.length}` : ''}</span>)}
                </div>
              </Section>
            ) : null}

            <Section icon={<CalendarDays size={16} className="text-blue" />} title="Coming up">
              <div className="card divide-y divide-white/[.06]">
                {upcoming.length === 0 && <div className="p-3 text-sm text-mute">No games on the schedule yet.</div>}
                {upcoming.map((g) => {
                  const home = g.home === p.nhl_team; const opp = home ? g.away : g.home;
                  return (
                    <div key={g.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="w-20 text-xs text-mute">{fmtDate(g.date)}</span>
                      <span className="text-mute">{home ? 'vs' : '@'}</span><NhlLogo abbr={opp} size={20} /><span className="flex-1 font-semibold">{NHL_TEAMS[opp] ?? opp}</span>
                      <span className="text-xs text-mute">{fmtTime(g.start_utc)}</span>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section icon={<History size={16} className="text-blue" />} title="SaK history">
              <div className="card divide-y divide-white/[.06]">
                {tx.length === 0 && <div className="p-3 text-sm text-mute">No SaK moves yet this season.</div>}
                {tx.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span>{{ add: '➕', drop: '➖', trade: '🔄', draft: '📋', keeper: '🔒', release: '↩️', commish: '🛠️' }[t.type] ?? '•'}</span>
                    <span className="min-w-0 flex-1 truncate">{t.team_id ? <TeamName team={team(t.team_id)} link /> : 'League'} <span className="text-mute">{t.type}{t.other_team ? ` from ${team(t.other_team)?.abbrev}` : ''}{t.note ? ` · ${t.note}` : ''}</span></span>
                    <span className="text-xs text-mute">{ago(t.created_at)}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>
      )}

      {tab === 'log' && (
        <div className="card overflow-x-auto">
          {log === null ? <div className="p-4"><Skeleton className="h-32" /></div> : log.length === 0 ? <div className="p-4 text-sm text-mute">No games yet this season. The log fills in once the puck drops.</div> : (
            <table className="w-full text-right text-xs">
              <thead className="bg-white/[.04] text-mute"><tr><th className="px-2 py-2 text-left">Date</th><th className="px-2 text-gold">SaK</th>{keys.filter((k) => k !== 'gp').map((k) => <th key={k} className="px-1.5">{STAT_LABELS[k]}</th>)}</tr></thead>
              <tbody className="divide-y divide-white/[.06]">
                {log.map((g) => (
                  <tr key={g.game_id}>
                    <td className="px-2 py-1.5 text-left text-mute">{fmtDate(g.date)}</td>
                    <td className={`num px-2 font-bold ${g.fpts < 0 ? 'text-red-300' : 'text-gold'}`}>{fmtPts(g.fpts, 1)}</td>
                    {keys.filter((k) => k !== 'gp').map((k) => <td key={k} className="num px-1.5">{g.stats[k] ?? 0}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'career' && (
        <div className="space-y-4">
          <Section title="NHL regular season">
            {career === null ? <Skeleton className="h-40" /> : career.length === 0 ? <div className="card p-4 text-sm text-mute">No NHL regular-season stats yet.</div> : (
              <div className="card overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-white/[.04] text-mute"><tr><th className="px-2 py-2 text-left">Season</th><th className="px-2 text-gold">SaK</th><th className="px-1.5 text-left">Team</th>
                    {(goalie ? ['gp', 'gs', 'w', 'l', 'otl', 'ga', 'sv', 'sho'] : ['gp', 'g', 'a', 'pts', 'pm', 'ppp', 'sog', 'hit', 'blk', 'fow']).map((k) => <th key={k} className="px-1.5">{STAT_LABELS[k]}</th>)}</tr></thead>
                  <tbody className="divide-y divide-white/[.06]">
                    {career.map((c) => (
                      <tr key={String(c.season) + String(c.team)}>
                        <td className="px-2 py-1.5 text-left">{seasonLabel(c.season)}</td>
                        <td className="num px-2 font-bold text-gold">{fmtPts(calcFpts(c as Record<string, number>, weights))}</td>
                        <td className="px-1.5 text-left text-mute">{String(c.team ?? '')}</td>
                        {(goalie ? ['gp', 'gs', 'w', 'l', 'otl', 'ga', 'sv', 'sho'] : ['gp', 'g', 'a', 'pts', 'pm', 'ppp', 'sog', 'hit', 'blk', 'fow']).map((k) => <td key={k} className="num px-1.5">{String(c[k] ?? 0)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-1 px-1 text-[11px] text-mute">SaK = fantasy points under this league’s current scoring. Hits and blocks are tracked from 2005-06 on.</p>
          </Section>

          {bio?.playoffSeasons?.length ? (
            <Section title="Playoffs">
              <div className="card overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-white/[.04] text-mute"><tr><th className="px-2 py-2 text-left">Season</th><th className="px-1.5 text-left">Team</th><th className="px-1.5">GP</th>{goalie ? <><th className="px-1.5">W</th><th className="px-1.5">GAA</th><th className="px-1.5">SV%</th></> : <><th className="px-1.5">G</th><th className="px-1.5">A</th><th className="px-1.5">P</th></>}</tr></thead>
                  <tbody className="divide-y divide-white/[.06]">
                    {[...bio.playoffSeasons].reverse().map((s2) => (
                      <tr key={s2.season + s2.team}><td className="px-2 py-1.5 text-left">{seasonLabel(s2.season)}</td><td className="px-1.5 text-left text-mute">{s2.team}</td><td className="num px-1.5">{s2.gp}</td>
                        {goalie ? <><td className="num px-1.5">{s2.w ?? 0}</td><td className="num px-1.5">{s2.gaa?.toFixed(2) ?? '–'}</td><td className="num px-1.5">{s2.svp?.toFixed(3) ?? '–'}</td></> : <><td className="num px-1.5">{s2.g ?? 0}</td><td className="num px-1.5">{s2.a ?? 0}</td><td className="num px-1.5 font-bold">{s2.pts ?? 0}</td></>}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}

          {bio?.other?.length ? (
            <Section title="Before the NHL (and elsewhere)">
              <div className="card overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-white/[.04] text-mute"><tr><th className="px-2 py-2 text-left">Season</th><th className="px-1.5 text-left">League</th><th className="px-1.5 text-left">Team</th><th className="px-1.5">GP</th>{goalie ? <><th className="px-1.5">W</th><th className="px-1.5">GAA</th></> : <><th className="px-1.5">G</th><th className="px-1.5">A</th><th className="px-1.5">P</th></>}</tr></thead>
                  <tbody className="divide-y divide-white/[.06]">
                    {[...bio.other].reverse().map((o, i) => (
                      <tr key={i}><td className="px-2 py-1.5 text-left">{seasonLabel(o.season)}</td><td className="px-1.5 text-left">{o.league}</td><td className="max-w-40 truncate px-1.5 text-left text-mute">{o.team}</td><td className="num px-1.5">{o.gp}</td>
                        {goalie ? <><td className="num px-1.5">{o.w ?? '–'}</td><td className="num px-1.5">{o.gaa?.toFixed(2) ?? '–'}</td></> : <><td className="num px-1.5">{o.g ?? 0}</td><td className="num px-1.5">{o.a ?? 0}</td><td className="num px-1.5 font-bold">{o.pts ?? 0}</td></>}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}
        </div>
      )}

      {tab === 'news' && (
        <Section icon={<Newspaper size={16} className="text-blue" />} title="Headlines">
          <div className="space-y-2">
            {news.length === 0 && <div className="card p-4 text-sm text-mute">No recent headlines mention {p.name}.</div>}
            {news.map((n) => (
              <a key={n.id} href={n.url ?? '#'} target="_blank" rel="noreferrer" className="card flex gap-3 p-3">
                {n.image && <img src={n.image} alt="" loading="lazy" className="h-16 w-24 shrink-0 rounded-lg object-cover" />}
                <div className="min-w-0"><div className="text-sm font-semibold leading-snug">{n.headline}</div>
                  {n.description && <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">{n.description}</div>}
                  <div className="mt-1 text-[11px] text-mute">{n.published ? ago(n.published) : ''} · ESPN</div></div>
              </a>
            ))}
          </div>
        </Section>
      )}

      {ownerTeam && <div className="text-center text-sm"><Link className="text-sky-300" to={`/team/${ownerTeam.id}`}>See {ownerTeam.name}’s full roster →</Link></div>}
    </div>
  );
}
