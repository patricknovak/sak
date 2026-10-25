// A club's fan zone in the other leagues (25 October 2026, Patrick: "I would like to include Premier League, NFL and NBA
// with the possibility of adding other leagues"): #/fans/<league>/<club>, open to everyone, the NHL's zone (FanZone.tsx)
// in every other sport. The club's season read from ESPN's public numbers by src/lib/fanSport.ts: the verdict and every
// measure ranked in the league, the chances (the playoffs and the title, or the title, Europe and the drop), the luck,
// the form and the games ahead, the players, the front office's bigger questions with the fans' own verdict on each, and
// the fans: their calls, the board, the knowledge base and the pulse. In the club's own colours. Since later that day the
// zone is pages (the overview, the analysis, the outlook with the seeds and the first round, the history from ESPN's tables
// and the settled titles, the pulse), each with its own link and picture, and the share sheet draws the cards (zoneShare.ts).
import { useContext, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Activity, ArrowRight, BookOpen, CalendarClock, ExternalLink, Flame, HeartPulse, Megaphone, Snowflake, Sparkles, TrendingDown, TrendingUp, Trophy, Users } from 'lucide-react';
import { ago } from '../lib/format';
import {
  MEASURES, SPORTS, assess, chance, rankWord, type Chances, type MeasureGroup, type Ranked, type SportClub, type SportLeague, type SportRead,
} from '../lib/fanSport';
import { PublicFrame, QUESTION_CALLS, useFanDir, zoneLink, zonePath, type ZonePage } from '../lib/fanVoice';
import type { SportHistory } from '../lib/fanSportHistory';
import { SportHistorySection } from '../components/fan/SportHistory';
import { ZoneTabs, type ZoneTab } from '../components/fan/ZoneTabs';
import { sportOptions } from '../components/fan/zoneShare';
import { sportTheme, sportVars } from '../data/clubColors';
import { LoadError, Spinner } from '../components/ui';
import { Chips, ClubMark, Head, ShowMore } from '../components/fan/kit';
import { FanCalls, FanMeBar, FanVoiceProvider, VerdictCall, useVoice } from '../components/fan/FanVoice';
import { FanBoard, FanKnowledge } from '../components/fan/FanBoard';
import { ShareButton, ShareIcon } from '../components/fan/FanShare';
import { ChanceTiles, RaceTable, dayOf, kickoff, recordOfRow, useLeagueRead, useSportClub, useSportHistory, useSportLeague } from '../components/fan/SportBits';

const CLUB_KEY = 'sp-fan-club';

const TABS: ZoneTab[] = [['', 'Overview'], ['analysis', 'Analysis'], ['outlook', 'Outlook'], ['history', 'History']];
const PAGE_TITLE: Record<string, string> = { '': 'fan zone', analysis: 'the analysis', outlook: 'the outlook', history: 'the history' };

export default function SportFanZone() {
  const { league = '', club: param = '', tab = '' } = useParams();
  const club = param.toUpperCase();
  const nav = useNavigate();
  const framed = useContext(PublicFrame);
  const { search } = useLocation();
  const post = Number(new URLSearchParams(search).get('post')) || null;
  const { dir, failed: dirFailed } = useFanDir(league);
  const L = useSportLeague(league);
  const C = useSportClub(league, club);
  const H = useSportHistory(league);
  const l = L.data, c = C.data;
  const { tb, out } = useLeagueRead(l);
  const row = l?.clubs.find((x) => x.code === club) ?? null;
  const dc = dir?.byCode[club];
  const a = useMemo(() => (l && tb ? assess(l, club, tb, out, c) : null), [l, tb, out, c, club]);
  useEffect(() => {
    if (!dc) return;
    document.title = `${dc.name}: ${PAGE_TITLE[tab] ?? 'fan zone'} · Super Pools`;
    try { localStorage.setItem(CLUB_KEY, `${league}/${club}`); } catch { /* nothing to remember with */ }
  }, [dc, league, club, tab]);
  useEffect(() => { if (post && c) setTimeout(() => document.getElementById('fz-fans')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600); }, [post, !!c]);
  useEffect(() => { window.scrollTo(0, 0); }, [league, club, tab]);

  // the NHL has its own zones; a club that isn't one has the league's page; a page that isn't one has the overview
  if (league === 'nhl') return <Navigate to={`/fans/${club}${tab ? `/${tab}` : ''}`} replace />;
  if (dirFailed) return <Navigate to="/fans" replace />;
  if (!dir) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!dc) return <Navigate to={zonePath(league)} replace />;
  if (tab && !TABS.some(([k]) => k === tab)) return <Navigate to={zonePath(league, club)} replace />;
  const color = c?.color ?? dc.color, alt = c?.alt ?? dc.alt;
  const theme = sportTheme(color, alt);
  const name = c?.name ?? dc.name;
  const sport = dir.sport as SportLeague['sport'];
  const failed = L.failed || C.failed;
  const record = row ? (sport === 'soccer' ? `${row.pts ?? 0} pts · ${rankWord(row.seed ?? 0)} in the table` : recordOfRow(sport, row)) : '';
  const ch = out?.chances[club] ?? null;
  const sections: readonly (readonly [string, string])[] = tab === 'analysis' ? [['verdict', 'Verdict'], ['numbers', 'Numbers'], ['players', 'Players'], ['office', 'Front office'], ['kb', 'Knowledge']]
    : tab === 'outlook' ? [['outlook', 'Chances'], ['games', 'Games']] : tab === 'history' ? [['history', 'History'], ['kb', 'Knowledge']] : [];

  return (
    <div className="space-y-5" style={sportVars(color, alt)}>
      <FanVoiceProvider club={club} league={league} dir={dir}>
        {/* the hero: the club, its season so far, its chances and the next game */}
        <div className="relative overflow-hidden rounded-[28px] border p-4 sm:p-6" style={{ borderColor: `rgb(${theme.rgb} / .35)`, background: `radial-gradient(120% 90% at 100% 0%, rgb(${theme.rgb} / .35), transparent 55%), linear-gradient(160deg, ${theme.secondary}, #070b16 75%)` }}>
          <div className="pointer-events-none absolute -right-8 -top-8 opacity-[.12]"><ClubMark league={league} code={club} logo={dc.logo} size={220} /></div>
          <div className="relative flex items-start gap-3">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/95 shadow-lg sm:h-20 sm:w-20"><ClubMark league={league} code={club} logo={dc.logo} size={50} light /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[.2em]" style={{ color: theme.primary }}>{dir.name} · {PAGE_TITLE[tab] ?? 'fan zone'}</div>
              <h1 className="font-display text-[clamp(26px,8vw,40px)] font-extrabold italic leading-[.95] text-white">{name}</h1>
              {row && <div className="mt-1 text-sm text-slate-300">{sport === 'soccer' ? `${row.pts ?? 0} pts · ${rankWord(row.seed ?? 0)} in the table` : `${recordOfRow(sport, row)}${c?.standing ? ` · ${c.standing}` : row.div ? ` · ${row.div}` : ''}`}</div>}
            </div>
            {!framed && (
              <select aria-label="Pick a club" value={club} onChange={(e) => nav(zonePath(league, e.target.value, (tab || undefined) as ZonePage | undefined))}
                className="relative h-9 max-w-[7.5rem] shrink-0 rounded-full border border-white/15 bg-black/30 px-2 text-xs font-semibold text-white">
                {dir.clubs.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
              </select>
            )}
          </div>
          {row && a && (
            <div className="relative mt-4 grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
              {[
                ['Grade', a.grade, a.early ? 'early lean' : 'so far'],
                sport === 'soccer' ? ['Top four', ch ? chance(ch.top4) : '…', ch ? `~${ch.projected.mid} pts · title ${chance(ch.title)}` : 'simulating'] : ['Playoffs', ch ? chance(ch.playoffs) : '…', ch ? `~${ch.projected.mid} wins · title ${chance(ch.title)}` : 'simulating'],
                sport === 'soccer' ? ['Table', rankWord(row.seed ?? 0), `of ${l!.clubs.length} · ${row.pf - row.pa > 0 ? '+' : ''}${row.pf - row.pa} GD`] : ['Record', recordOfRow(sport, row), `${row.pf - row.pa > 0 ? '+' : ''}${row.pf - row.pa} points`],
                ['Form', a.form ? formLine(a.form, sport) : '–', a.form ? `last ${a.form.games.length}` : ''],
              ].map(([k, v, sub], i) => (
                <div key={k} className="min-w-0 rounded-2xl bg-black/30 px-2 py-2 ring-1 ring-white/10">
                  <div className="label truncate">{k}</div>
                  <div className={`font-display font-extrabold leading-tight text-white ${i < 2 ? 'text-[clamp(22px,7vw,30px)]' : 'text-[clamp(16px,5vw,22px)]'}`} style={i < 2 ? { color: theme.primary } : undefined}>{v}</div>
                  <div className="truncate text-[10px] text-mute">{sub}</div>
                </div>
              ))}
            </div>
          )}
          {tab === '' && c?.next && <NextGame c={c} l={l} />}
          <HeroActions dir={dir} club={club} name={name} a={a} ch={ch} hist={H.data} record={record} />
        </div>

        <ZoneTabs base={zonePath(league, club)} tabs={TABS} current={tab} pulse={zonePath(league, club, 'pulse')} />
        {l && c && sections.length > 0 && (
          <div className="scroll-x flex gap-1.5">
            {sections.map(([id, label]) => (
              <button key={id} type="button" onClick={() => document.getElementById(`fz-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="shrink-0 rounded-full border border-white/10 bg-white/[.05] px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/[.1]">{label}</button>
            ))}
          </div>
        )}

        {tab === 'history' ? (
          <>
            <SportHistorySection h={H.data} league={league} club={club} name={name} dir={dir} share={<ShareIcon url={zoneLink(league, club, 'history')} title={`${name}: the history`} text={`The ${name}' history: every season, the titles, the eras and the facts.`} />} />
            {H.failed && !H.data && <LoadError what={`the ${name} history`} onRetry={H.retry} />}
            <section className="space-y-3">
              <Head id="kb" title="The fans' knowledge base" sub="Facts, records and stories fans add about the club, marked when the editors have checked them. Open data, free to use." />
              <FanKnowledge />
            </section>
          </>
        ) : !l || !c || !a ? (failed ? <LoadError what={`the ${name} fan zone`} onRetry={() => { L.retry(); C.retry(); }} /> : <div className="flex justify-center py-16"><Spinner /></div>) : tab === 'analysis' ? (
          <>
            <Verdict a={a} share={{ url: zoneLink(league, club, 'analysis'), title: `${name}: the analysis`, text: `${name}: grade ${a.grade}. ${a.summary}` }} />
            <Numbers a={a} sport={sport} of={l.clubs.length} />
            <Players l={l} c={c} a={a} />
            <Office a={a} />
            <section className="space-y-3">
              <Head id="kb" title="The fans' knowledge base" sub="Facts, records and stories fans add about the club, marked when the editors have checked them. Open data, free to use." />
              <FanKnowledge />
            </section>
            <Footnote l={l} c={c} out={out} dir={dir} />
          </>
        ) : tab === 'outlook' ? (
          <>
            <Outlook l={l} club={club} a={a} out={out} tb={tb} dir={dir} share={{ url: zoneLink(league, club, 'outlook'), title: `${name}: the outlook`, text: ch ? (sport === 'soccer' ? `${name}: ${chance(ch.title)} for the title, ${chance(ch.top4)} top four.` : `${name}: ${chance(ch.playoffs)} to make the playoffs, ${chance(ch.title)} to win it all.`) : `${name}: the season played out a few thousand times.` }} />
            <Games l={l} a={a} />
            <Footnote l={l} c={c} out={out} dir={dir} />
          </>
        ) : (
          <>
            <Verdict a={a} compact to={zonePath(league, club, 'analysis')} />
            <section className="space-y-3">
              <Head id="chances" title="The chances" sub={`The rest of the season played out ${out ? out.sims.toLocaleString() : 'a few thousand'} times${sport === 'soccer' ? ', the table drawn from where they finish' : ', the spring too'}.`} right={<Link to={zonePath(league, club, 'outlook')} className="flex shrink-0 items-center gap-1 text-sm font-semibold" style={{ color: 'var(--club)' }}>The outlook<ArrowRight className="h-3.5 w-3.5" /></Link>} />
              <ChanceTiles sport={l.sport} c={ch} />
              {ch && <OutlookLine l={l} ch={ch} dir={dir} />}
            </section>
            <FansSection l={l} c={c} name={name} post={post} />
            <News c={c} />
            <Deeper league={league} club={club} />
            <Footnote l={l} c={c} out={out} dir={dir} />
          </>
        )}
      </FanVoiceProvider>
    </div>
  );
}

function Footnote({ l, c, out, dir }: { l: SportLeague; c: SportClub; out: ReturnType<typeof useLeagueRead>['out']; dir: NonNullable<ReturnType<typeof useFanDir>['dir']> }) {
  return <p className="px-1 text-[11px] text-mute">Numbers from ESPN&apos;s public feeds and the games as they finish{l.stale || c.at && Date.now() - Date.parse(c.at) > 6 * 3600_000 ? ' (the last copy: the feed is slow to answer)' : ''}, read {ago(c.at, Date.now())} ago. Ranks are among all {l.clubs.length} clubs; the chances play the rest of the season out {out ? out.sims.toLocaleString() : 'a few thousand'} times, each club&apos;s strength its own margin blended with the market&apos;s view before each game. Early in a season the samples are small and the numbers move. <Link to="/fans/about" className="underline">How the fan zones work</Link>, in the open. Not affiliated with the {dir.name} or its clubs.</p>;
}

// a line under the overview's tiles: the first-round opponent or the likeliest place, and what it takes
function OutlookLine({ l, ch, dir }: { l: SportLeague; ch: Chances; dir: NonNullable<ReturnType<typeof useFanDir>['dir']> }) {
  const soccer = l.sport === 'soccer';
  const opp = Object.entries(ch.opponents)[0];
  const place = soccer && ch.positions.length ? ch.positions.indexOf(Math.max(...ch.positions)) + 1 : null;
  return (
    <p className="px-1 text-[13px] leading-snug text-slate-300">
      {soccer && place ? <>Most likely to finish <b className="text-white">{rankWord(place)}</b> ({chance(ch.positions[place - 1])}). </> : null}
      {opp ? (opp[0] === 'bye' ? <>The most likely start to the playoffs: <b className="text-white">a bye</b> ({chance(opp[1])} of seasons). </> : <>The most likely first-round opponent: <b className="text-white">{dir.byCode[opp[0]]?.name ?? opp[0]}</b> ({chance(opp[1] / Math.max(0.01, ch.playoffs))} of the springs they make). </>) : null}
      Projected <b className="text-white">{ch.projected.mid}</b> {soccer ? 'points' : 'wins'}, {ch.projected.low} to {ch.projected.high} in eight seasons of ten.
    </p>
  );
}

// the way deeper: the pages this one leads to
function Deeper({ league, club }: { league: string; club: string }) {
  const items: [ZonePage, string, string, typeof Trophy][] = [
    ['analysis', 'The analysis', 'Every measure ranked, the players, the front office’s bigger questions, the needs and the moves.', Sparkles],
    ['outlook', 'The outlook', 'The chances, the seeds, the first round, the race, the games ahead with their odds.', Activity],
    ['history', 'The history', 'Every season since the tables began, the titles, the eras and the facts.', Trophy],
  ];
  return (
    <section className="grid gap-2 sm:grid-cols-3">
      {items.map(([page, title, sub, Icon]) => (
        <Link key={page} to={zonePath(league, club, page)} className="card flex items-center gap-3 p-4 hover:bg-white/[.03]">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: 'rgb(var(--club-rgb) / .2)', boxShadow: 'inset 0 0 0 1px rgb(var(--club-rgb) / .45)' }}><Icon className="h-5 w-5" style={{ color: 'var(--club)' }} /></span>
          <span className="min-w-0 flex-1"><b className="block text-white">{title}</b><span className="block text-[12px] leading-snug text-mute">{sub}</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-mute" />
        </Link>
      ))}
    </section>
  );
}

const formLine = (f: NonNullable<SportRead['form']>, sport: string) => (sport === 'soccer' ? `${f.w}-${f.d}-${f.l}` : `${f.w}-${f.l}${f.d ? `-${f.d}` : ''}`);

function NextGame({ c, l }: { c: SportClub; l: SportLeague | null }) {
  const n = c.next!;
  const opp = l?.clubs.find((x) => x.code === n.opp);
  return (
    <div className="relative mt-3 flex items-center gap-2.5 rounded-2xl bg-black/30 px-3 py-2 ring-1 ring-white/10 text-xs">
      <CalendarClock className="h-4 w-4 shrink-0 text-mute" />
      {n.opp && <ClubMark league={c.league} code={n.opp} logo={opp?.logo} size={22} />}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-mute">Next{n.week ? ` · ${n.week}` : ''}</div>
        <div className="font-semibold leading-snug text-white">{n.home ? 'vs' : '@'} {n.oppName ?? n.opp}{n.at ? <span className="font-normal text-slate-300"> · {kickoff(n.at)}</span> : null}{n.tv ? <span className="font-normal text-mute"> · {n.tv}</span> : null}</div>
      </div>
    </div>
  );
}

function HeroActions({ dir, club, name, a, ch, hist, record }: { dir: NonNullable<ReturnType<typeof useFanDir>['dir']>; club: string; name: string; a: SportRead | null; ch: Chances | null; hist: SportHistory | null; record: string }) {
  const v = useVoice();
  const people = v?.pulse?.people ?? 0;
  const options = useMemo(() => sportOptions(dir, club, a, ch, hist, record, v?.pulse ?? null, v?.me?.given ?? v?.me?.name ?? null), [dir, club, a, ch, hist, record, v?.pulse, v?.me]);
  return (
    <div className="relative mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={() => document.getElementById('fz-fans')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="btn-club btn-sm px-3!"><Megaphone className="h-3.5 w-3.5" />Have your say</button>
      <Link to={zonePath(dir.league, club, 'pulse')} className="btn-ghost btn-sm px-3!"><Activity className="h-3.5 w-3.5" />Fan pulse{people ? <span className="flex items-center gap-0.5 text-mute"><Users className="h-3 w-3" />{people}</span> : null}</Link>
      <ShareButton url={zoneLink(dir.league, club)} title={`${name} fan zone`} text={`The ${name}, read like a front office: the chances, the numbers, the players, the moves and what the fans think.`} className="btn-ghost btn-sm px-3!" options={options} heading={`Share the ${name}`} />
    </div>
  );
}

// ── the verdict: a grade, the season in a paragraph, the strengths and weaknesses, the luck
function Verdict({ a, compact, to, share }: { a: SportRead; compact?: boolean; to?: string; share?: { url: string; title: string; text: string } }) {
  const [more, setMore] = useState(false);
  const cut = compact ? 3 : 5;
  const line = (r: Ranked, good: boolean) => (
    <li key={r.key} className="flex items-center gap-2 py-1.5 text-sm">
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black ${good ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300'}`}>{good ? '+' : '−'}</span>
      <span className="min-w-0 flex-1 text-slate-200">{r.label}</span>
      <span className="num font-semibold text-white">{r.fmt(r.value)}</span>
      <span className={`num w-12 shrink-0 text-right text-xs font-bold ${good ? 'text-emerald-300' : 'text-red-300'}`}>{rankWord(r.rank)}</span>
    </li>
  );
  return (
    <section className="space-y-3">
      <Head id="verdict" title="The verdict" sub="A read of the season from every club's numbers: what's real, what's luck, and what to do about it." share={share} right={compact && to ? <Link to={to} className="flex shrink-0 items-center gap-1 text-sm font-semibold" style={{ color: 'var(--club)' }}>The analysis<ArrowRight className="h-3.5 w-3.5" /></Link> : undefined} />
      <div className="card p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl font-display text-2xl font-extrabold text-white" style={{ background: 'rgb(var(--club-rgb) / .22)', boxShadow: 'inset 0 0 0 1px rgb(var(--club-rgb) / .5)' }}>{a.grade}</span>
          <p className="text-[15px] leading-snug text-slate-100">{a.summary}</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="label text-emerald-300">Strengths</div>
            {a.strengths.length ? <ul className="divide-y divide-white/[.05]">{(more ? a.strengths : a.strengths.slice(0, cut)).map((r) => line(r, true))}</ul> : <p className="py-1.5 text-sm text-mute">Nothing in the league&apos;s top third yet.</p>}
          </div>
          <div>
            <div className="label text-red-300">Weaknesses</div>
            {a.weaknesses.length ? <ul className="divide-y divide-white/[.05]">{(more ? a.weaknesses : a.weaknesses.slice(0, cut)).map((r) => line(r, false))}</ul> : <p className="py-1.5 text-sm text-mute">Nothing in the league&apos;s bottom third.</p>}
          </div>
        </div>
        {(a.strengths.length > cut || a.weaknesses.length > cut) && <button type="button" onClick={() => setMore(!more)} className="mt-1 text-sm font-semibold text-sky-300">{more ? `The top ${compact ? 'three' : 'five'} of each` : `All ${a.strengths.length} strengths and ${a.weaknesses.length} weaknesses`}</button>}
        {a.luck && (
          <div className={`mt-3 flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-sm leading-snug ring-1 ${a.luck.tone === 'hot' ? 'bg-amber-500/10 text-amber-100 ring-amber-400/25' : a.luck.tone === 'cold' ? 'bg-sky-500/10 text-sky-100 ring-sky-400/25' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}>
            {a.luck.tone === 'hot' ? <Flame className="mt-0.5 h-4 w-4 shrink-0" /> : a.luck.tone === 'cold' ? <Snowflake className="mt-0.5 h-4 w-4 shrink-0" /> : <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />}
            <span><b>The luck check.</b> {a.luck.read}</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ── the outlook: the chances, the range of finishes, and the race
function Outlook({ l, club, a, out, tb, dir, share }: { l: SportLeague; club: string; a: SportRead; out: ReturnType<typeof useLeagueRead>['out']; tb: ReturnType<typeof useLeagueRead>['tb']; dir: NonNullable<ReturnType<typeof useFanDir>['dir']>; share?: { url: string; title: string; text: string } }) {
  const row = l.clubs.find((x) => x.code === club)!;
  const ch = out?.chances[club] ?? null;
  const soccer = l.sport === 'soccer';
  const unit = soccer ? 'points' : 'wins';
  const line = out?.lines[row.conf ?? ''] ?? null;
  return (
    <section className="space-y-3">
      <Head id="outlook" title="The outlook" sub={`The rest of the season played out ${out ? out.sims.toLocaleString() : 'a few thousand'} times, each game from the two clubs' strengths (the market's chance where it has set one), and the ${soccer ? 'table' : 'playoffs'} drawn from where they finish.`} share={share} />
      <ChanceTiles sport={l.sport} c={ch} />
      {ch && (
        <div className="card p-4">
          <div className="flex items-baseline justify-between gap-2"><b className="text-white">Where they finish</b><span className="text-[12px] text-mute">{out!.left ? `${a.ahead?.left ?? 0} ${soccer ? 'matches' : 'games'} to play` : 'the season is done'}</span></div>
          <div className="mt-2 flex items-end gap-3">
            <div><div className="num font-display text-3xl font-extrabold" style={{ color: 'var(--club)' }}>{ch.projected.mid}</div><div className="text-[11px] text-mute">{unit}, most likely</div></div>
            <div className="min-w-0 flex-1 pb-1.5">
              <div className="relative h-2 rounded-full bg-white/[.06]">
                {(() => {
                  const max = soccer ? 3 * (row.gp + (a.ahead?.left ?? 0)) : row.gp + (a.ahead?.left ?? 0);
                  const x = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100))}%`;
                  return <>
                    <div className="absolute h-2 rounded-full" style={{ left: x(ch.projected.low), width: `calc(${x(ch.projected.high)} - ${x(ch.projected.low)})`, background: 'rgb(var(--club-rgb) / .45)' }} />
                    <div className="absolute -top-1 h-4 w-1 rounded bg-white" style={{ left: x(ch.projected.mid) }} />
                  </>;
                })()}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-mute"><span>{ch.projected.low} at worst</span><span>{ch.projected.high} at best</span></div>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-mute">Eight seasons in ten end between the two marks.</p>
          {soccer && ch.positions.length > 0 && <Places positions={ch.positions} />}
          {line && (
            <p className="mt-2 rounded-xl bg-white/[.04] px-3 py-2 text-[13px] leading-snug text-slate-200 ring-1 ring-white/[.06]"><b style={{ color: 'var(--club)' }}>What it takes. </b>
              {soccer ? <>Fourth place takes about <b className="text-white">{line.top4}</b> points in the middle season; safety from the drop about <b className="text-white">{line.safe}</b>.</>
                : l.sport === 'football' ? <>The last seed in the {row.conf ?? 'conference'} takes about <b className="text-white">{line.playoffs}</b> wins in the middle season{ch.projected.mid >= (line.playoffs ?? 0) ? ': they project past it.' : `: they project ${((line.playoffs ?? 0) - ch.projected.mid).toFixed(1)} short.`}</>
                  : <>Skipping the play-in takes about <b className="text-white">{line.top6}</b> wins in the {row.conf ?? 'conference'}; the last play-in place about <b className="text-white">{line.playoffs}</b>.</>}
            </p>
          )}
        </div>
      )}
      {ch && !soccer && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="card p-4">
            <b className="text-white">Where they land</b>
            <p className="text-[11px] text-mute">The share of seasons ending at each seed{l.sport === 'basketball' ? ' (seven to ten play in)' : ''}.</p>
            <div className="mt-2 space-y-1.5">
              {ch.seeds.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-20 shrink-0 text-slate-200">{rankWord(i + 1)} seed</span>
                  <span className="min-w-0 flex-1"><div className="h-1.5 rounded-full bg-white/[.06]"><div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, Math.min(100, p * 100))}%`, background: l.sport === 'basketball' && i >= 6 ? 'rgb(148 163 184 / .6)' : 'rgb(var(--club-rgb))' }} /></div></span>
                  <span className="num w-11 shrink-0 text-right font-semibold text-white">{chance(p)}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 text-sm"><span className="w-20 shrink-0 text-mute">Out</span><span className="min-w-0 flex-1"><div className="h-1.5 rounded-full bg-white/[.06]"><div className="h-1.5 rounded-full bg-red-400/70" style={{ width: `${Math.max(2, (1 - ch.seeds.reduce((t, v) => t + v, 0)) * 100)}%` }} /></div></span><span className="num w-11 shrink-0 text-right font-semibold text-white">{chance(1 - ch.seeds.reduce((t, v) => t + v, 0))}</span></div>
            </div>
          </div>
          <div className="card p-4">
            <b className="text-white">The first round</b>
            <p className="text-[11px] text-mute">The most likely opponents, as a share of every season.</p>
            {Object.keys(ch.opponents).length ? (
              <div className="mt-2 space-y-1.5">
                {Object.entries(ch.opponents).map(([code, p]) => (
                  <div key={code} className="flex items-center gap-2 text-sm">
                    {code === 'bye' ? <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-black text-white">BYE</span> : <ClubMark league={l.league} code={code} logo={dir.byCode[code]?.logo} size={20} />}
                    <span className="min-w-0 flex-1 truncate text-slate-200">{code === 'bye' ? 'A bye (the top seed rests)' : dir.byCode[code]?.name ?? code}</span>
                    <span className="num w-11 shrink-0 text-right font-semibold text-white">{chance(p)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="mt-2 text-sm text-mute">No playoff game in the seasons simulated.</p>}
          </div>
        </div>
      )}
      <div className="px-1 pt-1 font-display text-lg font-extrabold text-white">{soccer ? 'The table and every side’s chances' : `The ${row.conf ?? 'league'} race`}</div>
      <RaceTable l={l} out={out} highlight={club} conf={soccer ? null : row.conf} grades={tb?.grades} />
    </section>
  );
}

// soccer: the chance of each place in the table, one bar a place
function Places({ positions }: { positions: number[] }) {
  const top = Math.max(...positions);
  const likely = positions.indexOf(top);
  return (
    <div className="mt-3">
      <div className="label">Each place in the table</div>
      <div className="mt-1.5 flex h-20 items-end gap-[2px]" role="img" aria-label={`Most likely place ${likely + 1} (${chance(top)})`}>
        {positions.map((p, i) => (
          <div key={i} title={`${rankWord(i + 1)}: ${chance(p)}`} className="flex-1 rounded-t-[3px]" style={{ height: `${Math.max(2, (p / (top || 1)) * 100)}%`, background: i === likely ? 'rgb(var(--club-rgb))' : i >= positions.length - 3 ? 'rgb(248 113 113 / .55)' : 'rgb(148 163 184 / .45)' }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-mute"><span>1st</span><span>Most likely {rankWord(likely + 1)} ({chance(top)})</span><span>{rankWord(positions.length)}</span></div>
    </div>
  );
}

// ── every measure, ranked
function Numbers({ a, sport, of }: { a: SportRead; sport: SportLeague['sport']; of: number }) {
  const groups = [...new Set(MEASURES[sport].map((m) => m.group))].filter((g) => a.ranks.some((r) => r.group === g));
  const [group, setGroup] = useState<MeasureGroup | 'all'>(groups[0] ?? 'all');
  const [open, setOpen] = useState<string | null>(null);
  const shown = group === 'all' ? a.ranks : a.ranks.filter((r) => r.group === group);
  return (
    <section className="space-y-3">
      <Head id="numbers" title="By the numbers" sub={`${a.ranks.length} measures, each ranked among the ${of} clubs. Tap a row for what it measures.`} />
      <Chips label="Group" items={[...groups.map((g) => [g, g] as const), ['all', 'All'] as const]} value={group} onChange={setGroup} />
      <div className="card divide-y divide-white/[.05] p-1">
        {shown.map((r) => {
          const filled = (r.of - r.rank + 1) / r.of;
          const tone = r.style ? 'text-slate-200' : r.rank <= Math.round(r.of / 3) ? 'text-emerald-300' : r.rank > r.of - Math.round(r.of / 3) ? 'text-red-300' : 'text-slate-200';
          return (
            <button key={r.key} type="button" onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key} className="block w-full px-3 py-2.5 text-left">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 text-slate-200">{r.label}</span>
                <span className="num font-semibold text-white">{r.fmt(r.value)}</span>
                <span className={`num w-12 shrink-0 text-right text-xs font-bold ${tone}`}>{r.style ? '' : rankWord(r.rank)}</span>
              </div>
              {!r.style && <div className="mt-1 h-1.5 rounded-full bg-white/[.06]"><div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, filled * 100)}%`, background: tone.includes('emerald') ? 'rgb(52 211 153)' : tone.includes('red') ? 'rgb(248 113 113)' : 'rgb(var(--club-rgb))' }} /></div>}
              {open === r.key && <p className="mt-1.5 text-[12px] leading-snug text-mute">{r.what[0].toUpperCase() + r.what.slice(1)}. League average {r.fmt(r.avg)}; best {r.fmt(r.best)}, worst {r.fmt(r.worst)}.{r.style ? ' A style, not a grade.' : ''}</p>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── the games: the last few and the next few with their chances
function Games({ l, a }: { l: SportLeague; a: SportRead }) {
  const clubs = new Map(l.clubs.map((c) => [c.code, c]));
  const soccer = l.sport === 'soccer';
  const f = a.form;
  return (
    <section className="space-y-3">
      <Head id="games" title="The games" sub={`The last ${f?.games.length ?? 'few'} and the next five, each with its chance (the market's where it has set one).`} />
      {f && (
        <div className="card p-3">
          <div className="flex items-baseline justify-between gap-2">
            <b className="text-white">Form</b>
            <span className="flex items-center gap-1 text-[12px] text-mute">{f.trend === 'up' ? <TrendingUp className="h-3.5 w-3.5 text-emerald-300" /> : f.trend === 'down' ? <TrendingDown className="h-3.5 w-3.5 text-red-300" /> : null}{(soccer ? 'goal' : 'point')} margin {f.margin >= 0 ? '+' : '−'}{Math.abs(f.margin).toFixed(1)} a {SPORTS[l.sport].noun}, season {f.seasonMargin >= 0 ? '+' : '−'}{Math.abs(f.seasonMargin).toFixed(1)}</span>
          </div>
          <div className="scroll-x mt-2 flex gap-1.5">
            {[...f.games].reverse().map((g) => (
              <div key={g.at} className="flex w-[64px] shrink-0 flex-col items-center gap-1 rounded-xl bg-black/20 px-1 py-1.5 ring-1 ring-white/[.06]">
                <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-black ${g.res === 'W' ? 'bg-emerald-400/20 text-emerald-300' : g.res === 'L' ? 'bg-red-400/20 text-red-300' : 'bg-white/10 text-slate-200'}`}>{g.res}</span>
                <ClubMark league={l.league} code={g.opp} logo={clubs.get(g.opp)?.logo} size={20} />
                <span className="num text-[11px] font-semibold text-white">{g.us}-{g.them}</span>
                <span className="text-[9px] text-mute">{g.home ? 'home' : 'away'} · {dayOf(g.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {a.ahead && (
        <div className="card divide-y divide-white/[.05] p-1">
          <div className="px-3 py-2 text-[12px] text-mute">{a.ahead.left} left, {a.ahead.home} at home: the <b className="text-slate-200">{rankWord(a.ahead.rank)} hardest</b> schedule of {a.ahead.of} from here.</div>
          {a.ahead.next.map((g) => {
            const o = clubs.get(g.opp);
            const lose = 1 - g.win - (g.draw ?? 0);
            return (
              <div key={g.at} className="flex items-center gap-2.5 px-3 py-2">
                <ClubMark league={l.league} code={g.opp} logo={o?.logo} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{g.home ? 'vs' : '@'} {o?.short ?? g.opp}</div>
                  <div className="text-[11px] text-mute">{kickoff(g.at)}{g.market ? ' · the market' : ''}</div>
                </div>
                <div className="w-28 shrink-0">
                  <div className="flex h-2 overflow-hidden rounded-full bg-white/[.06]" role="img" aria-label={`Win ${chance(g.win)}${g.draw != null ? `, draw ${chance(g.draw)}` : ''}, lose ${chance(lose)}`}>
                    <div style={{ width: `${g.win * 100}%`, background: 'rgb(var(--club-rgb))' }} />
                    {g.draw != null && <div className="border-l-2 border-[#0e1527]" style={{ width: `${g.draw * 100}%`, background: 'rgb(148 163 184 / .55)' }} />}
                  </div>
                  <div className="mt-0.5 text-right text-[11px]"><b className="num text-white">{chance(g.win)}</b><span className="text-mute"> to win{g.draw != null ? ` · ${chance(g.draw)} draw` : ''}</span></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── the players
function Players({ l, c, a }: { l: SportLeague; c: SportClub; a: SportRead }) {
  const p = a.players;
  const [all, setAll] = useState(false);
  if (!p) return null;
  return (
    <section className="space-y-3">
      <Head id="players" title="The players" sub="The club's leaders, the ages of the players doing the most, and who is hurt." />
      {p.leaders.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {p.leaders.map((x) => {
            const top = x.rows[0];
            return (
              <div key={x.cat} className="card flex flex-col p-3">
                <div className="label">{x.label}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  {top.player?.headshot ? <img src={top.player.headshot} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-full bg-white/[.06] object-cover" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[.06] font-display text-sm font-extrabold text-white">{top.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>}
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold leading-tight text-white [overflow-wrap:anywhere]">{top.name}</div>
                    <div className="num font-display text-xl font-extrabold leading-tight" style={{ color: 'var(--club)' }}>{top.display}</div>
                  </div>
                </div>
                {x.rows.slice(1).map((r) => <div key={r.id} className="mt-1 flex justify-between gap-2 text-[11px] text-mute"><span className="truncate">{r.name}</span><span className="num shrink-0">{r.display}</span></div>)}
              </div>
            );
          })}
        </div>
      )}
      {p.table.length > 0 && (
        <div className="card overflow-hidden">
          <div className="scroll-x">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead><tr className="border-b border-white/[.06] text-[10px] uppercase tracking-wider text-mute">
                <th className="sticky left-0 bg-[#0e1527] px-3 py-2 text-left font-bold">Player</th>
                {p.cols.map((x) => <th key={x.key} className="num px-2 py-2 text-right font-bold">{x.label}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-white/[.05]">
                {(all ? p.table : p.table.slice(0, 12)).map((r) => (
                  <tr key={r.player.id}>
                    <td className="sticky left-0 max-w-[150px] truncate bg-[#0e1527] px-3 py-1.5 text-slate-200">{r.player.name}<span className="text-mute"> {r.player.pos}</span></td>
                    {p.cols.map((x) => <td key={x.key} className="num px-2 py-1.5 text-right text-white">{r.cells[x.key] == null ? '–' : x.fmt(r.cells[x.key]!)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 pb-2"><ShowMore open={all} total={p.table.length} shown={12} onClick={() => setAll(!all)} what="players" /></div>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="card p-3">
          <div className="label">The ages</div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <div><div className="num font-display text-2xl font-extrabold text-white">{p.coreAge?.toFixed(1) ?? '–'}</div><div className="text-[11px] leading-tight text-mute">the players doing the most</div></div>
            <div><div className="num font-display text-2xl font-extrabold text-white">{p.avgAge?.toFixed(1) ?? '–'}</div><div className="text-[11px] leading-tight text-mute">the whole roster</div></div>
          </div>
          <p className="mt-2 text-[12px] text-slate-300">{p.young} aged 24 or younger, {p.old} aged 31 or more{p.stars ? `. ${p.stars.names.join(' and ')}: ${Math.round(p.stars.share * 100)}% ${p.stars.what}.` : '.'}</p>
        </div>
        <div className="card p-3">
          <div className="label flex items-center gap-1"><HeartPulse className="h-3 w-3" />Who is hurt</div>
          {p.hurt.length ? (
            <ul className="mt-1.5 space-y-1">
              {p.hurt.slice(0, 8).map((x) => (
                <li key={x.id} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-slate-200">{x.name}<span className="text-mute"> {x.pos}</span></span>
                  <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold ring-1 ${/out|injured|reserve/i.test(x.injury!.status) ? 'bg-red-500/15 text-red-200 ring-red-400/30' : 'bg-amber-500/15 text-amber-200 ring-amber-400/30'}`}>{x.injury!.status}</span>
                </li>
              ))}
              {p.hurt.length > 8 && <li className="text-[11px] text-mute">and {p.hurt.length - 8} more</li>}
            </ul>
          ) : <p className="mt-1.5 text-sm text-mute">Nobody on the injury report.</p>}
        </div>
      </div>
      {c.coach && <p className="px-1 text-[12px] text-mute">Head coach: <b className="text-slate-200">{c.coach.name}</b>{c.coach.years != null ? `, ${c.coach.years} season${c.coach.years === 1 ? '' : 's'} as a head coach` : ''}.</p>}
      <p className="px-1 text-[11px] text-mute">{l.sport === 'basketball' ? 'Per game, this season.' : l.sport === 'soccer' ? 'League matches this season.' : 'This season.'} From ESPN.</p>
    </section>
  );
}

// ── the front office: the bigger questions, each with the fans' verdict, the needs and the moves
const VERDICT = { Rethink: 'bg-red-500/15 text-red-200 ring-red-400/30', Adjust: 'bg-amber-500/15 text-amber-200 ring-amber-400/30', Keep: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30' } as const;
const PRIORITY = { high: ['Priority', 'bg-red-500/15 text-red-200 ring-red-400/30'], medium: ['Next', 'bg-amber-500/15 text-amber-200 ring-amber-400/30'], watch: ['Watch', 'bg-sky-500/15 text-sky-200 ring-sky-400/30'] } as const;
function Office({ a }: { a: SportRead }) {
  const [tab, setTab] = useState<'big' | 'needs'>('big');
  const counts = (['Rethink', 'Adjust', 'Keep'] as const).map((v) => [v, a.questions.filter((q) => q.verdict === v).length] as const);
  return (
    <section className="space-y-3">
      <Head id="office" title="The front office" sub="What the numbers say the general manager and the coaches should do, with the fans' own verdict beside each call." />
      <Chips label="Front office" items={[['big', 'The bigger questions'], ['needs', 'Needs and moves']] as const} value={tab} onChange={setTab} />
      {tab === 'big' ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {counts.map(([v, n]) => <div key={v} className={`rounded-2xl px-2 py-2 text-center ring-1 ${VERDICT[v]}`}><div className="num font-display text-xl font-extrabold">{n}</div><div className="text-[10px] font-semibold">{v}</div></div>)}
          </div>
          <div className="space-y-2">
            {a.questions.map((q) => (
              <div key={q.area} className="card p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1"><div className="text-[11px] font-bold uppercase tracking-wider text-mute">{q.label}</div><b className="block text-white">{q.title}</b></div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${VERDICT[q.verdict]}`}>{q.verdict}</span>
                </div>
                <ul className="mt-2 space-y-1">{q.evidence.map((e) => <li key={e} className="flex gap-2 text-[13px] leading-snug text-slate-300"><span className="shrink-0 text-mute">·</span>{e}</li>)}</ul>
                <p className="mt-2 rounded-xl bg-white/[.04] px-3 py-2 text-sm leading-snug text-slate-100 ring-1 ring-white/[.06]"><b style={{ color: 'var(--club)' }}>What to do. </b>{q.action}</p>
                <VerdictCall topic={QUESTION_CALLS[q.area]} verdict={q.verdict} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="card p-4">
            <b className="text-white">The needs, from the numbers</b>
            {a.needs.length ? (
              <ul className="mt-2 space-y-2">
                {a.needs.map((n) => <li key={n.key} className="flex gap-2.5"><span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--club)' }} /><span className="text-sm leading-snug"><b className="text-white">{n.label}.</b> <span className="text-slate-300">{n.why}</span></span></li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-mute">The numbers don&apos;t name a hole right now.</p>}
            <p className="mt-2 text-[11px] text-mute">Make your own call on the biggest need in the fans&apos; section below.</p>
          </div>
          {a.moves.length > 0 && (
            <div className="card p-4">
              <b className="text-white">What to work on</b>
              <ol className="mt-2 space-y-3">
                {a.moves.map((m, i) => (
                  <li key={m.title} className="flex gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: 'rgb(var(--club-rgb) / .3)' }}>{i + 1}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5"><b className="text-white">{m.title}</b><span className={`rounded-full px-1.5 py-px text-[10px] font-bold ring-1 ${PRIORITY[m.priority][1]}`}>{PRIORITY[m.priority][0]}</span><span className="text-[11px] text-mute">{m.area}</span></div>
                      <p className="mt-0.5 text-sm leading-snug text-slate-300">{m.why}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="px-1 text-[11px] text-mute">Contracts and the salary cap aren&apos;t in the free feeds, so fit under the cap isn&apos;t judged.</p>
        </div>
      )}
    </section>
  );
}

// ── the fans: who they are, their calls, the board and the way to the pulse
function FansSection({ l, c, name, post }: { l: SportLeague; c: SportClub; name: string; post: number | null }) {
  const v = useVoice();
  const p = v?.pulse;
  return (
    <section className="space-y-3">
      <Head id="fans" title="The fans" sub={`What ${name} fans call, ask and would change: open to everyone, the club's own front office included.`} />
      <FanMeBar />
      <FanCalls sport={{ club: c, league: l }} />
      <div className="px-1 pt-1">
        <div className="flex items-center gap-1.5 font-display text-lg font-extrabold text-white"><Megaphone className="h-4 w-4" style={{ color: 'var(--club)' }} />The board</div>
        <p className="text-[13px] text-mute">Ideas, questions for the club, insights and fixes. Vote the best to the top.</p>
      </div>
      <FanBoard post={post} />
      <Link to={zonePath(l.league, c.club, 'pulse')} className="card flex items-center gap-3 p-4 hover:bg-white/[.03]">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: 'rgb(var(--club-rgb) / .2)', boxShadow: 'inset 0 0 0 1px rgb(var(--club-rgb) / .45)' }}><Activity className="h-5 w-5" style={{ color: 'var(--club)' }} /></span>
        <span className="min-w-0 flex-1">
          <b className="block text-white">The {name} fan pulse</b>
          <span className="block text-[12px] leading-snug text-mute">{p ? `${p.people} fan${p.people === 1 ? '' : 's'}, ${Object.values(p.calls).reduce((t, x) => t + x.total, 0)} calls, ${p.counts.idea ?? 0} ideas and ${p.counts.ask ?? 0} questions` : 'Every call and the top ideas'} on one page to share with anyone, the club included.</span>
        </span>
        <BookOpen className="h-4 w-4 shrink-0 text-mute" />
      </Link>
    </section>
  );
}

function News({ c }: { c: SportClub }) {
  if (!c.news.length) return null;
  return (
    <section className="space-y-3">
      <Head id="news" title="The news" sub="The club's own stories from ESPN." />
      <div className="card divide-y divide-white/[.05] p-1">
        {c.news.slice(0, 8).map((n) => (
          <a key={n.headline} href={n.link ?? undefined} target="_blank" rel="noopener noreferrer" className="flex gap-3 px-3 py-2.5 hover:bg-white/[.03]">
            {n.image && <img src={n.image} alt="" loading="lazy" className="h-14 w-20 shrink-0 rounded-lg bg-white/[.06] object-cover" />}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-snug text-white [overflow-wrap:anywhere]">{n.headline}</span>
              {n.blurb && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-slate-400">{n.blurb}</span>}
              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-mute">{n.at ? `${ago(n.at, Date.now())} · ` : ''}ESPN<ExternalLink className="h-3 w-3" /></span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
