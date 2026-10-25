// A club's fan zone (24 October 2026, Patrick: "a dedicated super fan page of the Edmonton Oilers ... news, player
// development, facts, history and even a deep assessment of the team"). #/fans/<club>: the league's own club by default
// (league_rules.info.fan_club; SaK's is Edmonton), any of the 32 from the switcher. Everything live comes from nhl-hub's
// `fan` task, the reading of it from src/lib/fanZone.ts and src/lib/fanDeep.ts, the history from nhl-hub's `fan-history`
// (the NHL's record books) and src/data/clubHistory.ts (the lore). 24 October 2026, Patrick: "improve the fan zone
// analytics and history and facts by at least 300%": the outlook (playoff odds), splits, tracking, player analytics,
// and the record books, trophies, draft, facts and a quiz. 25 October 2026, Patrick: "make the new fan page and analysis
// an open source type project ... for all the different NHL teams ... easy to share ... crowdsourcing from the fans":
// every club in its own colours, open to everyone (PublicFans.tsx), a share button, and the fans' voice (the calls, the
// board, the knowledge base and the pulse, src/components/fan/FanVoice.tsx and FanBoard.tsx). Later that day ("amazing
// deep analysis, outlook and history pages ... share in the most epic and amazing fashions"): the zone is pages, each
// with its own link and picture: the overview (#/fans/EDM), the analysis (/analysis), the outlook (/outlook, the seeds,
// the first round and the spring round by round), the history (/history) and the pulse; the share sheet draws the
// verdict, the outlook, the history, the fan's own calls and the pulse as pictures (zoneShare.ts, src/lib/fanCards.ts).
import { lazy, Suspense, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Activity, ArrowDown, ArrowRight, ArrowUp, BookOpen, ExternalLink, Flame, Lightbulb, Megaphone, Snowflake, Sparkles, TrendingDown, TrendingUp, Trophy, Users } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { hub } from '../lib/nhlhub';
import { ago, fmtDate, fmtPts, NHL_TEAMS } from '../lib/format';
import { assess, fmtToi, GROUPS, rankWord, type Development, type FanData, type MetricGroup, type Ranked } from '../lib/fanZone';
import { ahead, champion, crease, deepRecs, division, form, historyFacts, outlook, players, splits, trackingRead, truth, type FanHistory } from '../lib/fanDeep';
import { CLUB_LORE } from '../data/clubHistory';
import { LoadError, NhlLogo, Spinner, TeamBadge } from '../components/ui';
import { usePlayerInfo } from '../lib/playerInfo';
import { Chips, Head } from '../components/fan/kit';
import { FanForm, FanOutlook } from '../components/fan/FanOutlook';
import { FanSplits, FanStyle } from '../components/fan/FanSplits';
import { CreaseDeep, LuckWatch, Milestones, PlayerTable, Usage } from '../components/fan/FanPlayersDeep';
import { FanDraft, FanFacts, FanHistorySection, FanRecords, FanTrophies } from '../components/fan/FanHistory';
import { FanCrease } from '../components/fan/FanCrease';
import { FanOffice } from '../components/fan/FanOffice';
import { blame as blameOf, coaching, crease as creaseOf, goalieMarket, goaliePlan, goalieRecs, questions, targets, type FanOffice as OfficeData } from '../lib/fanOffice';
import { clubTheme, clubVars } from '../data/clubColors';
import { NHL_DIR, PublicFrame, fanLink, type ZonePage } from '../lib/fanVoice';
import { FanCalls, FanMeBar, FanVoiceProvider, useVoice } from '../components/fan/FanVoice';
import { FanBoard, FanKnowledge } from '../components/fan/FanBoard';
import { ShareButton } from '../components/fan/FanShare';
import { ZoneTabs, type ZoneTab } from '../components/fan/ZoneTabs';
import { nhlOptions } from '../components/fan/zoneShare';
import { pctWord } from '../lib/share';

const CLUB_KEY = 'sp-fan-club';
const ROUND = ['', 'First round', 'Second round', 'Conference final', 'Stanley Cup Final'];
const seasonLabel = (s: number) => `${String(s).slice(0, 4)}-${String(s).slice(6, 8)}`;
const SportFanLeague = lazy(() => import('./SportFanLeague'));
const SportFanZone = lazy(() => import('./SportFanZone'));
const TABS: ZoneTab[] = [['', 'Overview'], ['analysis', 'Analysis'], ['outlook', 'Outlook'], ['history', 'History']];
const PAGE_TITLE: Record<string, string> = { '': 'fan zone', analysis: 'the analysis', outlook: 'the outlook', history: 'the history' };

// #/fans/<x>: an NHL club's three capitals (EDM) with one of its pages after it (/fans/EDM/outlook), or another league's
// key (nfl), whose own page has every club and its board, and its clubs (/fans/nfl/KC); the NHL's board is the fan zones'
// front page
export default function FanZone() {
  const { club: param, league } = useParams();
  if (league) {
    if (/^[a-z]/.test(league)) return <Suspense fallback={<div className="flex justify-center py-20"><Spinner /></div>}><SportFanZone /></Suspense>;
    return <NhlFanZone club={league.toUpperCase()} tab={param ?? ''} />;
  }
  if (param && /^[a-z]/.test(param)) {
    return param === 'nhl' ? <Navigate to="/fans" replace />
      : <Suspense fallback={<div className="flex justify-center py-20"><Spinner /></div>}><SportFanLeague league={param} /></Suspense>;
  }
  return <NhlFanZone club={param} tab="" />;
}

function NhlFanZone({ club: param, tab }: { club?: string; tab: string }) {
  const nav = useNavigate();
  const { league } = useLeague();
  const leagueClub = (league?.info as { fan_club?: string } | undefined)?.fan_club;
  const remembered = (() => { try { return localStorage.getItem(CLUB_KEY); } catch { return null; } })();
  const club = (param ?? leagueClub ?? (remembered && !remembered.includes('/') ? remembered : null) ?? 'EDM').toUpperCase();
  const known = !!NHL_TEAMS[club];
  const framed = useContext(PublicFrame);
  // a shared post (?post=12) opens the fans' board on it
  const { search } = useLocation();
  const post = Number(new URLSearchParams(search).get('post')) || null;
  const [data, setData] = useState<FanData | null>(null);
  const [hist, setHist] = useState<FanHistory | null>(null);
  const [office, setOffice] = useState<OfficeData | null>(null);
  const [officeDone, setOfficeDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    setData(null); setFailed(false); setHist(null); setOffice(null); setOfficeDone(false);
    if (!known) return;
    try { localStorage.setItem(CLUB_KEY, club); } catch { /* nothing to remember with */ }
    hub<FanData>('fan', { abbrev: club }).then(setData, () => setFailed(true));
    // the record books come on their own: the live page doesn't wait for them
    hub<FanHistory>('fan-history', { abbrev: club }).then(setHist, () => {});
    // and the front office: the goalies in depth and the league's players worth a call
    hub<OfficeData>('fan-office', { abbrev: club }).then(setOffice, () => {}).finally(() => setOfficeDone(true));
  }, [club, tries, known]);
  useEffect(() => { document.title = `${NHL_TEAMS[club] ?? club}: ${PAGE_TITLE[tab] ?? 'fan zone'} · Super Pools`; }, [club, tab]);
  useEffect(() => { if (post && data) setTimeout(() => document.getElementById('fz-fans')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600); }, [post, !!data]);
  // a new page opens at its top
  useEffect(() => { window.scrollTo(0, 0); }, [club, tab]);
  const lore = CLUB_LORE[club];
  const colors = lore?.colors ?? clubTheme(club);
  const a = useMemo(() => (data ? assess(data) : null), [data]);
  // the deeper reads, worked out once per answer (the simulation is the heavy one: a few thousand seasons)
  const deep = useMemo(() => {
    if (!data) return null;
    const out = outlook(data, 3000), tr = truth(data), sp = splits(data), fm = form(data), ah = ahead(data), pl = players(data), cr = crease(data);
    const recs = [...(a?.recs ?? []), ...deepRecs(data, { out, tr, pl, cr, ah, sp })];
    const order = { high: 0, medium: 1, watch: 2 };
    recs.sort((x, y) => order[x.priority] - order[y.priority]);
    return { out, tr, sp, fm, ah, pl, cr, recs, track: trackingRead(data), champ: champion(data), div: division(data) };
  }, [data, a]);
  // the crease and the front office, once their numbers are in
  const fo = useMemo(() => {
    if (!data || !a || !deep || !office) return null;
    const reads = creaseOf(data, office), bl = blameOf(office, reads), plan = goaliePlan(reads, deep.ah), market = goalieMarket(data, office, reads, deep.out?.all ?? null);
    return { reads, bl, plan, market, needs: targets(data, a, office, deep.out?.all ?? null), coach: coaching(data, office, plan), qs: questions(data, a, office, reads, bl, deep.out, hist), recs: goalieRecs(plan, market) };
  }, [data, a, deep, office, hist]);
  // the verdict's calls: the goalie calls come from the crease's deeper read once it is in
  const recs = useMemo(() => {
    if (!deep) return [];
    const order = { high: 0, medium: 1, watch: 2 };
    return fo?.reads.length ? [...deep.recs.filter((r) => r.area !== 'Goaltending'), ...fo.recs].sort((x, y) => order[x.priority] - order[y.priority]) : deep.recs;
  }, [deep, fo]);
  // a fact a day: the same one all day, a new one tomorrow
  const fact = useMemo(() => {
    const facts = [...(hist ? historyFacts(hist) : []), ...(lore?.facts ?? [])];
    if (!facts.length) return null;
    const day = Math.floor(Date.now() / 86_400_000);
    return facts[day % facts.length];
  }, [hist, lore]);
  const record = data?.standing ? `${data.standing.w}-${data.standing.l}-${data.standing.otl} · ${data.standing.pts} pts` : '';
  // the page's own sections, for the jump bar
  const sections: readonly (readonly [string, string])[] = tab === 'analysis' ? [['verdict', 'Verdict'], ['numbers', 'Numbers'], ['splits', 'Splits'], ['style', 'Style'], ['players', 'Players'], ['crease', 'Crease'], ['office', 'Front office'], ['kb', 'Knowledge']]
    : tab === 'outlook' ? [['outlook', 'Chances'], ['games', 'Games']]
      : tab === 'history' ? [['history', 'History'], ['records', 'Records'], ['trophies', 'Trophies'], ['draft', 'Draft'], ['facts', 'Facts'], ['kb', 'Knowledge']]
        : [];
  // the league as a whole and a club that isn't one have the fan zones' front page; a page that isn't one has the overview
  if (!known) return <Navigate to="/fans" replace />;
  if (tab && !TABS.some(([k]) => k === tab)) return <Navigate to={`/fans/${club}`} replace />;

  return (
    <div className="space-y-5" style={clubVars(club, lore?.colors)}>
      <FanVoiceProvider club={club}>
      {/* the hero: the club, its season so far, its chances and the next game */}
      <div className="relative overflow-hidden rounded-[28px] border p-4 sm:p-6" style={{ borderColor: `rgb(${colors.rgb} / .35)`, background: `radial-gradient(120% 90% at 100% 0%, rgb(${colors.rgb} / .35), transparent 55%), linear-gradient(160deg, ${colors.secondary}, #070b16 75%)` }}>
        <div className="pointer-events-none absolute -right-8 -top-8 opacity-[.12]"><NhlLogo abbr={club} size={220} /></div>
        <div className="relative flex items-start gap-3">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/95 shadow-lg sm:h-20 sm:w-20"><NhlLogo abbr={club} size={52} light /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[.2em]" style={{ color: colors.primary }}>{lore ? `${lore.nickname} · ` : ''}{PAGE_TITLE[tab] ?? 'fan zone'}</div>
            <h1 className="font-display text-[clamp(26px,8vw,40px)] font-extrabold italic leading-[.95] text-white">{data?.name ?? NHL_TEAMS[club] ?? club}</h1>
            {data?.standing && <div className="mt-1 text-sm text-slate-300">{data.standing.w}-{data.standing.l}-{data.standing.otl} · {data.standing.pts} pts · {rankWord(data.standing.divRank)} in the {data.standing.div}</div>}
          </div>
          {!framed && (
            <select aria-label="Pick a club" value={club} onChange={(e) => nav(`/fans/${e.target.value}${tab ? `/${tab}` : ''}`)}
              className="relative h-9 max-w-[7.5rem] shrink-0 rounded-full border border-white/15 bg-black/30 px-2 text-xs font-semibold text-white">
              {Object.entries(NHL_TEAMS).sort((x, y) => x[1].localeCompare(y[1])).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </div>
        {data?.standing && a && (
          <div className="relative mt-4 grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
            {[
              ['Grade', a.grade, 'so far'],
              ['Playoffs', deep?.out ? pctWord(deep.out.playoffs) : '–', deep?.out ? `~${deep.out.projected.mid} pts · Cup ${pctWord(deep.out.rounds.cup)}` : ''],
              ['League', rankWord(data.standing.leagueRank), `of 32 · ${data.standing.gd > 0 ? '+' : ''}${data.standing.gd}`],
              ['Last 10', data.standing.l10, data.standing.streak ? `streak ${data.standing.streak}` : ''],
            ].map(([k, v, sub], i) => (
              <div key={k} className="min-w-0 rounded-2xl bg-black/30 px-2 py-2 ring-1 ring-white/10">
                <div className="label truncate">{k}</div>
                <div className={`font-display font-extrabold leading-tight text-white ${i < 2 ? 'text-[clamp(22px,7vw,30px)]' : 'text-[clamp(16px,5vw,22px)]'}`} style={i < 2 ? { color: colors.primary } : undefined}>{v}</div>
                <div className="truncate text-[10px] text-mute">{sub}</div>
              </div>
            ))}
          </div>
        )}
        {tab === '' && data && (data.recent[0] || data.upcoming[0]) && (
          <div className="relative mt-3 grid grid-cols-2 gap-2 text-xs">
            {data.recent[0] && <GameChip g={data.recent[0]} club={club} label="Last game" />}
            {data.upcoming[0] && <GameChip g={data.upcoming[0]} club={club} label="Next game" />}
          </div>
        )}
        {tab === '' && fact && (
          <div className="relative mt-3 flex items-start gap-2 rounded-2xl bg-black/25 px-3 py-2 text-[13px] leading-snug text-slate-200 ring-1 ring-white/10">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colors.primary }} /><span><b className="text-white">Fact of the day.</b> {fact}</span>
          </div>
        )}
        <HeroActions club={club} name={data?.name ?? NHL_TEAMS[club]} a={a} out={deep?.out ?? null} hist={hist} record={record} />
      </div>

      {/* the pages, and the page's own sections */}
      <ZoneTabs base={`/fans/${club}`} tabs={TABS} current={tab} pulse={`/fans/${club}/pulse`} />
      {data && sections.length > 0 && (
        <div className="scroll-x flex gap-1.5">
          {sections.map(([id, label]) => (
            <button key={id} type="button" onClick={() => document.getElementById(`fz-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="shrink-0 rounded-full border border-white/10 bg-white/[.05] px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-white/[.1]">{label}</button>
          ))}
        </div>
      )}

      {!data ? (failed ? <LoadError what={`the ${NHL_TEAMS[club] ?? club} fan zone`} onRetry={() => setTries((n) => n + 1)} /> : <div className="flex justify-center py-16"><Spinner /></div>) : a && deep && (
        tab === 'analysis' ? (
          <>
            <Verdict a={a} recs={recs} share={{ url: fanLink(club, 'analysis'), title: `${data.name}: the analysis`, text: `${data.name}: grade ${a.grade}. ${a.summary}` }} />
            <Numbers ranks={a.ranks} prevSeason={data.prevSeason} />
            <FanSplits sp={deep.sp} />
            <FanStyle lines={deep.track} tracking={data.tracking} />
            <Players d={data} a={a} deep={deep} creaseLater={!!fo?.reads.length || !officeDone} />
            {fo && <FanCrease reads={fo.reads} blame={fo.bl} plan={fo.plan} market={fo.market} owner={(id) => <OwnerBadge id={id} />} />}
            <FanOffice qs={fo?.qs ?? []} needs={fo?.needs ?? []} coach={fo?.coach ?? null} loading={!officeDone} />
            <Knowledge />
            <Footnote d={data} />
          </>
        ) : tab === 'outlook' ? (
          <>
            <FanOutlook d={data} out={deep.out} tr={deep.tr} champ={deep.champ} div={deep.div} ah={deep.ah} share={deep.out ? { url: fanLink(club, 'outlook'), title: `${data.name}: the outlook`, text: `${data.name}: ${pctWord(deep.out.playoffs)} to make the playoffs, ${pctWord(deep.out.rounds.cup)} for the Cup, projected ${deep.out.projected.mid} points.` } : undefined} />
            <Games d={data} club={club} form={<FanForm d={data} fm={deep.fm} out={deep.out} />} />
            <Footnote d={data} />
          </>
        ) : tab === 'history' ? (
          <>
            <FanHistorySection h={hist} lore={lore} share={{ url: fanLink(club, 'history'), title: `${data.name}: the history`, text: `The ${data.name}' history: every season, the Cups, the records, the draft and the people.` }} />
            <FanRecords h={hist} lore={lore} />
            <FanTrophies h={hist} />
            <FanDraft h={hist} />
            <FanFacts h={hist} lore={lore} />
            <Knowledge />
          </>
        ) : (
          <>
            <Verdict a={a} recs={recs} compact club={club} />
            {deep.out && <Chances out={deep.out} club={club} />}
            <FansSection d={data} club={club} post={post} />
            <News d={data} />
            <Deeper club={club} hist={hist} />
            <Footnote d={data} />
          </>
        )
      )}
      </FanVoiceProvider>
    </div>
  );
}

function Knowledge() {
  return (
    <section className="space-y-3">
      <Head id="kb" title="The fans' knowledge base" sub="Facts, records and stories fans add about the club, marked when the editors have checked them. Open data, free to use." />
      <FanKnowledge />
    </section>
  );
}
function Footnote({ d }: { d: FanData }) {
  return <p className="px-1 text-[11px] text-mute">Numbers from the NHL&apos;s own statistics, tracking and record books{d.stale ? ' (the last copy: the feed is slow to answer)' : ''}, read {ago(d.at, Date.now())} ago. Ranks are among all 32 clubs. Early in a season the samples are small and the numbers move; the odds pull every record toward the league average for that reason. <Link to="/fans/about" className="underline">How the fan zones work</Link>, in the open.</p>;
}

// the overview's chances: the outlook in four tiles and a line, the rest a tap away
function Chances({ out, club }: { out: NonNullable<ReturnType<typeof outlook>>; club: string }) {
  const fav = [...out.odds].sort((a, b) => b.cup - a.cup)[0];
  return (
    <section className="space-y-3">
      <Head id="chances" title="The chances" sub={`The rest of the season played ${out.sims.toLocaleString()} times, the spring too.`} right={<Link to={`/fans/${club}/outlook`} className="flex shrink-0 items-center gap-1 text-sm font-semibold" style={{ color: 'var(--club)' }}>The outlook<ArrowRight className="h-3.5 w-3.5" /></Link>} />
      <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
        {([['Playoffs', out.playoffs, `~${out.projected.mid} pts`], ['Win the division', out.division, out.seeds[0] ? `${pctWord(out.seeds[0].chance)} first` : ''], ['Reach the Final', out.rounds.final, `conference ${pctWord(out.rounds.conf)}`], ['Stanley Cup', out.rounds.cup, fav ? `favourite ${fav.abbrev} ${pctWord(fav.cup)}` : '']] as const).map(([k, v, sub], i) => (
          <div key={k} className="min-w-0 rounded-2xl bg-black/25 px-2.5 py-2 ring-1 ring-white/10">
            <div className="label truncate">{k}</div>
            <div className="num font-display text-[clamp(20px,6vw,26px)] font-extrabold leading-tight" style={{ color: i === 3 ? 'rgb(252 211 77)' : v >= 0.5 ? 'var(--club)' : 'white' }}>{pctWord(v)}</div>
            <div className="truncate text-[10px] text-mute">{sub}</div>
            <div className="mt-1 h-1 rounded-full bg-white/[.06]"><div className="h-1 rounded-full" style={{ width: `${Math.max(2, v * 100)}%`, background: i === 3 ? 'rgb(252 211 77)' : 'rgb(var(--club-rgb))' }} /></div>
          </div>
        ))}
      </div>
      {out.firstRound[0] && <p className="px-1 text-[13px] leading-snug text-slate-300">The most likely first-round opponent: the <b className="text-white">{out.firstRound[0].name}</b> ({pctWord(out.firstRound[0].chance / Math.max(0.01, out.playoffs))} of the springs they make). {out.need != null && out.need > 0 ? `The playoff line sits near ${out.line} points: ${out.need} more from ${out.left} games.` : out.need === 0 ? 'Already past the usual playoff line.' : ''}</p>}
    </section>
  );
}

// the way deeper: the pages this one leads to
function Deeper({ club, hist }: { club: string; hist: FanHistory | null }) {
  const cups = hist?.seasons.filter((s) => s.po?.won && s.po.round >= 4).length ?? CLUB_LORE[club]?.cups.length ?? null;
  const items: [ZonePage, string, string, typeof Trophy][] = [
    ['analysis', 'The analysis', 'Every measure ranked, the splits, the players, the crease and the front office.', Sparkles],
    ['outlook', 'The outlook', 'The chances, where they land, the first round, the spring round by round, the schedule.', Activity],
    ['history', 'The history', `Every season${cups != null ? `, ${cups} Stanley Cup${cups === 1 ? '' : 's'}` : ''}, the records, the trophies, the draft and the people.`, Trophy],
  ];
  return (
    <section className="grid gap-2 sm:grid-cols-3">
      {items.map(([page, title, sub, Icon]) => (
        <Link key={page} to={`/fans/${club}/${page}`} className="card flex items-center gap-3 p-4 hover:bg-white/[.03]">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: 'rgb(var(--club-rgb) / .2)', boxShadow: 'inset 0 0 0 1px rgb(var(--club-rgb) / .45)' }}><Icon className="h-5 w-5" style={{ color: 'var(--club)' }} /></span>
          <span className="min-w-0 flex-1"><b className="block text-white">{title}</b><span className="block text-[12px] leading-snug text-mute">{sub}</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-mute" />
        </Link>
      ))}
    </section>
  );
}

// the hero's way in to the fans: have your say, the club's pulse, and a share with pictures to choose from
function HeroActions({ club, name, a, out, hist, record }: { club: string; name: string; a: ReturnType<typeof assess> | null; out: ReturnType<typeof outlook> | null; hist: FanHistory | null; record: string }) {
  const v = useVoice();
  const people = v?.pulse?.people ?? 0;
  const options = useMemo(() => nhlOptions(club, a, out, hist, record, v?.pulse ?? null, v?.me?.given ?? v?.me?.name ?? null, NHL_DIR), [club, a, out, hist, record, v?.pulse, v?.me]);
  return (
    <div className="relative mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={() => document.getElementById('fz-fans')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="btn-club btn-sm px-3!"><Megaphone className="h-3.5 w-3.5" />Have your say</button>
      <Link to={`/fans/${club}/pulse`} className="btn-ghost btn-sm px-3!"><Activity className="h-3.5 w-3.5" />Fan pulse{people ? <span className="flex items-center gap-0.5 text-mute"><Users className="h-3 w-3" />{people}</span> : null}</Link>
      <ShareButton url={fanLink(club)} title={`${name} fan zone`} text={`The ${name}, read like a front office: the playoff chances, the numbers, the crease, the moves and what the fans think.`} className="btn-ghost btn-sm px-3!" options={options} heading={`Share the ${name}`} />
    </div>
  );
}

// the fans' own section: who they are, their calls for the season, the board and the way to the pulse
function FansSection({ d, club, post }: { d: FanData; club: string; post: number | null }) {
  const v = useVoice();
  const name = NHL_TEAMS[club] ?? club;
  const p = v?.pulse;
  return (
    <section className="space-y-3">
      <Head id="fans" title="The fans" sub={`What ${name} fans call, ask and would change: open to everyone, the club's own front office included.`} />
      <FanMeBar />
      <FanCalls d={d} />
      <div className="px-1 pt-1">
        <div className="flex items-center gap-1.5 font-display text-lg font-extrabold text-white"><Megaphone className="h-4 w-4" style={{ color: 'var(--club)' }} />The board</div>
        <p className="text-[13px] text-mute">Ideas, questions for the club, insights and fixes. Vote the best to the top.</p>
      </div>
      <FanBoard post={post} />
      <Link to={`/fans/${club}/pulse`} className="card flex items-center gap-3 p-4 hover:bg-white/[.03]">
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

function GameChip({ g, club, label }: { g: FanData['recent'][number]; club: string; label: string }) {
  const home = g.home === club, opp = home ? g.away : g.home;
  const done = g.state === 'OFF' || g.state === 'FINAL';
  const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
  const won = done && us != null && them != null && us > them;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-2xl bg-black/30 px-2.5 py-2 ring-1 ring-white/10">
      <NhlLogo abbr={opp} size={22} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-mute">{label}</div>
        <div className="truncate font-semibold text-white">{home ? 'vs' : '@'} {opp}{done ? <span className={won ? ' text-emerald-300' : ' text-red-300'}> {won ? 'W' : 'L'} {us}-{them}{g.outcome && g.outcome !== 'REG' ? ` ${g.outcome}` : ''}</span> : <span className="text-slate-300"> · {fmtDate(g.date)}</span>}</div>
      </div>
    </div>
  );
}

const PRIORITY = { high: ['Priority', 'bg-red-500/15 text-red-200 ring-red-400/30'], medium: ['Next', 'bg-amber-500/15 text-amber-200 ring-amber-400/30'], watch: ['Watch', 'bg-sky-500/15 text-sky-200 ring-sky-400/30'] } as const;

function Verdict({ a, recs, compact, club, share }: { a: ReturnType<typeof assess>; recs: ReturnType<typeof assess>['recs']; compact?: boolean; club?: string; share?: { url: string; title: string; text: string } }) {
  const [more, setMore] = useState(false);
  const shownRecs = compact ? recs.slice(0, 3) : recs;
  const cut = compact ? 3 : 6;
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
      <Head id="verdict" title="The verdict" sub="A read of the season from every club's numbers: what's real, what's luck, and what to do about it." share={share} right={compact && club ? <Link to={`/fans/${club}/analysis`} className="flex shrink-0 items-center gap-1 text-sm font-semibold" style={{ color: 'var(--club)' }}>The analysis<ArrowRight className="h-3.5 w-3.5" /></Link> : undefined} />
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
        {(a.strengths.length > cut || a.weaknesses.length > cut) && <button type="button" onClick={() => setMore(!more)} className="mt-1 text-sm font-semibold text-sky-300">{more ? `The top ${compact ? 'three' : 'six'} of each` : `All ${a.strengths.length} strengths and ${a.weaknesses.length} weaknesses`}</button>}
        {a.luck && (
          <div className={`mt-3 flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-sm leading-snug ring-1 ${a.luck.tone === 'hot' ? 'bg-amber-500/10 text-amber-100 ring-amber-400/25' : a.luck.tone === 'cold' ? 'bg-sky-500/10 text-sky-100 ring-sky-400/25' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}>
            {a.luck.tone === 'hot' ? <Flame className="mt-0.5 h-4 w-4 shrink-0" /> : a.luck.tone === 'cold' ? <Snowflake className="mt-0.5 h-4 w-4 shrink-0" /> : <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />}
            <span><b>The luck check.</b> {a.luck.read}</span>
          </div>
        )}
      </div>
      {recs.length > 0 && (
        <div className="card p-4">
          <div className="font-display text-lg font-extrabold text-white">What management and the coaches should consider</div>
          <p className="text-xs text-mute">{recs.length} calls from the numbers, the most pressing first{compact && recs.length > 3 ? `; the first three here` : ''}.</p>
          <ol className="mt-2 space-y-3">
            {shownRecs.map((r, i) => (
              <li key={r.title} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: 'rgb(var(--club-rgb) / .3)' }}>{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <b className="text-white">{r.title}</b>
                    <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ring-1 ${PRIORITY[r.priority][1]}`}>{PRIORITY[r.priority][0]}</span>
                    <span className="text-[11px] text-mute">{r.area}</span>
                  </div>
                  <p className="mt-0.5 text-sm leading-snug text-slate-300">{r.why}</p>
                </div>
              </li>
            ))}
          </ol>
          {compact && club && recs.length > 3 && <Link to={`/fans/${club}/analysis`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-300">All {recs.length} calls, with the numbers behind them<ArrowRight className="h-3.5 w-3.5" /></Link>}
        </div>
      )}
    </section>
  );
}

function Numbers({ ranks, prevSeason }: { ranks: Ranked[]; prevSeason: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = GROUPS.filter((g) => ranks.some((r) => r.group === g));
  const [group, setGroup] = useState<MetricGroup | 'all'>('Results');
  const shown = group === 'all' ? ranks : ranks.filter((r) => r.group === group);
  return (
    <section className="space-y-3">
      <Head id="numbers" title="By the numbers" sub={`${ranks.length} measures, each ranked among the 32 clubs, with where they ranked in ${seasonLabel(prevSeason)}. Tap a row for what it measures.`} />
      <Chips label="Group" items={[...groups.map((g) => [g, g] as const), ['all', 'All'] as const]} value={group} onChange={setGroup} />
      <div className="card divide-y divide-white/[.05] p-1">
        {shown.map((r) => {
          const filled = (r.of - r.rank + 1) / r.of;
          const moved = r.prevRank == null ? 0 : r.prevRank - r.rank;
          const tone = r.style ? 'text-slate-200' : r.rank <= Math.round(r.of / 3) ? 'text-emerald-300' : r.rank > r.of - Math.round(r.of / 3) ? 'text-red-300' : 'text-slate-200';
          return (
            <button key={r.key} type="button" onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key} className="block w-full px-3 py-2.5 text-left">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 text-slate-200">{r.label}</span>
                <span className="num font-bold text-white">{r.fmt(r.value)}</span>
                <span className={`num w-11 text-right text-xs font-bold ${tone}`}>{rankWord(r.rank)}</span>
              </div>
              <div className="relative mt-1.5 h-2 rounded-full bg-white/[.06]">
                <div className="h-2 rounded-full" style={{ width: `${Math.max(4, filled * 100)}%`, background: 'linear-gradient(90deg, rgb(var(--club-rgb) / .55), rgb(var(--club-rgb)))' }} />
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-mute">
                <span>League average {r.fmt(r.avg)}</span>
                {r.prevRank != null && (
                  <span className={`ml-auto flex items-center gap-0.5 ${moved > 0 ? 'text-emerald-300' : moved < 0 ? 'text-red-300' : ''}`}>
                    {moved > 0 ? <ArrowUp className="h-3 w-3" /> : moved < 0 ? <ArrowDown className="h-3 w-3" /> : null}{rankWord(r.prevRank)} last season
                  </span>
                )}
              </div>
              {open === r.key && <p className="mt-1.5 text-xs leading-snug text-slate-300">{r.label}: {r.what}.{r.low ? ' Lower is better.' : ''}{r.style ? ' A style, not a grade: ranked from most to least.' : ''} Best in the league {r.fmt(r.best)}, worst {r.fmt(r.worst)}.</p>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DevRow({ p, owner }: { p: Development; owner: React.ReactNode }) {
  const info = usePlayerInfo();
  const up = p.delta != null && p.delta > 0;
  return (
    <button type="button" onClick={() => info?.(p.id)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[.03]">
      {p.headshot ? <img src={p.headshot} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-full bg-white/[.06] object-cover" /> : <span className="h-10 w-10 shrink-0 rounded-full bg-white/[.06]" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5"><b className="truncate text-sm text-white">{p.name}</b>{owner}</span>
        <span className="block text-[11px] text-mute">{p.pos}{p.age != null ? ` · ${p.age}` : ''} · {p.gp} GP · {p.pts} pts · TOI {fmtToi(p.toi)}{p.toiDelta != null && Math.abs(p.toiDelta) >= 30 ? ` (${p.toiDelta > 0 ? '+' : '−'}${fmtToi(Math.abs(p.toiDelta))})` : ''}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="num block text-sm font-bold text-white">{p.ppg.toFixed(2)}</span>
        <span className={`num block text-[11px] ${p.delta == null ? 'text-mute' : up ? 'text-emerald-300' : 'text-red-300'}`}>{p.prevPpg == null ? 'new' : `${up ? '+' : ''}${p.delta!.toFixed(2)} vs last`}</span>
      </span>
    </button>
  );
}

type Deep = { pl: ReturnType<typeof players>; cr: ReturnType<typeof crease> };
function Players({ d, a, deep, creaseLater }: { d: FanData; a: ReturnType<typeof assess>; deep: Deep; creaseLater: boolean }) {
  const { owner, team } = useLeague();
  const ownerOf = (id: number) => { const o = owner.get(id); const t = o ? team(o.team_id) : undefined; return t ? <TeamBadge team={t} size={16} /> : null; };
  const groups: [Development['verdict'], string, React.ReactNode][] = [
    ['rising', 'Rising', <TrendingUp key="u" className="h-4 w-4 text-emerald-300" />],
    ['fading', 'Fading', <TrendingDown key="d" className="h-4 w-4 text-red-300" />],
    ['steady', 'Steady', null], ['new', 'New this season', <Sparkles key="n" className="h-4 w-4" style={{ color: 'var(--club)' }} />],
  ];
  const ages = d.prospects.map((p) => ({ ...p, age: p.born ? new Date().getFullYear() - Number(p.born.slice(0, 4)) : null }));
  return (
    <section className="space-y-3">
      <Head id="players" title="Players" sub="Who's growing and who's fading, the numbers behind the points, who is due and the milestones in reach." />
      {a.stars && (
        <div className="card p-4">
          <div className="flex items-baseline justify-between gap-2"><b className="text-white">Where the points come from</b><span className="text-xs text-mute">{Math.round(a.stars.share * 100)}% from the top two</span></div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-white/[.06]">
            <div style={{ width: `${a.stars.share * 100}%`, background: 'rgb(var(--club-rgb))' }} />
            <div style={{ width: `${(a.dShare ?? 0) * 100}%` }} className="bg-sky-400/70" />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mute">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: 'rgb(var(--club-rgb))' }} />{a.stars.names.join(' and ')}</span>
            {a.dShare != null && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-400/70" />Defencemen {Math.round(a.dShare * 100)}%</span>}
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-white/[.15]" />Everyone else</span>
          </div>
        </div>
      )}
      {groups.map(([v, label, icon]) => {
        const rows = a.development.filter((p) => p.verdict === v);
        if (!rows.length) return null;
        return (
          <div key={v} className="card overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-white/[.06] px-3 py-2 text-sm font-bold text-white">{icon}{label}<span className="ml-auto text-[11px] font-normal text-mute">points a game</span></div>
            <div className="divide-y divide-white/[.05]">{rows.map((p) => <DevRow key={p.id} p={p} owner={ownerOf(p.id)} />)}</div>
          </div>
        );
      })}
      <PlayerTable rows={deep.pl.rows} />
      <LuckWatch rows={deep.pl.rows} />
      <Milestones list={deep.pl.milestones} />
      <Usage leaders={deep.pl.usageLeaders} />
      {deep.cr.length > 0 && !creaseLater ? <CreaseDeep list={deep.cr} owner={ownerOf} /> : null}
      {(a.youngCore.length > 0 || ages.length > 0) && (
        <div className="card p-4">
          <b className="text-white">The future</b>
          {a.youngCore.length > 0 && <p className="mt-1 text-sm text-slate-300">On the roster at 24 and under: {a.youngCore.map((p) => `${p.name} (${p.age})`).join(', ')}.</p>}
          {ages.length > 0 && (
            <>
              <div className="label mt-3">In the system</div>
              <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {ages.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-xl bg-white/[.03] px-2.5 py-1.5 text-sm">
                    <span className="rounded-md bg-white/[.06] px-1.5 text-[10px] font-bold text-slate-300">{p.pos}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-100">{p.name}</span>
                    <span className="shrink-0 text-[11px] text-mute">{p.age ?? '–'} · {p.country}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <SakOwners d={d} />
    </section>
  );
}

// a SaK owner's badge beside a player of the club
function OwnerBadge({ id }: { id: number }) {
  const { owner, team } = useLeague();
  const o = owner.get(id); const t = o ? team(o.team_id) : undefined;
  return t ? <TeamBadge team={t} size={16} /> : null;
}

// the league's own stake in the club: which GMs own its players, and what they're worth to them this season
function SakOwners({ d }: { d: FanData }) {
  const { owner, team, season, league } = useLeague();
  const rows = [...d.skaters, ...d.goalies].map((p) => ({ p, o: owner.get(p.id), fp: season.get(p.id)?.fpts ?? null })).filter((x) => x.o).sort((a, b) => (b.fp ?? 0) - (a.fp ?? 0));
  if (!rows.length) return null;
  return (
    <div className="card p-4">
      <b className="text-white">In {league?.name ?? 'the league'}</b>
      <div className="mt-2 divide-y divide-white/[.05]">
        {rows.map(({ p, o, fp }) => { const t = team(o!.team_id); return (
          <div key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
            {t && <TeamBadge team={t} size={22} />}
            <span className="min-w-0 flex-1 truncate"><b className="text-white">{p.name}</b> <span className="text-mute">· {t?.gm_name}</span></span>
            {fp != null && <span className="num font-semibold text-white">{fmtPts(fp)}</span>}
          </div>
        ); })}
      </div>
    </div>
  );
}

function News({ d }: { d: FanData }) {
  const now = useNow(60_000);
  return (
    <section className="space-y-3">
      <Head id="news" title="News" sub="The latest on the club from ESPN, NHL.com and Sportsnet." />
      {d.news.length === 0 ? <div className="card p-4 text-sm text-mute">No stories about the club in the feeds right now.</div> : (
        <div className="card divide-y divide-white/[.05] overflow-hidden">
          {d.news.slice(0, 12).map((s) => (
            <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 px-3 py-2.5 hover:bg-white/[.03]">
              {s.image ? <img src={s.image} alt="" loading="lazy" className="h-14 w-20 shrink-0 rounded-lg object-cover ring-1 ring-white/10" /> : <span className="grid h-14 w-20 shrink-0 place-items-center rounded-lg bg-white/[.05] ring-1 ring-white/10"><NhlLogo abbr={d.abbrev} size={26} /></span>}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[11px] text-mute"><b className="text-slate-300">{s.source}</b>{s.date && <span>{ago(s.date, now)}</span>}{s.video && <span className="rounded bg-white/10 px-1">Video</span>}<ExternalLink className="ml-auto h-3 w-3" /></span>
                <span className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-white">{s.headline}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function Games({ d, club, form }: { d: FanData; club: string; form: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <Head id="games" title="Games" sub="The season game by game, the last ten, the next few, and the last three springs." />
      {form}
      <div className="card p-4">
        <div className="label">Last {d.recent.length}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...d.recent].reverse().map((g) => {
            const home = g.home === club, us = home ? g.hs : g.as, them = home ? g.as : g.hs;
            const won = us != null && them != null && us > them;
            return (
              <span key={g.id} title={`${fmtDate(g.date)} ${home ? 'vs' : '@'} ${home ? g.away : g.home} ${us}-${them}`}
                className={`flex h-12 w-11 flex-col items-center justify-center rounded-xl text-[10px] font-bold ring-1 ${won ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30' : g.outcome && g.outcome !== 'REG' ? 'bg-amber-500/10 text-amber-200 ring-amber-400/25' : 'bg-red-500/10 text-red-200 ring-red-400/25'}`}>
                <NhlLogo abbr={home ? g.away : g.home} size={16} />
                <span className="num mt-0.5">{won ? 'W' : g.outcome && g.outcome !== 'REG' ? g.outcome : 'L'} {us}-{them}</span>
              </span>
            );
          })}
        </div>
        {d.upcoming.length > 0 && (
          <>
            <div className="label mt-4">Coming up</div>
            <div className="mt-1.5 divide-y divide-white/[.05]">
              {d.upcoming.map((g) => { const home = g.home === club, opp = home ? g.away : g.home; return (
                <div key={g.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <NhlLogo abbr={opp} size={20} />
                  <span className="min-w-0 flex-1 text-slate-200">{home ? 'vs' : '@'} <b className="text-white">{NHL_TEAMS[opp] ?? opp}</b></span>
                  <span className="text-xs text-mute">{fmtDate(g.date)} · {new Date(g.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
              ); })}
            </div>
          </>
        )}
      </div>
      <div className="card p-4">
        <div className="flex items-center gap-1.5 font-bold text-white"><Trophy className="h-4 w-4" style={{ color: 'var(--club)' }} />The last three springs</div>
        <div className="mt-2 space-y-2.5">
          {d.playoffs.map((run) => (
            <div key={run.season}>
              <div className="text-xs font-semibold text-slate-300">{seasonLabel(run.season)}</div>
              {run.rounds.length === 0 ? <div className="text-sm text-mute">Missed the playoffs</div> : (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {run.rounds.map((r) => (
                    <span key={r.round} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${r.w > r.l ? 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/25' : 'bg-red-500/10 text-red-200 ring-red-400/25'}`}>
                      {ROUND[r.round] ?? `Round ${r.round}`}: <NhlLogo abbr={r.opp} size={13} /> {r.opp} {r.w}-{r.l}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
