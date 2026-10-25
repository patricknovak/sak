// A league's own fan zone (25 October 2026, the NFL, the NBA and the Premier League beside the NHL): #/fans/<league>, open
// to everyone. Every club with its record, its grade and its chances (src/lib/fanSport.ts plays the season out once for
// all of them), the race in each conference or the whole table, the league's leaders, and the league's own voice: the
// fans' calls on the title and the awards, the league board and its knowledge base.
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Activity, BookOpen, Code2, Megaphone, Trophy, Users } from 'lucide-react';
import { chance, type SportLeague } from '../lib/fanSport';
import { fanIndex, fanLeaguesIndex, useFanDir, zoneLink, zonePath, type FanIndex } from '../lib/fanVoice';
import { leagueTheme, leagueVars, sportTheme } from '../data/clubColors';
import { LoadError, Spinner } from '../components/ui';
import { ClubMark, Head } from '../components/fan/kit';
import { FanCalls, FanMeBar, FanVoiceProvider } from '../components/fan/FanVoice';
import { FanBoard, FanKnowledge } from '../components/fan/FanBoard';
import { ShareButton } from '../components/fan/FanShare';
import { LeaderBoards, RaceTable, recordOfRow, useLeagueRead, useSportLeague } from '../components/fan/SportBits';

// the leader boards worth showing first, by sport
const LEAD_CATS: Record<string, string[]> = {
  football: ['passingYards', 'rushingYards', 'receivingYards', 'sacks', 'totalTackles', 'interceptions'],
  basketball: ['pointsPerGame', 'reboundsPerGame', 'assistsPerGame', 'stealsPerGame', 'blocksPerGame', 'fieldGoalPercentage'],
  soccer: ['goals', 'assists'],
};

export default function SportFanLeague({ league }: { league: string }) {
  const { dir, failed: dirFailed } = useFanDir(league);
  const L = useSportLeague(league);
  const l = L.data;
  const { tb, out } = useLeagueRead(l);
  const { search } = useLocation();
  const post = Number(new URLSearchParams(search).get('post')) || null;
  const [idx, setIdx] = useState<FanIndex>({});
  const [people, setPeople] = useState<number | null>(null);
  useEffect(() => {
    if (!dir) return;
    document.title = `${dir.name} fan zones · Super Pools`;
    fanIndex(league).then(setIdx, () => {});
    fanLeaguesIndex().then((x) => setPeople(x[league]?.people ?? 0), () => {});
  }, [dir, league]);
  useEffect(() => { if (post) setTimeout(() => document.getElementById('fz-league')?.scrollIntoView({ behavior: 'smooth' }), 400); }, [post]);
  const fav = useMemo(() => (out ? Object.entries(out.chances).sort((a, b) => b[1].title - a[1].title)[0] : null), [out]);

  if (dirFailed) return <Navigate to="/fans" replace />;
  if (!dir) return <div className="flex justify-center py-20"><Spinner /></div>;
  const t = leagueTheme(league);
  const sport = dir.sport as SportLeague['sport'];
  const groups = sport === 'soccer' ? [null] : [...new Set(dir.clubs.map((c) => c.conf))].sort();
  const favClub = fav ? dir.byCode[fav[0]] : null;

  return (
    <div className="space-y-6" style={leagueVars(league)}>
      <div className="relative overflow-hidden rounded-[28px] border border-white/10 p-5 sm:p-7" style={{ background: `radial-gradient(110% 80% at 100% 0%, rgb(${t.rgb} / .28), transparent 60%), linear-gradient(160deg, ${t.secondary}, #070b16 80%)` }}>
        <div className="pointer-events-none absolute -right-8 -top-8 opacity-[.1]"><ClubMark league={league} code={dir.board} size={230} /></div>
        <div className="relative">
          <div className="flex items-center gap-2"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/95"><ClubMark league={league} code={dir.board} size={32} light /></span><span className="text-[11px] font-bold uppercase tracking-[.22em]" style={{ color: t.primary }}>Fan zones · free and open</span></div>
          <h1 className="mt-2 font-display text-[clamp(28px,8.5vw,46px)] font-extrabold italic leading-[.92] text-white">Every {dir.name} club, read like a front office</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-snug text-slate-300">All {dir.clubs.length} clubs from ESPN&apos;s public numbers: the grade, the {sport === 'soccer' ? 'title, Europe and relegation' : 'playoff and title'} chances, the luck, the players and the front office&apos;s bigger questions. Make your calls, post your ideas and build your club&apos;s knowledge base.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="#fz-clubs" onClick={(e) => { e.preventDefault(); document.getElementById('fz-clubs')?.scrollIntoView({ behavior: 'smooth' }); }} className="btn-club px-4 py-2.5">Find your club</a>
            <Link to="/fans/about" className="btn-ghost px-4 py-2.5"><BookOpen className="h-4 w-4" />How it works</Link>
            <ShareButton url={zoneLink(league)} title={`${dir.name} fan zones`} text={`Every ${dir.name} club read like a front office, free and open, with the fans' own calls and ideas.`} className="btn-ghost px-4 py-2.5" />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-400">
            {people != null && <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{people} fan{people === 1 ? '' : 's'} taking part this season</span>}
            {favClub && fav && <span className="flex items-center gap-1"><Trophy className="h-3.5 w-3.5" />Favourites: {favClub.short} ({chance(fav[1].title)})</span>}
            <Link to="/fans" className="flex items-center gap-1 hover:text-white">The other leagues</Link>
            <a href="https://github.com/patricknovak/sak" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-white"><Code2 className="h-3.5 w-3.5" />Open source, MIT</a>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <Head id="clubs" title="Pick a club" sub="Every club's zone: the verdict, the chances, the numbers, the games, the players, the front office and the fans." />
        {!l && (L.failed ? <LoadError what={`the ${dir.name}`} onRetry={L.retry} /> : null)}
        {groups.map((conf) => {
          const inConf = dir.clubs.filter((c) => conf == null || c.conf === conf);
          const divs = sport === 'soccer' ? [null] : [...new Set(inConf.map((c) => c.div))].sort();
          return (
            <div key={conf ?? 'all'} className="space-y-2">
              {conf && <div className="px-1 font-display text-lg font-extrabold text-white">{conf}</div>}
              {divs.map((dv) => {
                const rows = inConf.filter((c) => dv == null || c.div === dv).map((c) => ({ c, r: l?.clubs.find((x) => x.code === c.code) ?? null }))
                  .sort((a, b) => sport === 'soccer' ? (a.r?.seed ?? 99) - (b.r?.seed ?? 99) : ((b.r ? (b.r.w + b.r.d / 2) / Math.max(1, b.r.gp) : 0) - (a.r ? (a.r.w + a.r.d / 2) / Math.max(1, a.r.gp) : 0)) || a.c.name.localeCompare(b.c.name));
                return (
                  <div key={dv ?? 'all'}>
                    {dv && <div className="label mb-1.5 px-1">{dv.replace(new RegExp(`^${conf} `), '')}</div>}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {rows.map(({ c, r }) => {
                        const th = sportTheme(c.color, c.alt), x = idx[c.code], ch = out?.chances[c.code];
                        return (
                          <Link key={c.code} to={zonePath(league, c.code)} className="group relative flex min-h-[118px] flex-col overflow-hidden rounded-2xl border p-2.5 transition hover:-translate-y-0.5"
                            style={{ borderColor: `rgb(${th.rgb} / .3)`, background: `radial-gradient(120% 100% at 100% 0%, rgb(${th.rgb} / .22), transparent 60%), linear-gradient(160deg, ${th.secondary}, #070b16 85%)` }}>
                            <div className="flex items-center gap-2">
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/95"><ClubMark league={league} code={c.code} logo={c.logo} size={26} light /></span>
                              <span className="min-w-0 flex-1 text-[13px] font-bold leading-tight text-white">{c.name}</span>
                            </div>
                            {r && <div className="num mt-2 text-[12px] text-slate-300">{recordOfRow(sport, r)}{sport === 'soccer' ? <> · <b className="text-white">{r.pts} pts</b></> : null}{tb?.grades[c.code] ? <> · grade <b className="text-white">{tb.grades[c.code].grade}</b></> : null}</div>}
                            {ch && <div className="num text-[11px] text-slate-400">{sport === 'soccer' ? `Top four ${chance(ch.top4)} · down ${chance(ch.relegated)}` : `Playoffs ${chance(ch.playoffs)} · title ${chance(ch.title)}`}</div>}
                            <div className="mt-auto flex items-center gap-1 pt-1.5 text-[11px]" style={{ color: th.primary }}>
                              {x?.top ? <span className="line-clamp-1 min-w-0 text-slate-300">💡 {x.top.title}</span> : <span className="text-mute group-hover:text-slate-300">Open the zone</span>}
                              {x?.people ? <span className="ml-auto flex shrink-0 items-center gap-0.5 font-semibold"><Users className="h-3 w-3" />{x.people}</span> : null}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      {l && (
        <section className="space-y-3">
          <Head id="race" title={sport === 'soccer' ? 'The table and the chances' : 'The races'} sub={`Every club's chances from the rest of the season played out ${out ? out.sims.toLocaleString() : 'a few thousand'} times. Tap a club for its zone.`} />
          {groups.map((conf) => (
            <div key={conf ?? 'all'} className="space-y-1.5">
              {conf && <div className="px-1 font-display text-base font-extrabold text-white">{conf}</div>}
              <RaceTable l={l} out={out} conf={conf} grades={tb?.grades} />
            </div>
          ))}
        </section>
      )}

      {l && l.leaders.length > 0 && (
        <section className="space-y-3">
          <Head id="leaders" title="The leaders" sub={`The ${dir.name}'s best this season, from ESPN.`} />
          <LeaderBoards l={l} cats={LEAD_CATS[sport]} />
        </section>
      )}

      {/* the league as a whole: its own calls, board and knowledge base */}
      <FanVoiceProvider club={dir.board} league={league} dir={dir}>
        <section className="space-y-3">
          <Head id="league" title="The whole league" sub={`Calls on the ${sport === 'soccer' ? 'title, the drop' : 'title'} and the awards, ideas for the game itself, and the league's knowledge base.`} right={<Link to={zonePath(league, dir.board, 'pulse')} className="shrink-0 text-sm font-semibold" style={{ color: 'var(--club)' }}><Activity className="mr-1 inline h-3.5 w-3.5" />League pulse</Link>} />
          <FanMeBar />
          <FanCalls sport={{ league: l }} />
          <div className="px-1 pt-1"><div className="flex items-center gap-1.5 font-display text-lg font-extrabold text-white"><Megaphone className="h-4 w-4" style={{ color: 'var(--club)' }} />The league board</div><p className="text-[13px] text-mute">Rules, the schedule, the officiating, the game itself: what would you change?</p></div>
          <FanBoard post={post} />
          <div className="px-1 pt-1"><div className="flex items-center gap-1.5 font-display text-lg font-extrabold text-white"><BookOpen className="h-4 w-4" style={{ color: 'var(--club)' }} />The league&apos;s knowledge base</div><p className="text-[13px] text-mute">Records, stories and trivia from across the {dir.name}, added by fans.</p></div>
          <FanKnowledge />
        </section>
      </FanVoiceProvider>
      <p className="px-1 text-[11px] leading-snug text-mute">Super Pools fan zones are made by fans, from ESPN&apos;s public numbers. Not affiliated with the {dir.name} or its clubs; team names and logos belong to them.</p>
    </div>
  );
}
