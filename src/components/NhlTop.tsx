// The NHL centre's front page: the biggest things right now in one scroll, each block leading into its own
// tab. Tonight's (or last night's) games with recap clips, the top headlines, what the insiders are saying,
// injury news on league players, and the leaders once the season is under way.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, Play, Radio } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { hub, type Leaders, type NewsStory, type XFeed } from '../lib/nhlhub';
import { ago, fmtTime, injuryBack, injuryBadge } from '../lib/format';
import { usePlayerInfo } from '../lib/playerInfo';
import { Section, TeamBadge } from './ui';

type NTeam = { id: number; abbrev: string; name: string; place: string; score: number | null; sog: number | null; logo: string | null; record: string | null };
type Goal = { name: string; team: string; clip: string | null; goalsToDate: number; playerId: number };
export type TopGame = { id: number; date?: string; state: string; start: string; period: { n: number; type: string } | null; clock: { time: string; running: boolean; intermission: boolean } | null; home: NTeam; away: NTeam; outcome: string | null; tv: { network: string }[]; goals: Goal[]; recap: string | null; condensed: string | null; link: string | null };
type Scores = { date: string; prev: string | null; next: string | null; games: TopGame[] };

const LIVE = new Set(['LIVE', 'CRIT']), DONE = new Set(['OFF', 'FINAL']);
const BRIGHTCOVE = (id: string) => `https://players.brightcove.net/6415718365001/default_default/index.html?videoId=${id}`;
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const status = (g: TopGame) => DONE.has(g.state) ? `Final${g.outcome && g.outcome !== 'REG' ? ' / ' + g.outcome : ''}` : LIVE.has(g.state) ? (g.clock?.intermission ? `Int ${g.period?.n}` : `${g.period?.type === 'REG' ? 'P' + g.period?.n : g.period?.type} ${g.clock?.time ?? ''}`) : fmtTime(g.start);

export function TopTab({ onGame }: { onGame: (g: TopGame) => void }) {
  const { players, owner, team, me, leagueDay } = useLeague();
  const now = useNow(60_000);
  const [today, setToday] = useState<Scores | null>(null);
  const [last, setLast] = useState<Scores | null>(null);
  const [news, setNews] = useState<NewsStory[] | null>(null);
  const [x, setX] = useState<XFeed | null>(null);
  const [leaders, setLeaders] = useState<Leaders | null>(null);
  const [video, setVideo] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    let dead = false;
    setLast(null);
    const whole = (s: Scores | null) => ({ ...s, games: s?.games ?? [] }) as Scores;
    hub<Scores>('scores', { date: leagueDay }).then((r) => { if (dead) return; const s = whole(r); setToday(s); if (s.prev && !s.games.some((g) => DONE.has(g.state))) hub<Scores>('scores', { date: s.prev }).then((p) => !dead && setLast(whole(p)), () => {}); }, () => {});
    hub<{ items?: NewsStory[] }>('news').then((r) => !dead && setNews(r?.items ?? []), () => !dead && setNews([]));
    hub<XFeed>('x').then((f) => !dead && setX(f), () => {});
    hub<Leaders>('leaders').then((l) => !dead && setLeaders(l), () => {});
    return () => { dead = true; };
  }, [leagueDay]);

  // which league players play for an NHL club, for the badges
  const byNhl = useMemo(() => { const m = new Map<string, Map<number, number>>(); for (const [, r] of owner) { const p = players.get(r.player_id); if (!p?.nhl_team) continue; const t = m.get(p.nhl_team) ?? new Map(); t.set(r.team_id, (t.get(r.team_id) ?? 0) + 1); m.set(p.nhl_team, t); } return m; }, [owner, players]);
  const gmsIn = (g: TopGame) => { const m = new Map<number, number>(); for (const ab of [g.home.abbrev, g.away.abbrev]) for (const [t, n] of byNhl.get(ab) ?? []) m.set(t, (m.get(t) ?? 0) + n); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t); };

  // a reply without its games (the feed hiccuped) reads as no games, not a crashed page
  const liveGames = today?.games?.filter((g) => LIVE.has(g.state)) ?? [];
  const finals = [...(today?.games ?? []), ...(last?.games ?? [])].filter((g) => DONE.has(g.state));
  const upcoming = today?.games?.filter((g) => !LIVE.has(g.state) && !DONE.has(g.state)) ?? [];
  const highlights = finals.filter((g) => g.recap || g.condensed).slice(0, 6);
  // top headlines: newest, one per source first so it isn't all one outlet
  const headlines = useMemo(() => {
    const items = news ?? []; const out: NewsStory[] = []; const seen = new Set<string>();
    for (const s of items) if (!seen.has(s.source) && out.length < 3) { out.push(s); seen.add(s.source); }
    for (const s of items) if (out.length < 6 && !out.includes(s)) out.push(s);
    return out;
  }, [news]);
  const posts = (x?.posts ?? []).slice(0, 4);
  const info = usePlayerInfo();
  const nav = useNavigate();
  const hurt = useMemo(() => [...players.values()].filter((p) => p.injury_status && owner.has(p.id)).sort((a, b) => (b.injury_date ?? '').localeCompare(a.injury_date ?? '')).slice(0, 5), [players, owner]);
  const topPts = leaders?.skaters?.points?.slice(0, 5) ?? [];
  const seasonOn = topPts.length > 0 && topPts[0].value > 0;

  const GameRow = ({ g }: { g: TopGame }) => {
    const live = LIVE.has(g.state), done = DONE.has(g.state);
    return (
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[.03]" onClick={() => onGame(g)}>
        <span className={`num w-16 shrink-0 text-xs ${live ? 'font-bold text-red-300' : 'text-mute'}`}>{live && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />}{status(g)}</span>
        {g.away.logo && <img src={g.away.logo} alt="" className="h-6 w-6" />}<span className="font-semibold">{g.away.abbrev}</span>
        {(done || live) ? <span className="num font-bold">{g.away.score}</span> : <span className="text-mute">@</span>}
        {(done || live) && <span className="text-mute">–</span>}
        {(done || live) && <span className="num font-bold">{g.home.score}</span>}
        {g.home.logo && <img src={g.home.logo} alt="" className="h-6 w-6" />}<span className="font-semibold">{g.home.abbrev}</span>
        <span className="ml-auto flex items-center gap-1">{gmsIn(g).slice(0, 4).map((t) => <TeamBadge key={t} team={team(t)} size={13} />)}{(g.recap || g.condensed) && <Play size={12} className="ml-1 text-sky-300" />}</span>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* the lead: live games first, else tonight's slate, else last night's finals */}
      <Section title={liveGames.length ? '🔴 Live right now' : upcoming.length ? `🏒 Tonight · ${upcoming.length} game${upcoming.length === 1 ? '' : 's'}` : finals.length ? `🏒 Last night` : '🏒 Games'} right={<Link to="/nhl?t=scores" className="text-xs text-sky-300">All scores ›</Link>}>
        {!today ? <div className="card p-4 text-sm text-mute">Loading…</div>
          : liveGames.length ? <div className="card divide-y divide-white/[.05]">{liveGames.map((g) => <GameRow key={g.id} g={g} />)}</div>
          : upcoming.length ? <div className="card divide-y divide-white/[.05]">{upcoming.slice(0, 6).map((g) => <GameRow key={g.id} g={g} />)}{upcoming.length > 6 && <Link to="/nhl?t=scores" className="block px-3 py-2 text-center text-xs text-sky-300">{upcoming.length - 6} more tonight ›</Link>}</div>
          : finals.length ? <div className="card divide-y divide-white/[.05]">{finals.slice(0, 6).map((g) => <GameRow key={g.id} g={g} />)}</div>
          : <div className="card p-4 text-sm text-mute">No NHL games today. The season opens {fmtDay('2026-10-07')}; until then the draft is the main event. <Link to="/draft" className="text-sky-300">Draft room ›</Link></div>}
      </Section>

      {highlights.length > 0 && (
        <Section title="🎬 Highlights" right={<Link to="/nhl?t=scores" className="text-xs text-sky-300">Every recap ›</Link>}>
          {video && <div className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-black"><div className="flex items-center justify-between px-3 py-1.5 text-xs"><span className="font-semibold">{video.title}</span><button className="text-mute" onClick={() => setVideo(null)}>✕</button></div><div className="aspect-video w-full"><iframe title={video.title} src={BRIGHTCOVE(video.id)} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div></div>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((g) => (
              <div key={g.id} className="card p-3">
                <div className="flex items-center gap-2 text-sm">{g.away.logo && <img src={g.away.logo} alt="" className="h-6 w-6" />}<span className="font-semibold">{g.away.abbrev} {g.away.score}</span><span className="text-mute">@</span><span className="font-semibold">{g.home.abbrev} {g.home.score}</span>{g.home.logo && <img src={g.home.logo} alt="" className="h-6 w-6" />}<span className="ml-auto text-[11px] text-mute">{status(g)}</span></div>
                {g.goals.length > 0 && <div className="mt-1 truncate text-[11px] text-mute">{g.goals.slice(-3).map((x) => `${x.name} (${x.goalsToDate})`).join(' · ')}</div>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {g.recap && <button className="btn-ghost btn-sm" onClick={() => setVideo({ id: g.recap!, title: `${g.away.abbrev} @ ${g.home.abbrev} recap` })}><Play size={13} /> Recap</button>}
                  {g.condensed && <button className="btn-ghost btn-sm" onClick={() => setVideo({ id: g.condensed!, title: `${g.away.abbrev} @ ${g.home.abbrev} condensed` })}><Play size={13} /> Condensed</button>}
                  <button className="btn-ghost btn-sm sm:ml-auto" onClick={() => onGame(g)}>Box score</button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="📰 Top stories" right={<Link to="/nhl?t=news" className="text-xs text-sky-300">All news ›</Link>}>
        {!news ? <div className="card p-4 text-sm text-mute">Loading…</div> : !headlines.length ? <div className="card p-4 text-sm text-mute">No headlines right now. Check back soon.</div> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {headlines.map((s, i) => (
              <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className={`card flex overflow-hidden ${i === 0 ? 'sm:col-span-2 lg:col-span-3 sm:flex-row' : 'flex-col'}`}>
                {s.image && <img src={s.image} alt="" className={i === 0 ? 'aspect-video w-full object-cover sm:w-1/2' : 'aspect-video w-full object-cover'} loading="lazy" />}
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-mute"><span className={`font-bold ${s.source === 'NHL.com' ? 'text-slate-200' : s.source === 'Sportsnet' ? 'text-sky-300' : 'text-red-300'}`}>{s.source}</span><span>{ago(s.date, now)}</span></div>
                  <div className={`font-semibold leading-snug ${i === 0 ? 'text-lg' : ''}`}>{s.headline}</div>
                  {s.summary && <div className={`text-xs text-slate-400 ${i === 0 ? 'line-clamp-4' : 'line-clamp-2'}`}>{s.summary}</div>}
                </div>
              </a>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="𝕏 Insiders" right={<Link to="/nhl?t=x" className="text-xs text-sky-300">Full feed ›</Link>}>
          {!x ? <div className="card p-4 text-sm text-mute">Loading…</div> : !x.configured || posts.length === 0 ? <div className="card p-4 text-sm text-mute">Nothing from the insiders in the last two days.</div> : (
            <div className="card divide-y divide-white/[.05]">
              {posts.map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block px-3 py-2 hover:bg-white/[.03]">
                  <div className="flex items-center gap-2 text-[11px] text-mute"><span className="font-semibold text-slate-200">{p.author.name}</span><span>@{p.author.handle}</span><span>· {ago(p.at, now)}</span><ExternalLink size={10} className="ml-auto" /></div>
                  <div className="mt-0.5 line-clamp-3 text-sm">{p.text.replace(/https:\/\/t\.co\/\S+/g, '').trim()}</div>
                </a>
              ))}
            </div>
          )}
        </Section>

        <Section title="🩹 Injury watch" right={<Link to="/nhl?t=injuries" className="text-xs text-sky-300">Full report ›</Link>}>
          {hurt.length === 0 ? <div className="card p-4 text-sm text-mute">No league players on the injury list. Enjoy it.</div> : (
            <div className="card divide-y divide-white/[.05]">
              {hurt.map((p) => { const o = owner.get(p.id); const t = o ? team(o.team_id) : undefined; const b = injuryBadge(p.injury_status); return (
                <button type="button" key={p.id} onClick={() => (info ? info(p.id) : nav(`/player/${p.id}`))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[.03]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.name} <span className="text-[11px] font-normal text-mute">{p.nhl_team} · {p.pos}</span></span>
                    {(p.injury_part || p.injury_return) && <span className="block truncate text-[11px] text-red-200">{[p.injury_part, injuryBack(p.injury_return)].filter(Boolean).join(' · ')}</span>}
                  </span>
                  {b && <span className={`chip ${b.cls}`}>{b.label}</span>}
                  {t && <TeamBadge team={t} size={16} />}{o?.team_id === me?.id && <span className="text-[10px] text-amber-200">yours</span>}
                </button>
              ); })}
            </div>
          )}
        </Section>
      </div>

      {seasonOn && (
        <Section title="📈 Scoring race" right={<Link to="/nhl?t=leaders" className="text-xs text-sky-300">All leaders ›</Link>}>
          <div className="card divide-y divide-white/[.05]">
            {topPts.map((l, i) => { const o = owner.get(l.id); const t = o ? team(o.team_id) : undefined; return (
              <div key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm"><span className="num w-4 text-mute">{i + 1}</span>{l.headshot && <img src={l.headshot} alt="" className="h-7 w-7 rounded-full bg-white/10" />}<span className="flex-1 font-semibold">{l.name} <span className="text-[11px] font-normal text-mute">{l.team}</span></span>{t && <TeamBadge team={t} size={14} />}<span className="num font-bold">{l.value}</span></div>
            ); })}
          </div>
        </Section>
      )}

      <div className="scroll-x flex gap-1.5">
        {([['scores', '🏒 Scores'], ['news', '📰 News'], ['injuries', '🩹 Injuries'], ['x', '𝕏 Insiders'], ['standings', '🏆 Standings'], ['leaders', '📈 Leaders'], ['teams', '🛡️ Teams'], ['schedule', '📅 Schedule']] as const).map(([k, l]) => <Link key={k} to={`/nhl?t=${k}`} className="chip shrink-0 py-1.5 text-xs hover:bg-white/[.1]">{l} ›</Link>)}
      </div>
      <p className="px-1 text-[11px] text-mute"><Radio size={10} className="inline" /> Scores every 20 seconds while games are on, news every ten minutes, insiders every five, injuries hourly. Badges mark which GM owns a player.</p>
    </div>
  );
}
