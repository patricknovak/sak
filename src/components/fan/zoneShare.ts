// What a fan zone offers to share (25 October 2026): the page's link, and the pictures drawn on the phone from the
// page's own numbers (src/lib/fanCards.ts): the verdict, the outlook, the history, the fan's own calls, the pulse. Each
// picture points at the page it came from, so the link under it unfurls with the same numbers (worker/fans.ts).
import type { ShareOption } from '../ShareSheet';
import { fanCardJob, type CardClub, type FanCard } from '../../lib/fanCards';
import { pctWord } from '../../lib/share';
import { callLabel, callsFor, shares, zoneLink, type FanDir, type FanPulse, type FanSport, type ZonePage } from '../../lib/fanVoice';
import type { Assessment } from '../../lib/fanZone';
import type { FanHistory, Outlook } from '../../lib/fanDeep';
import { historyFacts } from '../../lib/fanDeep';
import type { Chances, SportRead, Sport } from '../../lib/fanSport';
import type { SportHistory } from '../../lib/fanSportHistory';
import { facts as sportFacts, seasonLabel, titlesOf, totals } from '../../lib/fanSportHistory';
import { NHL_TEAMS } from '../../lib/format';
import { clubTheme, sportTheme } from '../../data/clubColors';
import { CLUB_LORE } from '../../data/clubHistory';

const rankWord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

// the club as a card draws it
export function nhlCardClub(code: string, page?: ZonePage): CardClub {
  const lore = CLUB_LORE[code];
  const t = lore?.colors ? { primary: lore.colors.primary, secondary: lore.colors.secondary, ink: clubTheme(code).ink } : clubTheme(code);
  return { league: 'nhl', code, name: NHL_TEAMS[code] ?? code, color: t.primary, deep: t.secondary, ink: t.ink,
    logo: `https://assets.nhle.com/logos/nhl/svg/${code}_light.svg`, logoDark: `https://assets.nhle.com/logos/nhl/svg/${code}_dark.svg`, url: zoneLink('nhl', code, page) };
}
export function sportCardClub(dir: FanDir, code: string, page?: ZonePage): CardClub {
  const c = dir.byCode[code];
  const t = sportTheme(c?.color, c?.alt);
  return { league: dir.league, code, name: c?.name ?? code, short: c?.short, color: t.primary, deep: t.secondary, ink: t.ink, logo: c?.logo ?? null,
    logoDark: c?.logo && /\/teamlogos\/[a-z]+\/500\//.test(c.logo) ? c.logo.replace('/500/', '/500-dark/') : c?.logo ?? null, url: zoneLink(dir.league, code, page) };
}

// ── the fans' pieces, the same in every sport
export function callsOption(club: CardClub, pulse: FanPulse | null, me: string | null, sport: FanSport, board: boolean, dir: FanDir): ShareOption | null {
  const mine = pulse?.mine ?? null;
  if (!pulse || !mine || !Object.keys(mine).length) return null;
  const defs = callsFor(sport, board);
  const rows = defs.filter((d) => mine[d.key]).map((d) => {
    const s = pulse.calls[d.key];
    const c = s?.choices.find((x) => x.choice === mine[d.key]);
    return { title: d.title, mine: callLabel(d.key, mine[d.key], c?.name, sport, board, dir), agree: s?.total ? (c?.n ?? 0) / s.total : null };
  });
  if (!rows.length) return null;
  const who = me ?? 'My';
  return { key: 'calls', label: 'My calls', hint: 'Your calls for the season, with how many fans agree with each.', make: () => fanCardJob(
    { kind: 'calls', club: { ...club, url: zoneLink(club.league, club.code, 'pulse') }, eyebrow: 'Fan zone · my calls', who: who.endsWith('s') ? `${who}’` : who, rows },
    `My ${club.name} calls for the season${rows[0] ? `: ${rows[0].title.toLowerCase()}, ${rows[0].mine}` : ''}. Make yours.`, `${club.name} fan calls`) };
}
export function pulseOption(club: CardClub, pulse: FanPulse | null, sport: FanSport, board: boolean, dir: FanDir): ShareOption | null {
  if (!pulse) return null;
  const defs = callsFor(sport, board);
  const rows = defs.map((d) => ({ d, s: shares(pulse.calls[d.key]) })).filter((x) => x.s.length).sort((a, b) => (pulse.calls[b.d.key]?.total ?? 0) - (pulse.calls[a.d.key]?.total ?? 0)).slice(0, 5)
    .map(({ d, s }) => ({ title: d.title, top: callLabel(d.key, s[0].choice, s[0].name, sport, board, dir), pct: s[0].pct, n: pulse.calls[d.key].total }));
  const season = `${String(pulse.season).slice(0, 4)}-${String(pulse.season).slice(6, 8)}`;
  return { key: 'pulse', label: 'The fan pulse', hint: 'What the fans are calling this season, loudest first.', make: () => fanCardJob(
    { kind: 'pulse', club: { ...club, url: zoneLink(club.league, club.code, 'pulse') }, eyebrow: 'Fan pulse', people: pulse.people, season, rows },
    pulse.people ? `What ${pulse.people} ${club.name} fan${pulse.people === 1 ? '' : 's'} think${rows[0] ? `: ${pctWord(rows[0].pct)} ${rows[0].title.toLowerCase()}: ${rows[0].top}` : ''}.` : `The ${club.name} fan pulse: be the first to have your say.`, `${club.name} fan pulse`) };
}

// ── the NHL's
export function nhlOptions(code: string, a: Assessment | null, out: Outlook | null, hist: FanHistory | null, record: string, pulse: FanPulse | null, me: string | null, dir: FanDir): ShareOption[] {
  const name = NHL_TEAMS[code] ?? code;
  const base = nhlCardClub(code);
  const opts: ShareOption[] = [{ key: 'link', label: 'The zone', make: () => ({ url: base.url, title: `${name} fan zone`, text: `The ${name}, read like a front office: the playoff chances, the numbers, the crease, the moves and what the fans think.` }) }];
  if (a) {
    const club = nhlCardClub(code, 'analysis');
    const card: FanCard = { kind: 'verdict', club, eyebrow: 'Fan zone · the verdict', grade: a.grade, summary: a.summary, record,
      strengths: a.strengths.slice(0, 4).map((r) => ({ label: r.label, rank: rankWord(r.rank) })), weaknesses: a.weaknesses.slice(0, 4).map((r) => ({ label: r.label, rank: rankWord(r.rank) })), luck: a.luck?.read ?? null };
    opts.push({ key: 'verdict', label: 'The verdict', hint: 'The grade, the read and where they rank.', make: () => fanCardJob(card, `${name}: grade ${a.grade}. ${a.summary}`, `${name}: the verdict`) });
  }
  if (out) {
    const club = nhlCardClub(code, 'outlook');
    const card: FanCard = { kind: 'outlook', club, eyebrow: 'Fan zone · the outlook', headline: { label: 'Playoff chances', pct: out.playoffs },
      tiles: [{ k: 'Win the division', v: pctWord(out.division) }, { k: 'Stanley Cup', v: pctWord(out.rounds.cup), tone: 'club' }, { k: 'Top of the conference', v: pctWord(out.conference) }, { k: 'First-round opponent', v: out.firstRound[0] ? out.firstRound[0].abbrev : '–', sub: out.firstRound[0] ? `${pctWord(out.firstRound[0].chance)} of seasons` : undefined }],
      projected: { label: 'points, most likely', mid: String(out.projected.mid), range: `${out.projected.low} to ${out.projected.high} in eight seasons of ten` }, record,
      line: out.need != null && out.needPace != null ? (out.need > 0 ? `The playoff line sits near ${out.line}: ${out.need} more points from ${out.left} games, a ${out.needPace.toFixed(3).replace(/^0/, '')} pace.` : 'Already past the usual playoff line.') : null };
    opts.push({ key: 'outlook', label: 'The outlook', hint: 'The chances, the projected finish and what it takes.', make: () => fanCardJob(card, `${name}: ${pctWord(out.playoffs)} to make the playoffs, ${pctWord(out.rounds.cup)} for the Cup, projected ${out.projected.mid} points.`, `${name}: the outlook`) });
  }
  if (hist?.seasons.length) {
    const club = nhlCardClub(code, 'history');
    const lore = CLUB_LORE[code];
    const cups = hist.seasons.filter((s) => s.po?.won && s.po.round >= 4).map((s) => String(s.season).slice(4));
    const years = lore?.cups?.length ? lore.cups : cups.map(Number);
    const tr = hist.totals.regular, po = hist.totals.playoffs;
    const card: FanCard = { kind: 'history', club, eyebrow: 'Fan zone · the history', titles: { label: years.length === 1 ? 'Stanley Cup' : 'Stanley Cups', years, count: years.length },
      tiles: [tr ? { k: 'All-time wins', v: tr.w.toLocaleString(), sub: `${tr.l.toLocaleString()} losses` } : null, tr?.ptsPct != null ? { k: 'Points %', v: tr.ptsPct.toFixed(3).replace(/^0/, '') } : null,
        { k: 'Playoff springs', v: String(tr?.playoffSeasons ?? hist.seasons.filter((s) => s.po).length), sub: `of ${hist.seasons.length} seasons` }, po?.seriesW != null ? { k: 'Series record', v: `${po.seriesW}-${po.seriesL}` } : null].filter((x): x is NonNullable<typeof x> => !!x),
      lines: historyFacts(hist).slice(0, 4) };
    opts.push({ key: 'history', label: 'The history', hint: 'The Cups, the all-time numbers and the records.', make: () => fanCardJob(card, `${name} history: ${years.length} Stanley Cup${years.length === 1 ? '' : 's'}${tr ? `, ${tr.w.toLocaleString()} all-time wins` : ''}.`, `${name}: the history`) });
  }
  const calls = callsOption(base, pulse, me, 'hockey', false, dir);
  if (calls) opts.push(calls);
  const pl = pulseOption(base, pulse, 'hockey', false, dir);
  if (pl) opts.push(pl);
  return opts;
}

// ── the other leagues'
export function sportOptions(dir: FanDir, code: string, a: SportRead | null, ch: Chances | null, hist: SportHistory | null, record: string, pulse: FanPulse | null, me: string | null): ShareOption[] {
  const sport = dir.sport as Sport;
  const base = sportCardClub(dir, code);
  const name = base.name;
  const soccer = sport === 'soccer';
  const opts: ShareOption[] = [{ key: 'link', label: 'The zone', make: () => ({ url: base.url, title: `${name} fan zone`, text: `The ${name}, read like a front office: the chances, the numbers, the players, the moves and what the fans think.` }) }];
  if (a) {
    const club = sportCardClub(dir, code, 'analysis');
    const card: FanCard = { kind: 'verdict', club, eyebrow: 'Fan zone · the verdict', grade: a.grade, summary: a.summary, record,
      strengths: a.strengths.slice(0, 4).map((r) => ({ label: r.label, rank: rankWord(r.rank) })), weaknesses: a.weaknesses.slice(0, 4).map((r) => ({ label: r.label, rank: rankWord(r.rank) })), luck: a.luck?.read ?? null };
    opts.push({ key: 'verdict', label: 'The verdict', hint: 'The grade, the read and where they rank.', make: () => fanCardJob(card, `${name}: grade ${a.grade}. ${a.summary}`, `${name}: the verdict`) });
  }
  if (ch) {
    const club = sportCardClub(dir, code, 'outlook');
    const opp = Object.entries(ch.opponents)[0];
    const oppName = opp ? (opp[0] === 'bye' ? 'A bye' : dir.byCode[opp[0]]?.short ?? opp[0]) : null;
    const card: FanCard = { kind: 'outlook', club, eyebrow: 'Fan zone · the outlook',
      headline: soccer ? { label: 'Top-four chances', pct: ch.top4 } : { label: 'Playoff chances', pct: ch.playoffs },
      tiles: soccer ? [{ k: 'Champions', v: pctWord(ch.title), tone: 'club' }, { k: 'A European place', v: pctWord(ch.top7) }, { k: 'Relegated', v: pctWord(ch.relegated), tone: ch.relegated >= 0.25 ? 'bad' : undefined }, { k: 'Most likely place', v: rankWord(ch.positions.indexOf(Math.max(...ch.positions)) + 1) }]
        : [{ k: sport === 'football' ? 'Win the division' : 'Top six', v: pctWord(sport === 'football' ? ch.division : ch.top6) }, { k: sport === 'football' ? 'Super Bowl' : 'The title', v: pctWord(ch.title), tone: 'club' }, { k: sport === 'football' ? 'Reach the Super Bowl' : 'Reach the Finals', v: pctWord(ch.finals) }, { k: 'First-round opponent', v: oppName ?? '–', sub: opp ? `${pctWord(opp[1])} of seasons` : undefined }],
      projected: { label: soccer ? 'points, most likely' : 'wins, most likely', mid: String(ch.projected.mid), range: `${ch.projected.low} to ${ch.projected.high} in eight seasons of ten` }, record, line: null };
    opts.push({ key: 'outlook', label: 'The outlook', hint: 'The chances and the projected finish.', make: () => fanCardJob(card, soccer ? `${name}: ${pctWord(ch.title)} for the title, ${pctWord(ch.top4)} top four, projected ${ch.projected.mid} points.` : `${name}: ${pctWord(ch.playoffs)} to make the playoffs, ${pctWord(ch.title)} to win it all, projected ${ch.projected.mid} wins.`, `${name}: the outlook`) });
  }
  if (hist && (hist.clubs[code]?.length || titlesOf(hist, dir.league, code).count)) {
    const club = sportCardClub(dir, code, 'history');
    const t = titlesOf(hist, dir.league, code);
    const tot = totals(sport, hist.clubs[code] ?? []);
    const S = (y: number) => seasonLabel(dir.league, sport, y);
    const card: FanCard = { kind: 'history', club, eyebrow: 'Fan zone · the history', titles: { label: t.count === 1 ? t.one : t.what, years: t.years.map((y) => S(y.year)), count: t.count },
      tiles: tot ? [{ k: `Since ${S(hist.from)}`, v: soccer ? `${tot.w}-${tot.d}-${tot.l}` : `${tot.w}-${tot.l}${tot.d ? `-${tot.d}` : ''}`, sub: `${(tot.pct * 100).toFixed(1)}%` }, { k: soccer ? 'Top-four finishes' : 'Playoff seasons', v: String(tot.playoffs), sub: `of ${tot.seasons}` },
        { k: sport === 'football' ? 'Super Bowls' : sport === 'basketball' ? 'Finals' : 'Top-two finishes', v: String(tot.finals) }, { k: 'Best season', v: tot.best ? S(tot.best.year) : '–', sub: tot.best ? (soccer ? `${tot.best.w}-${tot.best.d}-${tot.best.l}` : `${tot.best.w}-${tot.best.l}${tot.best.d ? `-${tot.best.d}` : ''}`) : undefined }] : [],
      lines: sportFacts(hist, dir.league, code, name).slice(0, 4) };
    opts.push({ key: 'history', label: 'The history', hint: 'The titles and the seasons since the tables began.', make: () => fanCardJob(card, `${name} history: ${t.count} ${t.count === 1 ? t.one : t.what}${tot ? `, ${tot.w} wins since ${S(hist.from)}` : ''}.`, `${name}: the history`) });
  }
  const calls = callsOption(base, pulse, me, sport, false, dir);
  if (calls) opts.push(calls);
  const pl = pulseOption(base, pulse, sport, false, dir);
  if (pl) opts.push(pl);
  return opts;
}
