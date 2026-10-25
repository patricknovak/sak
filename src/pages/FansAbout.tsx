// How the fan zones work (25 October 2026, Patrick: "an open source type project"): #/fans/about, open to everyone.
// What is in a club's zone, where every number comes from, how the reads are made, what the fans add and how it is
// kept clean, and what is open: the code, the methods and the fans' own data.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Code2, Database, Flag, Gauge, HeartHandshake, Lock, Megaphone, Sigma } from 'lucide-react';
import { clubVars } from '../data/clubColors';

const CODE = 'https://github.com/patricknovak/sak';
const FILE = (p: string) => `${CODE}/blob/main/${p}`;

const SECTIONS: { icon: typeof BookOpen; title: string; body: React.ReactNode }[] = [
  {
    icon: Gauge, title: 'What is in every club’s zone',
    body: (
      <ul className="space-y-1.5">
        <li><b>The verdict.</b> A grade and a read of the season from 46 measures, each ranked among the 32 clubs and against last season, with the strengths, the weaknesses and a luck check.</li>
        <li><b>The outlook.</b> Playoff and Cup chances from thousands of simulated seasons, the points pace, the race in the division and the schedule still to come.</li>
        <li><b>The players and the crease.</b> Who is rising and who is fading, 5-on-5 scoring rates, usage, the milestones in reach, and the goalies read against the danger of every shot they faced.</li>
        <li><b>The front office.</b> The bigger questions with a verdict each, the moves the numbers point to (with the league’s players who fit, sellers first) and the calls for the coaches.</li>
        <li><b>The history.</b> Every season the franchise has played, its leaders, records, trophies and draft, from the NHL’s own record books.</li>
        <li><b>The fans.</b> The fans’ calls for the season, the board of ideas and questions, the knowledge base and the fan pulse.</li>
      </ul>
    ),
  },
  {
    icon: Database, title: 'Where the numbers come from',
    body: (
      <p>Only public sources, read fresh: the NHL’s statistics and game feeds (api-web.nhle.com and api.nhle.com), its player and puck tracking (NHL Edge: skating speed, shot locations, zone time), its record books (records.nhl.com), and the news from ESPN, NHL.com and Sportsnet. Nothing is scraped from behind a login and nothing is bought. Contracts and the salary cap aren’t in the free feeds, so cap fit is never judged.</p>
    ),
  },
  {
    icon: Sigma, title: 'How the reads are made',
    body: (
      <ul className="space-y-1.5">
        <li><b>The chances</b> play out the rest of the season a few thousand times, each club’s strength pulled toward the league average in proportion to how few games it has played, so ten games never decide a season.</li>
        <li><b>The luck check</b> sets shooting and save percentages against what the shots were worth and what the club has done before.</li>
        <li><b>The goalies</b> are measured in goals saved against what an average goalie would have stopped from the same spots, by the danger of each shot, and for the blame on each goal against.</li>
        <li><b>The moves</b> come from the club’s weakest measures, with every candidate’s numbers blended over this season and last, and a club is called a seller when its own playoff chances are low.</li>
        <li>Every formula is in the open: <a className="text-sky-300 underline" href={FILE('src/lib/fanZone.ts')} target="_blank" rel="noopener noreferrer">the measures</a>, <a className="text-sky-300 underline" href={FILE('src/lib/fanDeep.ts')} target="_blank" rel="noopener noreferrer">the chances and the history</a>, <a className="text-sky-300 underline" href={FILE('src/lib/fanOffice.ts')} target="_blank" rel="noopener noreferrer">the crease and the front office</a>, and <a className="text-sky-300 underline" href={FILE('supabase/functions/nhl-hub/index.ts')} target="_blank" rel="noopener noreferrer">the feeds they read</a>.</li>
      </ul>
    ),
  },
  {
    icon: Megaphone, title: 'What the fans add',
    body: (
      <ul className="space-y-1.5">
        <li><b>Calls.</b> Who should start in goal, the MVP so far, the one player to move, the biggest need, the window, how far this spring, and grades for the general manager and the coach; a verdict of your own on each of the analysis’s bigger questions; for the league, the Cup and the awards. One call each, changed whenever you like.</li>
        <li><b>The board.</b> Ideas, questions for the club, insights and fixes, voted up or down, so the best rise.</li>
        <li><b>The knowledge base.</b> Facts, records and stories about each club and the league, with a source where there is one. The editors mark the ones they have checked.</li>
        <li><b>Fixes.</b> When the analysis gets something wrong, say so on the board: fixes are read, made in the open and marked fixed.</li>
        <li><b>The fan pulse.</b> All of it on one page for each club, free for anyone to read, share, print or download: the club’s own front office included.</li>
      </ul>
    ),
  },
  {
    icon: Code2, title: 'Open by design',
    body: (
      <>
        <p>The code that builds every fan zone is public on <a className="text-sky-300 underline" href={CODE} target="_blank" rel="noopener noreferrer">GitHub</a>, and the fans’ own data is open: each club’s pulse and every post as a spreadsheet or as data from its pulse page, or straight from <code className="rounded bg-white/[.08] px-1 text-[12px]">app.superpoolsai.com/api/fans/EDM</code> (any club’s three letters, or NHL), no key needed. Names show as a first name and an initial; no account is ever in it.</p>
        <p className="mt-2">To help, post a fix or a fact on the board, or open an issue or a pull request on GitHub.</p>
      </>
    ),
  },
  {
    icon: Flag, title: 'Keeping it good',
    body: (
      <p>Be specific and fair. No personal attacks on players, coaches, staff or other fans, nothing hateful, no spam and nothing private about anyone. A post can be reported by any fan: the first report reaches the editors and three take it down (more for a post the fans voted well up). The editors can take down anything that breaks these, and every fan can take down their own posts.</p>
    ),
  },
  {
    icon: Lock, title: 'Your privacy',
    body: (
      <p>Joining needs only a name, and others see only your first name and initial. Your calls and votes are never shown one by one, only in the totals. Without an email your account lives on the phone you joined on; add one any time to keep your name everywhere. The full note is <Link className="text-sky-300 underline" to="/privacy">here</Link>.</p>
    ),
  },
  {
    icon: HeartHandshake, title: 'Made by fans',
    body: <p>Super Pools fan zones are made by fans, from the NHL’s public numbers. They are not affiliated with or endorsed by the NHL or any of its clubs; team names and logos belong to them.</p>,
  },
];

export default function FansAbout() {
  useEffect(() => { document.title = 'How the fan zones work · Super Pools'; }, []);
  return (
    <div className="space-y-4" style={clubVars('NHL')}>
      <Link to="/fans" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-300"><ArrowLeft className="h-4 w-4" />Every club</Link>
      <div className="px-1">
        <div className="text-[11px] font-bold uppercase tracking-[.22em] text-sky-300">Fan zones</div>
        <h1 className="font-display text-[clamp(28px,8vw,40px)] font-extrabold italic leading-[.95] text-white">How it works</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-snug text-slate-300">A front office’s read of every NHL club, built in the open from the league’s own numbers, with the fans’ own calls, ideas and knowledge beside it.</p>
      </div>
      {SECTIONS.map(({ icon: Icon, title, body }) => (
        <section key={title} className="card p-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-extrabold text-white"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-sky-400/10 ring-1 ring-sky-300/25"><Icon className="h-4 w-4 text-sky-300" /></span>{title}</h2>
          <div className="mt-2 text-[14px] leading-relaxed text-slate-300">{body}</div>
        </section>
      ))}
      <Link to="/fans" className="btn-club w-full py-3">Find your club</Link>
    </div>
  );
}
