// The fan zones (25 October 2026, Patrick: "make the new fan page and analysis an open source type project on the
// homepage for all the different NHL teams"): #/fans, open to everyone. Every league with a fan zone (the NFL, the NBA and
// the Premier League beside the NHL since migration 338, each with its own page at #/fans/<league>), then the NHL's
// clubs by division with their line in the table and how busy their fans are, and the NHL's own: the fans' calls for
// the Cup and the awards, the league-wide board and the knowledge base. How it all works is #/fans/about.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, BookOpen, Code2, Flame, Lightbulb, Megaphone, Users } from 'lucide-react';
import { hub } from '../lib/nhlhub';
import { fanDir, fanIndex, fanLeaguesIndex, fanLink, useFanLeagues, zonePath, type FanDir, type FanIndex, type FanLeague } from '../lib/fanVoice';
import { DIVISIONS, clubTheme, clubVars, leagueTheme, sportVars } from '../data/clubColors';
import { NHL_TEAMS } from '../lib/format';
import { NhlLogo } from '../components/ui';
import { ClubMark, Head } from '../components/fan/kit';
import { FanCalls, FanMeBar, FanVoiceProvider } from '../components/fan/FanVoice';
import { FanBoard, FanKnowledge } from '../components/fan/FanBoard';
import { ShareButton } from '../components/fan/FanShare';

const CLUB_KEY = 'sp-fan-club';
const rankWord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

const SPORT_WORD: Record<string, string> = { hockey: 'Hockey', football: 'Football', basketball: 'Basketball', soccer: 'Football (soccer)' };

export default function FansIndex() {
  const [idx, setIdx] = useState<FanIndex>({});
  const [league, setLeague] = useState<FanLeague | null>(null);
  const leagues = useFanLeagues();
  const [lidx, setLidx] = useState<Record<string, { people: number; posts: number; week: number; clubs: number }>>({});
  const [dirs, setDirs] = useState<Record<string, FanDir>>({});
  const { search } = useLocation();
  const post = Number(new URLSearchParams(search).get('post')) || null;
  // the club the fan last opened: an NHL club (EDM) or another league's (nfl/KC)
  const mine = (() => { try { return localStorage.getItem(CLUB_KEY); } catch { return null; } })();
  const [mineLeague, mineClub] = mine && mine.includes('/') ? mine.split('/') : ['nhl', mine];
  useEffect(() => {
    document.title = 'Fan zones · Super Pools';
    fanIndex().then(setIdx, () => {});
    hub<FanLeague>('fan-league').then(setLeague, () => {});
    fanLeaguesIndex().then(setLidx, () => {});
  }, []);
  useEffect(() => {
    let live = true;
    for (const x of leagues ?? []) fanDir(x.key).then((d) => { if (live) setDirs((m) => ({ ...m, [x.key]: d })); }, () => {});
    return () => { live = false; };
  }, [leagues]);
  const mineDir = mineLeague ? dirs[mineLeague] : null;
  const mineName = mineClub ? (mineLeague === 'nhl' ? NHL_TEAMS[mineClub] : mineDir?.byCode[mineClub]?.name) : null;
  useEffect(() => { if (post) setTimeout(() => document.getElementById('fz-league')?.scrollIntoView({ behavior: 'smooth' }), 300); }, [post]);
  const row = new Map((league?.table ?? []).map((r) => [r.abbrev, r]));
  const fans = Object.entries(idx).filter(([k]) => k !== 'NHL').reduce((t, [, x]) => t + x.people, 0);

  return (
    <div className="space-y-6" style={clubVars('NHL')}>
      {/* the open project, in a line, and the way in */}
      <div className="relative overflow-hidden rounded-[28px] border border-white/10 p-5 sm:p-7" style={{ background: 'radial-gradient(110% 80% at 100% 0%, rgba(76,195,255,.22), transparent 60%), radial-gradient(90% 70% at 0% 100%, rgba(255,76,0,.18), transparent 60%), linear-gradient(160deg, #0f1830, #070b16 80%)' }}>
        <div className="pointer-events-none absolute -right-10 -top-10 opacity-[.08]"><NhlLogo abbr="NHL" size={240} /></div>
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.22em] text-sky-300"><Flame className="h-3.5 w-3.5" />Fan zones · free and open</div>
          <h1 className="mt-1.5 font-display text-[clamp(30px,9vw,48px)] font-extrabold italic leading-[.92] text-white">Every club, read like a front office</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-snug text-slate-300">The NHL, the NFL, the NBA and the Premier League: deep analysis of every club from the leagues&apos; public numbers, with the playoff and title chances, the luck, the players and the moves. Make your calls, post your ideas and build your club&apos;s knowledge base. The fan pulse shows the club, and everyone, what its fans think.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {mineClub && mineName && <Link to={zonePath(mineLeague, mineClub)} className="btn-club px-4 py-2.5" style={mineLeague === 'nhl' ? clubVars(mineClub) : sportVars(mineDir?.byCode[mineClub]?.color, mineDir?.byCode[mineClub]?.alt)}><ClubMark league={mineLeague} code={mineClub} logo={mineDir?.byCode[mineClub]?.logo} size={18} />{mineName}<ArrowRight className="h-4 w-4" /></Link>}
            <a href="#fz-leagues" onClick={(e) => { e.preventDefault(); document.getElementById('fz-leagues')?.scrollIntoView({ behavior: 'smooth' }); }} className={mineName ? 'btn-ghost px-4 py-2.5' : 'btn-club px-4 py-2.5'}>Find your club</a>
            <Link to="/fans/about" className="btn-ghost px-4 py-2.5"><BookOpen className="h-4 w-4" />How it works</Link>
            <ShareButton url={fanLink()} title="Fan zones" text="Every NHL, NFL, NBA and Premier League club read like a front office, free and open, with the fans' own calls and ideas." className="btn-ghost px-4 py-2.5" />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-400">
            <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{Object.values(lidx).reduce((t, x) => t + x.people, 0) || fans} fan{(Object.values(lidx).reduce((t, x) => t + x.people, 0) || fans) === 1 ? '' : 's'} taking part this season</span>
            <span className="flex items-center gap-1"><Lightbulb className="h-3.5 w-3.5" />{Object.values(lidx).reduce((t, x) => t + x.clubs, 0) || 114} clubs, the chances, the players and the front office for every one</span>
            <a href="https://github.com/patricknovak/sak" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-white"><Code2 className="h-3.5 w-3.5" />Open source, MIT</a>
          </div>
        </div>
      </div>

      {/* every league with a fan zone */}
      <section className="space-y-3">
        <Head id="leagues" title="Pick a league" sub="Each league's page has every club, the races with every club's chances, the leaders and the league's own board." />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(leagues ?? []).map((x) => {
            const t = leagueTheme(x.key), d = dirs[x.key], n = lidx[x.key];
            const logos = (d?.clubs ?? []).slice(0, 6);
            return (
              <Link key={x.key} to={x.key === 'nhl' ? '/fans#nhl' : zonePath(x.key)} onClick={(e) => { if (x.key === 'nhl') { e.preventDefault(); document.getElementById('fz-clubs')?.scrollIntoView({ behavior: 'smooth' }); } }}
                className="group relative flex min-h-[132px] flex-col overflow-hidden rounded-2xl border p-3 transition hover:-translate-y-0.5"
                style={{ borderColor: `rgb(${t.rgb} / .35)`, background: `radial-gradient(120% 100% at 100% 0%, rgb(${t.rgb} / .28), transparent 60%), linear-gradient(160deg, ${t.secondary}, #070b16 85%)` }}>
                <div className="flex items-center gap-2">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/95"><ClubMark league={x.key} code={x.key.toUpperCase()} size={30} light /></span>
                  <span className="min-w-0"><b className="block font-display text-lg font-extrabold leading-tight text-white">{x.name}</b><span className="block text-[11px] text-slate-400">{SPORT_WORD[x.sport] ?? x.sport}</span></span>
                </div>
                <div className="mt-2 flex -space-x-1.5">{logos.map((c) => <span key={c.code} className="grid h-6 w-6 place-items-center rounded-full bg-white/95 ring-2 ring-[#0b1222]"><ClubMark league={x.key} code={c.code} logo={c.logo} size={16} light /></span>)}</div>
                <div className="mt-auto flex items-center gap-1 pt-2 text-[11px]" style={{ color: t.primary }}>
                  <span className="font-semibold">{n?.clubs ?? d?.clubs.length ?? ''} clubs</span>
                  {n?.people ? <span className="ml-auto flex items-center gap-0.5 font-semibold"><Users className="h-3 w-3" />{n.people}</span> : <span className="ml-auto text-mute group-hover:text-slate-300">Open</span>}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <Head id="clubs" title="The NHL's 32 clubs" sub="Every club's zone: the verdict, the playoff chances, the numbers, the crease, the front office, the history and the fans." />
        {DIVISIONS.map(([div, clubs]) => (
          <div key={div}>
            <div className="label mb-1.5 px-1">{div}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[...clubs].sort((a, b) => (row.get(a)?.divRank ?? 99) - (row.get(b)?.divRank ?? 99)).map((c) => {
                const t = clubTheme(c), r = row.get(c), x = idx[c];
                return (
                  <Link key={c} to={`/fans/${c}`} className="group relative flex min-h-[112px] flex-col overflow-hidden rounded-2xl border p-2.5 transition hover:-translate-y-0.5"
                    style={{ borderColor: `rgb(${t.rgb} / .3)`, background: `radial-gradient(120% 100% at 100% 0%, rgb(${t.rgb} / .22), transparent 60%), linear-gradient(160deg, ${t.secondary}, #070b16 85%)` }}>
                    <div className="flex items-center gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/95"><NhlLogo abbr={c} size={26} light /></span>
                      <span className="min-w-0 flex-1 text-[13px] font-bold leading-tight text-white">{NHL_TEAMS[c]}</span>
                    </div>
                    {r && <div className="num mt-2 text-[12px] text-slate-300">{r.w}-{r.l}-{r.otl} · <b className="text-white">{r.pts} pts</b> · {rankWord(r.divRank)}</div>}
                    <div className="mt-auto flex items-center gap-1 pt-1.5 text-[11px]" style={{ color: t.primary }}>
                      {x?.top ? <span className="line-clamp-1 min-w-0 text-slate-300">💡 {x.top.title}</span> : <span className="text-mute group-hover:text-slate-300">Open the zone</span>}
                      {x?.people ? <span className="ml-auto flex shrink-0 items-center gap-0.5 font-semibold"><Users className="h-3 w-3" />{x.people}</span> : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* the league as a whole: its own calls, board and knowledge base */}
      <FanVoiceProvider club="NHL">
        <section className="space-y-3">
          <Head id="league" title="The NHL as a whole" sub="Calls on the Cup and the awards, ideas for the game itself, and the league's knowledge base." right={<Link to="/fans/NHL/pulse" className="shrink-0 text-sm font-semibold text-sky-300">League pulse</Link>} />
          <FanMeBar />
          <FanCalls league={league} />
          <div className="px-1 pt-1"><div className="flex items-center gap-1.5 font-display text-lg font-extrabold text-white"><Megaphone className="h-4 w-4 text-sky-300" />The league board</div><p className="text-[13px] text-mute">Rules, the schedule, the officiating, the game itself: what would you change?</p></div>
          <FanBoard post={post} />
          <div className="px-1 pt-1"><div className="flex items-center gap-1.5 font-display text-lg font-extrabold text-white"><BookOpen className="h-4 w-4 text-sky-300" />The league&apos;s knowledge base</div><p className="text-[13px] text-mute">Records, stories and trivia from across the NHL, added by fans.</p></div>
          <FanKnowledge />
        </section>
      </FanVoiceProvider>
      <p className="px-1 text-[11px] leading-snug text-mute">Super Pools fan zones are made by fans, from public numbers: the NHL&apos;s own, and ESPN&apos;s for the NFL, the NBA and the Premier League. Not affiliated with any league or club; team names and logos belong to them.</p>
    </div>
  );
}
