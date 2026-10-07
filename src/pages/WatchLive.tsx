// Watch live (#/watch): the night's NHL games from the GM's side of the couch. The game that matters most to their team
// first, then every game with whether they can watch it on what they have (their TV provider, their streaming services,
// free on CBC Gem) and a one-tap way in, team radio to listen, their players in it with live fantasy points, and the
// NHL's own recap once it's over. SaK can't stream games itself: the rights belong to the broadcasters, so every way in
// is the broadcaster's own player (docs/WATCH-LIVE.md has the research and the guide to seeing every game).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ExternalLink, Headphones, MonitorPlay, Play, Settings2, Tv, Users } from 'lucide-react';
import { useLeague } from '../lib/store';
import { hub } from '../lib/nhlhub';
import { supabase } from '../lib/supabase';
import { fmtPts, fmtTime } from '../lib/format';
import { isStart } from '../lib/lineupKit';
import { countryOf, playerFor, verdict, watchOptions, type Verdict } from '../lib/watch';
import { WATCH_GUIDE } from '../lib/watchGuide';
import { DONE, LIVE, NET, RadioPlayer, Video, WatchBox, openTab } from '../components/LiveWatch';
import { PageHeader, Section, TeamBadge } from '../components/ui';
import type { Player } from '../lib/types';

type NTeam = { id: number; abbrev: string; name: string; place: string; score: number | null; sog: number | null; logo: string | null; radio: string | null; record: string | null };
type Game = { id: number; type: number; state: string; scheduleState: string; start: string; venue: string; period: { n: number; type: string } | null; clock: { time: string; running: boolean; intermission: boolean } | null; home: NTeam; away: NTeam; outcome: string | null; tv: { network: string; market: string; country: string }[]; recap: string | null; condensed: string | null; link: string | null };
type Scores = { date: string; prev: string | null; next: string | null; games: Game[] };

const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const per = (g: Game) => (!g.period ? '' : g.period.type === 'REG' ? `P${g.period.n}` : g.period.type);
const status = (g: Game) => {
  if (g.scheduleState === 'PPD') return 'Postponed';
  if (DONE.has(g.state)) return g.outcome && g.outcome !== 'REG' ? `Final/${g.outcome}` : 'Final';
  if (LIVE.has(g.state)) return g.clock?.intermission ? `End of ${per(g)}` : `${per(g)} · ${g.clock?.time ?? ''}`;
  return fmtTime(g.start);
};
const TONE: Record<Verdict['state'], string> = {
  yes: 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/40', free: 'bg-sky-400/15 text-sky-200 ring-sky-400/40',
  maybe: 'bg-amber-400/15 text-amber-200 ring-amber-400/40', no: 'bg-white/[.05] text-slate-300 ring-white/15', none: 'bg-white/[.04] text-mute ring-white/10',
};
const MARK: Record<Verdict['state'], string> = { yes: '✓', free: '★', maybe: '~', no: '🔒', none: '·' };

export default function WatchLive() {
  const { me, players, rosters, teams, team, leagueDay } = useLeague();
  const [date, setDate] = useState(leagueDay);
  const [scores, setScores] = useState<Scores | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fp, setFp] = useState<Map<number, number>>(new Map());
  const [radio, setRadio] = useState<{ url: string; label: string } | null>(null);
  const [video, setVideo] = useState<{ id: string; title: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { setDate(leagueDay); }, [leagueDay]);

  const load = useCallback(async (d: string) => {
    try { const s = await hub<Scores>('scores', { date: d }); setScores({ ...s, games: s?.games ?? [] }); setErr(null); } catch (e) { setErr((e as Error).message); }
    supabase.from('league_games').select('player_id,fpts').eq('date', d).limit(2000)
      .then(({ data }) => setFp(new Map((data ?? []).map((r) => [r.player_id as number, Number(r.fpts)]))));
  }, []);
  useEffect(() => { setScores(null); load(date); }, [date, load]);
  const anyLive = !!scores?.games.some((g) => LIVE.has(g.state));
  useEffect(() => {
    if (date !== leagueDay) return;
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') load(date); }, anyLive ? 30_000 : 120_000);
    return () => window.clearInterval(i);
  }, [date, leagueDay, anyLive, load]);

  // every league player by NHL club: whose he is and whether he starts tonight (today's lineup is the live one)
  const byClub = useMemo(() => {
    const m = new Map<string, { p: Player; team_id: number; start: boolean }[]>();
    for (const r of rosters) {
      const p = players.get(r.player_id);
      if (!p?.nhl_team || r.slot === 'IR') continue;
      const list = m.get(p.nhl_team) ?? [];
      list.push({ p, team_id: r.team_id, start: isStart(r.slot) });
      m.set(p.nhl_team, list);
    }
    return m;
  }, [rosters, players]);
  const stakeOf = (g: Game) => {
    const all = [...(byClub.get(g.away.abbrev) ?? []), ...(byClub.get(g.home.abbrev) ?? [])];
    const mine = all.filter((x) => x.team_id === me?.id).sort((a, b) => Number(b.start) - Number(a.start) || b.p.proj - a.p.proj);
    const others = new Map<number, number>();
    for (const x of all) if (x.team_id !== me?.id && x.start) others.set(x.team_id, (others.get(x.team_id) ?? 0) + 1);
    return { mine, starters: mine.filter((x) => x.start).length, others: [...others].sort((a, b) => b[1] - a[1]), league: all.filter((x) => x.start).length };
  };

  const games = scores?.games ?? [];
  const rows = games.map((g) => ({ g, v: verdict(g.tv, me?.tv), s: stakeOf(g) }));
  // the order: on now, then still to come by how much of your team is in it, then the finals
  const rank = (r: (typeof rows)[number]) => (LIVE.has(r.g.state) ? 0 : DONE.has(r.g.state) ? 2 : 1);
  rows.sort((a, b) => rank(a) - rank(b) || b.s.starters - a.s.starters || b.s.league - a.s.league || a.g.start.localeCompare(b.g.start));
  const pick = rows.filter((r) => !DONE.has(r.g.state)).sort((a, b) => b.s.starters - a.s.starters || Number(b.v.state === 'yes' || b.v.state === 'free') - Number(a.v.state === 'yes' || a.v.state === 'free') || b.s.league - a.s.league)[0];
  const watchable = rows.filter((r) => r.v.state === 'yes' || r.v.state === 'free').length;
  const myTonight = rows.reduce((n, r) => n + r.s.starters, 0);
  const myLive = rows.reduce((n, r) => n + r.s.mine.reduce((k, x) => k + (fp.get(x.p.id) ?? 0), 0), 0);
  const player = playerFor(me?.tv?.provider);
  const setup = me?.tv?.provider || (me?.tv?.services ?? []).length;
  const country = countryOf(me?.tv);

  return (
    <div className="space-y-4 pb-10">
      <PageHeader icon={<MonitorPlay className="h-6 w-6 text-gold" />} title="Watch live" sub="Every game tonight: where you can watch it, what it means for your team" />

      {/* the night */}
      <div className="flex items-center gap-2">
        <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/[.05] ring-1 ring-white/10 disabled:opacity-30" disabled={!scores?.prev} onClick={() => scores?.prev && setDate(scores.prev)} aria-label="Earlier"><ChevronLeft className="h-4 w-4" /></button>
        <div className="flex-1 text-center"><div className="font-bold text-white">{date === leagueDay ? 'Tonight' : fmtDay(date)}</div><div className="text-[11px] text-mute">{date === leagueDay ? fmtDay(date) : <button type="button" className="text-sky-300" onClick={() => setDate(leagueDay)}>Back to tonight</button>}</div></div>
        <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/[.05] ring-1 ring-white/10 disabled:opacity-30" disabled={!scores?.next} onClick={() => scores?.next && setDate(scores.next)} aria-label="Later"><ChevronRight className="h-4 w-4" /></button>
      </div>

      <div className="card-hero overflow-hidden p-4">
        <div className="relative space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[['Games', String(games.length), anyLive ? `${games.filter((g) => LIVE.has(g.state)).length} on now` : 'on the slate'], ['You can watch', setup ? String(watchable) : '?', setup ? `of ${games.length}` : 'set up below'], ['Your starters', String(myTonight), myLive ? `${fmtPts(myLive)} pts so far` : 'playing']].map(([k, v, s]) => (
              <div key={k} className="rounded-2xl bg-black/25 px-3 py-2 ring-1 ring-white/10">
                <div className="text-[10px] font-bold uppercase tracking-[.14em] text-white/60">{k}</div>
                <div className="num text-2xl font-black leading-tight text-white">{v}</div>
                <div className="text-[10px] text-white/60">{s}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/80">
            <Tv className="h-4 w-4 text-gold" />
            {setup ? <span className="min-w-0 flex-1">Watching from {country === 'CA' ? 'Canada 🇨🇦' : 'the US 🇺🇸'}{me?.tv?.provider ? <> with <b className="text-white">{me.tv.provider}</b>{player ? ` (${player.name})` : ''}</> : ''}{(me?.tv?.services ?? []).length ? <> · {(me?.tv?.services ?? []).length} streaming service{(me?.tv?.services ?? []).length === 1 ? '' : 's'}</> : ''}</span>
              : <span className="min-w-0 flex-1">Tell us your TV provider and streaming services, and every game says whether you can watch it.</span>}
            <Link to="/profile" className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-semibold text-white ring-1 ring-white/15"><Settings2 className="h-3.5 w-3.5" /> {setup ? 'Change' : 'Set up'}</Link>
          </div>
        </div>
      </div>

      {err && <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">The NHL schedule didn’t load: {err}</div>}
      {!scores && !err && <div className="h-40 animate-pulse rounded-3xl bg-white/[.04]" />}
      {scores && !games.length && <div className="card p-6 text-center text-sm text-mute">No NHL games {date === leagueDay ? 'tonight' : `on ${fmtDay(date)}`}.</div>}

      {/* the one to watch */}
      {pick && pick.s.starters > 0 && (
        <Section title="The one to watch">
          <GameRow r={pick} hero fp={fp} team={team} open={open === pick.g.id} onToggle={() => setOpen(open === pick.g.id ? null : pick.g.id)}
            onRadio={setRadio} onVideo={setVideo} radio={radio} video={video} />
        </Section>
      )}

      {rows.length > 0 && (
        <Section title={date === leagueDay ? 'Every game tonight' : 'Every game'} right={anyLive ? <span className="text-[11px] text-mute">Live: refreshes every 30 s</span> : undefined}>
          <div className="space-y-2">
            {rows.filter((r) => r !== pick || pick.s.starters === 0).map((r) => (
              <GameRow key={r.g.id} r={r} fp={fp} team={team} open={open === r.g.id} onToggle={() => setOpen(open === r.g.id ? null : r.g.id)}
                onRadio={setRadio} onVideo={setVideo} radio={radio} video={video} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[10px] text-mute">
            {(['yes', 'free', 'maybe', 'no'] as const).map((k) => <span key={k}><span className={`mr-1 inline-grid h-4 min-w-4 place-items-center rounded-full px-1 ring-1 ${TONE[k]}`}>{MARK[k]}</span>{{ yes: 'You can watch', free: 'Free', maybe: 'Regional, if you’re in the area', no: 'Needs a service you don’t have' }[k]}</span>)}
          </div>
        </Section>
      )}

      {/* listening in the car, or the recap after */}
      {radio && <div className="fixed inset-x-0 bottom-[84px] z-40 px-4 md:bottom-6"><div className="mx-auto max-w-md shadow-[0_12px_32px_rgba(0,0,0,.5)]"><RadioPlayer url={radio.url} label={radio.label} onClose={() => setRadio(null)} /></div></div>}

      {/* who else is watching what */}
      {rows.some((r) => !DONE.has(r.g.state) && r.s.others.length) && (
        <Section title="Where the league has skin in it">
          <div className="card divide-y divide-white/[.05] p-1">
            {teams.filter((t) => t.role !== 'spectator').map((t) => {
              const in_ = rows.filter((r) => !DONE.has(r.g.state)).map((r) => ({ r, n: t.id === me?.id ? r.s.starters : r.s.others.find(([id]) => id === t.id)?.[1] ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
              if (!in_.length) return null;
              return (
                <div key={t.id} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${t.id === me?.id ? 'bg-gold/[.06]' : ''}`}>
                  <TeamBadge team={t} size={28} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white">{t.id === me?.id ? 'You' : t.gm_name}</div>
                    <div className="flex flex-wrap gap-1 pt-0.5">{in_.slice(0, 5).map(({ r, n }) => <span key={r.g.id} className="num rounded-full bg-white/[.05] px-2 py-px text-[10px] text-slate-300 ring-1 ring-white/10">{r.g.away.abbrev}-{r.g.home.abbrev} <b className="text-white">{n}</b></span>)}</div></div>
                  <span className="num shrink-0 text-lg font-black text-white">{in_.reduce((k, x) => k + x.n, 0)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-mute">Starters each GM has in the games still to finish. <Link to="/chat" className="text-sky-300">Talk about it in chat →</Link></p>
        </Section>
      )}

      <WatchGuide country={country} />
    </div>
  );
}

type Row = { g: Game; v: Verdict; s: { mine: { p: Player; team_id: number; start: boolean }[]; starters: number; others: [number, number][]; league: number } };
type TeamOf = ReturnType<typeof useLeague>['team'];

// one game: the score, whether you can watch and a one-tap way in, radio, your players with live points; tap to open
// every way to watch, the recap and the NHL.com game page
function GameRow({ r, hero, fp, team, open, onToggle, onRadio, onVideo, radio, video }: {
  r: Row; hero?: boolean; fp: Map<number, number>; team: TeamOf; open: boolean; onToggle: () => void;
  onRadio: (x: { url: string; label: string } | null) => void; onVideo: (x: { id: string; title: string } | null) => void;
  radio: { url: string } | null; video: { id: string; title: string } | null;
}) {
  const { me } = useLeague();
  const { g, v, s } = r;
  const live = LIVE.has(g.state), done = DONE.has(g.state);
  const myPts = s.mine.reduce((k, x) => k + (fp.get(x.p.id) ?? 0), 0);
  const nets = [...new Set(g.tv.filter((t) => t.country === countryOf(me?.tv)).map((t) => NET[t.network] ?? t.network))];
  const opts = watchOptions(g.tv, me?.tv);
  return (
    <div className={`${hero ? 'card-hero' : 'card'} overflow-hidden ${live ? 'ring-1 ring-red-400/40' : ''}`}>
      <div className="relative">
        <button type="button" onClick={onToggle} className="block w-full p-3 text-left">
          <div className="mb-2 flex items-center gap-2 text-[11px]">
            <span className={`font-bold uppercase tracking-wider ${live ? 'text-red-300' : 'text-mute'}`}>{live && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 align-middle" />}{status(g)}</span>
            {nets.length > 0 && <span className="min-w-0 flex-1 truncate text-right text-mute">📺 {nets.join(' · ')}</span>}
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              {[g.away, g.home].map((t, i) => {
                const other = i === 0 ? g.home : g.away;
                const lost = done && t.score != null && other.score != null && t.score < other.score;
                return (
                  <div key={t.abbrev} className={`flex items-center gap-2 ${lost ? 'opacity-55' : ''}`}>
                    {t.logo ? <img src={t.logo} alt="" className={hero ? 'h-9 w-9' : 'h-7 w-7'} /> : <span className="h-7 w-7" />}
                    <span className={`min-w-0 flex-1 font-bold leading-tight text-white ${hero ? 'text-base' : 'text-sm'}`}>{t.place ? `${t.place} ${t.name}` : t.name}</span>
                    <span className={`num font-black text-white ${hero ? 'text-3xl' : 'text-2xl'}`}>{t.score ?? ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {!done && <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${TONE[v.state]}`}><span>{MARK[v.state]}</span>{v.line}</span>}
            {s.mine.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-semibold text-gold ring-1 ring-gold/40">{s.starters} of yours{s.mine.length > s.starters ? ` (+${s.mine.length - s.starters} benched)` : ''}{(live || done) && ` · ${fmtPts(myPts)} pts`}</span>}
            {s.others.slice(0, 4).map(([t, n]) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-white/[.05] py-0.5 pl-0.5 pr-2 text-[10px] text-slate-300 ring-1 ring-white/10"><TeamBadge team={team(t)} size={16} />{n}</span>)}
          </div>
        </button>

        {/* the quick ways in, without opening the card */}
        <div className="flex flex-wrap gap-1.5 border-t border-white/[.06] px-3 py-2">
          {!done && v.best && <button type="button" onClick={() => openTab(v.best!.url)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${v.state === 'yes' || v.state === 'free' ? 'btn-gold' : 'bg-white/[.06] text-white ring-1 ring-white/15'}`}><Tv className="h-3.5 w-3.5" /> {v.state === 'no' ? `Get ${v.best.name}` : `Watch on ${v.best.name}`} <ExternalLink className="h-3 w-3 opacity-70" /></button>}
          {!done && [g.away, g.home].filter((t) => t.radio).map((t) => <button key={t.abbrev} type="button" onClick={() => onRadio(radio?.url === t.radio ? null : { url: t.radio!, label: `${t.abbrev}` })} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${radio?.url === t.radio ? 'bg-emerald-400/20 text-emerald-100 ring-emerald-400/50' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}><Headphones className="h-3.5 w-3.5" /> {t.abbrev} radio</button>)}
          {done && g.recap && <button type="button" onClick={() => onVideo({ id: g.recap!, title: `${g.away.abbrev} @ ${g.home.abbrev}: recap` })} className="inline-flex items-center gap-1 rounded-full bg-white/[.06] px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15"><Play className="h-3.5 w-3.5" /> Recap</button>}
          {done && g.condensed && <button type="button" onClick={() => onVideo({ id: g.condensed!, title: `${g.away.abbrev} @ ${g.home.abbrev}: condensed game` })} className="inline-flex items-center gap-1 rounded-full bg-white/[.06] px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15"><Play className="h-3.5 w-3.5" /> Condensed game</button>}
          <button type="button" onClick={onToggle} className="ml-auto text-[11px] font-semibold text-sky-300">{open ? 'Less' : 'More'}</button>
        </div>
        {video && (video.title.startsWith(`${g.away.abbrev} @ ${g.home.abbrev}`)) && <div className="px-3 pb-3"><Video id={video.id} title={video.title} onClose={() => onVideo(null)} /></div>}

        {open && (
          <div className="space-y-3 border-t border-white/[.06] p-3">
            {!done && opts.length > 0 && <WatchBox watch={opts} channels={nets} />}
            {s.mine.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-mute">Your players</div>
                <div className="flex flex-wrap gap-1.5">
                  {s.mine.map(({ p, start }) => (
                    <Link key={p.id} to={`/player/${p.id}`} className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs ring-1 ${start ? 'bg-gold/10 ring-gold/40' : 'bg-white/[.04] ring-white/10 opacity-70'}`}>
                      {p.headshot ? <img src={p.headshot} alt="" className="h-6 w-6 rounded-full bg-white/10 object-cover" /> : <span className="h-6 w-6 rounded-full bg-white/10" />}
                      <span className="font-semibold text-white">{p.last_name ?? p.name}</span>
                      <span className="text-[10px] text-mute">{p.nhl_team}{start ? '' : ' · BN'}</span>
                      {fp.has(p.id) && <span className={`num font-black ${(fp.get(p.id) ?? 0) > 0 ? 'text-gold' : 'text-slate-400'}`}>{fmtPts(fp.get(p.id)!)}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {g.link && <a href={g.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-white/[.04] px-3 py-1.5 text-xs font-semibold text-slate-200 ring-1 ring-white/10"><Tv className="h-3.5 w-3.5" /> Game page on NHL.com <ExternalLink className="h-3 w-3" /></a>}
              <Link to="/nhl?t=scores" className="inline-flex items-center gap-1 rounded-full bg-white/[.04] px-3 py-1.5 text-xs font-semibold text-slate-200 ring-1 ring-white/10"><Users className="h-3.5 w-3.5" /> Box score and lines in NHL centre</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// how to see every game, from the research (docs/WATCH-LIVE.md): the options for where the GM watches from first
function WatchGuide({ country }: { country: 'CA' | 'US' }) {
  const [c, setC] = useState<'CA' | 'US'>(country);
  useEffect(() => setC(country), [country]);
  const g = WATCH_GUIDE[c];
  if (!WATCH_GUIDE.CA.options.length) return null;
  return (
    <Section title="How to see every game" right={<div className="flex gap-1">{(['CA', 'US'] as const).map((k) => <button key={k} type="button" onClick={() => setC(k)} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c === k ? 'bg-gold text-[#0b1220]' : 'bg-white/[.05] text-mute'}`}>{k === 'CA' ? '🇨🇦 Canada' : '🇺🇸 US'}</button>)}</div>}>
      <div className="space-y-2">
        <p className="px-1 text-xs leading-snug text-slate-300">{g.intro}</p>
        {g.options.map((o) => (
          <div key={o.name} className="card p-3.5">
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
          <div className="card p-3.5">
            <div className="mb-1 flex items-center gap-1.5 font-bold text-white"><Users className="h-4 w-4 text-gold" /> Watching together</div>
            <ul className="space-y-1 text-xs leading-snug text-mute">{g.together.map((t) => <li key={t}>• {t}</li>)}</ul>
          </div>
        )}
        <p className="px-1 text-[11px] leading-snug text-mute">{g.note}</p>
      </div>
    </Section>
  );
}
