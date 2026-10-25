// The fan zone's history (24 October 2026, Patrick: "improve the fan zone's history and facts"): the franchise's story
// from the lore (src/data/clubHistory.ts) woven with its record books (nhl-hub's `fan-history`): eras, every season and
// how each spring ended, the timeline, the nights to remember, the Trade, rivals with their series, the record against
// every club, the people (captains, coaches, managers, the Hall of Fame, the rafters), the leaders and best seasons, the
// trophy case, the draft, and the facts and a quiz. A club without lore still gets every record-book section.
import { useMemo, useState } from 'react';
import { ArrowLeftRight, Trophy } from 'lucide-react';
import { NhlLogo } from '../ui';
import { usePlayerInfo } from '../../lib/playerInfo';
import { eras, historyFacts, inProgress, pickVerdict, rivals, seasonName, springOf, trophyCase, type FanHistory, type HistGoalie, type HistSeason, type HistSkater } from '../../lib/fanDeep';
import type { ClubLore } from '../../data/clubHistory';
import { Chips, Head, ShareBar, pctStr, recordOf } from './kit';

const PO_COLOR = (s: HistSeason) => (!s.po ? 'rgb(100 116 139 / .45)' : s.po.won && s.po.round >= 4 ? 'rgb(252 211 77)' : s.po.round >= 4 ? 'rgb(var(--club-rgb))' : s.po.round === 3 ? 'rgb(var(--club-rgb) / .75)' : s.po.round === 2 ? 'rgb(var(--club-rgb) / .5)' : 'rgb(var(--club-rgb) / .3)');

export function FanHistorySection({ h, lore, share }: { h: FanHistory | null; lore: ClubLore | undefined; share?: { url: string; title: string; text: string } }) {
  const [allTimeline, setAllTimeline] = useState(false);
  const [pickSeason, setPickSeason] = useState<number | null>(null);
  const [vsSort, setVsSort] = useState<'gp' | 'pct' | 'name'>('gp');
  const [vsAll, setVsAll] = useState(false);
  const [people, setPeople] = useState<'captains' | 'coaches' | 'gms'>('captains');
  const eraList = useMemo(() => (h ? eras(h) : []), [h]);
  const rv = useMemo(() => (h ? rivals(h) : []), [h]);
  if (!h && !lore) return null;
  const S = h?.seasons ?? [];
  const sel = S.find((s) => s.season === pickSeason) ?? S[S.length - 1] ?? null;
  const tr = h?.totals.regular, po = h?.totals.playoffs;
  const finals = S.filter((s) => s.po && s.po.round >= 4).length;
  const timeline = lore ? (allTimeline ? lore.timeline : lore.timeline.filter((t) => t.big)) : [];
  const vs = (h?.vs ?? []).slice().sort((a, b) => vsSort === 'name' ? a.name.localeCompare(b.name) : vsSort === 'pct' ? (b.w + b.t / 2 + b.otl / 2) / b.gp - (a.w + a.t / 2 + a.otl / 2) / a.gp : b.gp - a.gp);
  return (
    <section className="space-y-3">
      <Head id="history" title="History" sub={lore ? `Founded ${lore.founded}. Home: ${lore.arena}.` : `In the NHL since ${h?.first ? seasonName(h.first) : 'the start'}.`} share={share} />

      {/* the trophy shelf and the franchise in totals */}
      <div className="card overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, rgb(var(--club-rgb) / .16), transparent 60%)' }}>
        {lore && lore.cups.length > 0 && <>
          <div className="label" style={{ color: 'var(--club)' }}>Stanley Cups</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {lore.cups.map((y) => <span key={y} className="flex items-center gap-1.5 rounded-2xl bg-black/30 px-3 py-2 ring-1 ring-white/10"><Trophy className="h-5 w-5 text-amber-300" /><b className="num font-display text-lg text-white">{y}</b></span>)}
          </div>
        </>}
        {tr && (
          <div className="mt-3 grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
            {[
              ['All-time wins', tr.w.toLocaleString(), `${tr.l.toLocaleString()} losses${tr.t ? ` · ${tr.t} ties` : ''}${tr.otl ? ` · ${tr.otl} OT` : ''}`],
              ['Points %', tr.ptsPct != null ? pctStr(tr.ptsPct) : '–', `${tr.pts.toLocaleString()} points`],
              ['Playoff springs', String(tr.playoffSeasons ?? S.filter((s) => s.po).length), `of ${S.filter((s) => !inProgress(s, S)).length} seasons`],
              ['Series won', po?.seriesW != null ? `${po.seriesW}-${po.seriesL}` : '–', `${finals} Finals`],
            ].map(([k, v, sub]) => (
              <div key={k} className="min-w-0 rounded-2xl bg-black/25 px-2.5 py-2 ring-1 ring-white/10">
                <div className="text-[11px] text-mute">{k}</div>
                <div className="num font-display text-lg font-extrabold text-white">{v}</div>
                <div className="text-[10px] text-mute">{sub}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* every season, as a bar of its points percentage coloured by how the spring ended */}
      {S.length > 0 && (
        <div className="card p-4">
          <div className="flex items-baseline justify-between gap-2"><b className="text-white">Every season</b><span className="text-[11px] text-mute">tap a bar</span></div>
          <div className="mt-3 flex h-28 items-end gap-[2px]" role="img" aria-label={`${S.length} seasons by points percentage`}>
            {S.map((s) => {
              const p = s.pts / (2 * s.gp);
              return (
                <button key={s.season} type="button" onClick={() => setPickSeason(s.season)} aria-label={`${seasonName(s.season)}: ${s.pts} points, ${springOf(s, S)}`}
                  className="relative flex h-full min-w-0 flex-1 items-end">
                  <span className="w-full rounded-t-[3px]" style={{ height: `${Math.max(6, (Math.min(0.8, p) - 0.2) / 0.6 * 100)}%`, background: inProgress(s, S) ? 'repeating-linear-gradient(135deg, rgb(var(--club-rgb) / .6) 0 3px, transparent 3px 6px)' : PO_COLOR(s), boxShadow: sel?.season === s.season ? '0 0 0 2px white' : undefined }} />
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-mute"><span>{seasonName(S[0].season)}</span><span>{seasonName(S[S.length - 1].season)}</span></div>
          {sel && (
            <div className="mt-2 rounded-2xl bg-white/[.04] px-3 py-2 text-sm ring-1 ring-white/[.06]">
              <div className="flex flex-wrap items-baseline gap-x-2"><b className="text-white">{seasonName(sel.season)}</b><span className="text-slate-300">{sel.w}-{sel.l}-{sel.t || sel.otl} · {sel.pts} pts · {sel.gf}-{sel.ga} goals</span></div>
              <div className="text-[12px] text-mute">{sel.divRank ? `${ordinalWord(sel.divRank)} in the ${sel.div}` : ''}{sel.leagueRank ? ` · ${ordinalWord(sel.leagueRank)} in the league` : ''} · <span className={sel.po?.won && sel.po.round >= 4 ? 'font-bold text-amber-300' : ''}>{springOf(sel, S)}</span></div>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-mute">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-300" />Cup</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'rgb(var(--club-rgb))' }} />Final</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'rgb(var(--club-rgb) / .5)' }} />Earlier rounds</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-500/50" />Missed</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'repeating-linear-gradient(135deg, rgb(var(--club-rgb) / .6) 0 2px, transparent 2px 4px)' }} />This season</span>
          </div>
        </div>
      )}

      {eraList.length > 0 && (
        <div className="scroll-x -mx-1 flex snap-x gap-2 px-1 pb-1">
          {eraList.map((e) => (
            <div key={e.name} className="card w-[15.5rem] shrink-0 snap-start p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--club)' }}>{e.from}-{String(e.to).slice(2)}</div>
              <b className="block text-white">{e.name}</b>
              <div className="mt-1.5 grid grid-cols-3 gap-1 text-center">
                <div><div className="num font-display text-base font-extrabold text-white">{pctStr(e.ptsPct)}</div><div className="text-[10px] text-mute">points %</div></div>
                <div><div className="num font-display text-base font-extrabold text-white">{e.playoffs}/{e.seasons}</div><div className="text-[10px] text-mute">springs</div></div>
                <div><div className="num font-display text-base font-extrabold text-white">{e.cups ? `${e.cups}🏆` : e.finals}</div><div className="text-[10px] text-mute">{e.cups ? 'Cups' : 'Finals'}</div></div>
              </div>
              <div className="mt-1.5 text-[11px] leading-snug text-mute">Best: {seasonName(e.best.season)}, {e.best.pts} pts. {springOf(e.best)}.</div>
            </div>
          ))}
        </div>
      )}

      {lore && (
        <div className="card p-4">
          <b className="text-white">The story</b>
          <ol className="relative mt-3 space-y-4 border-l border-white/10 pl-4">
            {timeline.map((t, i) => (
              <li key={i} className="relative">
                {allTimeline && t.era && (i === 0 || timeline[i - 1].era !== t.era) && <div className="-ml-4 mb-2 pl-4 text-[10px] font-bold uppercase tracking-[.16em] text-mute">{t.era}</div>}
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-[#0b1222]" style={{ background: t.big ? 'var(--club)' : 'rgb(148 163 184)', top: allTimeline && t.era && (i === 0 || timeline[i - 1].era !== t.era) ? 26 : 4 }} />
                <div className="flex items-baseline gap-2"><b className="num text-sm" style={{ color: 'var(--club)' }}>{t.year}</b><b className="text-white">{t.title}</b></div>
                <p className="mt-0.5 text-sm leading-snug text-slate-300">{t.text}</p>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => setAllTimeline(!allTimeline)} className="mt-3 text-sm font-semibold text-sky-300">{allTimeline ? 'Just the big moments' : `The whole story (${lore.timeline.length} moments)`}</button>
        </div>
      )}

      {lore?.trade && (
        <div className="card overflow-hidden p-4" style={{ background: 'linear-gradient(160deg, rgb(var(--club-rgb) / .12), transparent 60%)' }}>
          <div className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" style={{ color: 'var(--club)' }} /><b className="text-white">{lore.trade.title}</b><span className="ml-auto text-xs text-mute">{lore.trade.date}</span></div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-2xl bg-black/25 p-2.5 ring-1 ring-white/10"><div className="label">Edmonton gave</div>{lore.trade.gave.map((x) => <div key={x} className="font-semibold text-white">{x}</div>)}</div>
            <div className="rounded-2xl bg-black/25 p-2.5 ring-1 ring-white/10"><div className="label">Edmonton got</div>{lore.trade.got.map((x) => <div key={x} className="text-slate-200">{x}</div>)}</div>
          </div>
          <p className="mt-2 text-sm leading-snug text-slate-300">{lore.trade.text}</p>
        </div>
      )}

      {lore?.nights && lore.nights.length > 0 && <Nights nights={lore.nights} />}

      {/* rivals: the lore's story and series, with the record books' totals */}
      {(lore?.rivals?.length || rv.length > 0) && (
        <div className="card p-4">
          <b className="text-white">Rivals</b>
          <div className="mt-2 space-y-4">
            {(lore?.rivals ?? []).map((r) => {
              const won = r.series.filter((s) => s.won).length;
              const books = h?.vsPlayoffs.find((v) => v.opp === r.abbrev);
              const reg = h?.vs.find((v) => v.opp === r.abbrev);
              return (
                <div key={r.name}>
                  <div className="flex items-center gap-2"><NhlLogo abbr={r.abbrev} size={24} /><b className="min-w-0 flex-1 text-white">{r.name}</b><span className="num shrink-0 text-xs font-bold text-slate-300">{won}-{r.series.length - won} in series</span></div>
                  <p className="mt-0.5 text-sm leading-snug text-slate-300">{r.text}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.series.map((s) => <span key={`${s.year}${s.round}`} title={s.round} className={`num rounded-full px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${s.won ? 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/25' : 'bg-red-500/10 text-red-200 ring-red-400/25'}`}>{s.year} {s.score}</span>)}
                  </div>
                  {(books || reg) && <div className="mt-1 text-[11px] text-mute">{books ? `Playoff games ${books.w}-${books.l}, goals ${books.gf}-${books.ga}. ` : ''}{reg ? `Regular season ${recordOf(reg.w, reg.l, reg.t + reg.otl)} in ${reg.gp} games.` : ''}</div>}
                </div>
              );
            })}
            {!lore?.rivals?.length && rv.map((r) => (
              <div key={r.name} className="flex items-center gap-2 text-sm">
                <NhlLogo abbr={r.opp} size={22} /><span className="min-w-0 flex-1 text-slate-200">{r.name}</span>
                <span className="num text-xs text-mute">{r.gp} playoff games</span><span className="num w-12 text-right font-bold text-white">{r.w}-{r.l}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {vs.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[.06] px-3 py-2">
            <b className="min-w-0 flex-1 text-sm text-white">Against every club, all-time</b>
            <Chips label="Sort" items={[['gp', 'Most met'], ['pct', 'Best record'], ['name', 'A-Z']] as const} value={vsSort} onChange={setVsSort} />
          </div>
          <div className="divide-y divide-white/[.05]">
            {(vsAll ? vs : vs.slice(0, 10)).map((v) => {
              const p = (v.w + (v.t + v.otl) / 2) / v.gp;
              return (
                <div key={`${v.name}${v.opp}`} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <NhlLogo abbr={v.opp} size={20} />
                  <span className="min-w-0 flex-1 truncate text-slate-200">{v.name}</span>
                  <span className="num w-20 shrink-0 text-right text-[12px] text-slate-300">{v.w}-{v.l}-{v.t + v.otl}</span>
                  <span className="w-14 shrink-0"><ShareBar value={p} mark={0.5} tone={p >= 0.55 ? 'good' : p < 0.45 ? 'bad' : 'plain'} h="h-1.5" /></span>
                </div>
              );
            })}
          </div>
          {vs.length > 10 && <button type="button" onClick={() => setVsAll(!vsAll)} className="w-full border-t border-white/[.06] py-2 text-sm font-semibold text-sky-300">{vsAll ? 'The first ten' : `All ${vs.length} opponents`}</button>}
        </div>
      )}

      {/* the people */}
      {h && (h.captains.length > 0 || h.coaches.length > 0) && (
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-2"><b className="min-w-0 flex-1 text-white">The people</b>
            <Chips label="Who" items={[['captains', 'Captains'], ['coaches', 'Coaches'], ['gms', 'Managers']] as const} value={people} onChange={setPeople} />
          </div>
          <ul className="mt-2 divide-y divide-white/[.05]">
            {h[people].map((x, i) => { const [who, when] = x.split(/:\s(.+)/); return (
              <li key={i} className="flex items-baseline gap-2 py-1.5 text-sm"><b className={who.startsWith('(') ? 'text-mute' : 'text-white'}>{who}</b><span className="ml-auto text-right text-[12px] text-mute">{when}</span></li>
            ); })}
          </ul>
        </div>
      )}

      {lore && (
        <div className="card p-4">
          <b className="text-white">In the rafters</b>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {lore.retired.map((r) => (
              <div key={r.num} className="rounded-2xl p-2.5 text-center ring-1 ring-white/10" style={{ background: 'linear-gradient(180deg, var(--club2), rgb(0 0 0 / .3))' }}>
                <div className="num font-display text-3xl font-extrabold" style={{ color: 'var(--club)' }}>{r.num}</div>
                <div className="text-sm font-bold text-white">{r.name}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-slate-300">{r.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {lore?.hallOfFame && lore.hallOfFame.length > 0 && (
        <div className="card p-4">
          <b className="text-white">In the Hall of Fame</b>
          <div className="mt-2 divide-y divide-white/[.05]">
            {lore.hallOfFame.map((p) => (
              <div key={p.name} className="flex items-start gap-3 py-2">
                <span className="num w-11 shrink-0 rounded-lg bg-white/[.05] py-1 text-center text-xs font-bold text-slate-200">{p.year}</span>
                <div className="min-w-0"><div className="text-sm"><b className="text-white">{p.name}</b> <span className="text-[11px] text-mute">· {p.role}</span></div><div className="text-[12px] leading-snug text-slate-300">{p.note}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {lore?.arenas && (
        <div className="card p-4">
          <b className="text-white">Home ice</b>
          <div className="mt-2 space-y-2">
            {lore.arenas.map((a) => <div key={a.name} className="text-sm"><b className="text-white">{a.name}</b> <span className="num text-xs text-mute">{a.years}</span><div className="text-[12px] leading-snug text-slate-300">{a.note}</div></div>)}
          </div>
        </div>
      )}
      {!h && <p className="px-1 text-xs text-mute">The record books are loading…</p>}
    </section>
  );
}

const ordinalWord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

function Nights({ nights }: { nights: NonNullable<ClubLore['nights']> }) {
  const [all, setAll] = useState(false);
  const shown = all ? nights : nights.slice(-6);
  return (
    <div className="card p-4">
      <b className="text-white">Nights to remember</b>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((n) => (
          <div key={n.date} className="rounded-2xl bg-white/[.03] p-3 ring-1 ring-white/[.06]">
            <div className="text-[11px] font-semibold" style={{ color: 'var(--club)' }}>{n.date}</div>
            <b className="block text-white">{n.title}</b>
            <p className="mt-0.5 text-[13px] leading-snug text-slate-300">{n.text}</p>
          </div>
        ))}
      </div>
      {nights.length > 6 && <button type="button" onClick={() => setAll(!all)} className="mt-2 text-sm font-semibold text-sky-300">{all ? 'The latest six' : `All ${nights.length} nights`}</button>}
    </div>
  );
}

// ── the record books: leaders, best seasons, records that stand
type Board = 'points' | 'goals' | 'assists' | 'games' | 'poPoints' | 'poGoals' | 'wins' | 'shutouts' | 'poWins';
const BOARDS: [Board, string][] = [['points', 'Points'], ['goals', 'Goals'], ['assists', 'Assists'], ['games', 'Games'], ['poPoints', 'Playoff points'], ['poGoals', 'Playoff goals'], ['wins', 'Goalie wins'], ['shutouts', 'Shutouts'], ['poWins', 'Playoff wins']];
type Best = 'points' | 'goals' | 'assists' | 'wins' | 'svp';
const BESTS: [Best, string][] = [['points', 'Points'], ['goals', 'Goals'], ['assists', 'Assists'], ['wins', 'Goalie wins'], ['svp', 'Save %']];
const valueOf = (b: Board | Best, p: HistSkater | HistGoalie) => {
  const s = p as HistSkater, g = p as HistGoalie;
  return b === 'points' || b === 'poPoints' ? s.pts : b === 'goals' || b === 'poGoals' ? s.g : b === 'assists' ? s.a : b === 'games' ? s.gp : b === 'wins' || b === 'poWins' ? g.w : b === 'shutouts' ? g.so : g.svp != null ? pctStr(g.svp) : '–';
};
export function FanRecords({ h, lore }: { h: FanHistory | null; lore: ClubLore | undefined }) {
  const info = usePlayerInfo();
  const [board, setBoard] = useState<Board>('points');
  const [best, setBest] = useState<Best>('points');
  if (!h && !lore) return null;
  const rows = (h?.leaders[board] ?? []) as (HistSkater | HistGoalie)[];
  const bestRows = (h?.best[best] ?? []) as (HistSkater | HistGoalie)[];
  const row = (p: HistSkater | HistGoalie, i: number, b: Board | Best, season?: boolean) => (
    <button key={`${p.id}${p.season ?? ''}`} type="button" onClick={() => info?.(p.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-white/[.03]">
      <span className={`num w-5 shrink-0 text-right text-xs font-bold ${i < 3 ? '' : 'text-mute'}`} style={i < 3 ? { color: 'var(--club)' } : undefined}>{i + 1}</span>
      <span className="min-w-0 flex-1 truncate"><b className="text-white">{p.name}</b>{season && p.season ? <span className="text-mute"> · {seasonName(p.season)}</span> : null}</span>
      <span className="num shrink-0 text-[11px] text-mute">{p.gp} GP</span>
      <span className="num w-12 shrink-0 text-right font-bold text-white">{valueOf(b, p)}</span>
    </button>
  );
  return (
    <section className="space-y-3">
      <Head id="records" title="The record books" sub="The franchise's leaders, its best seasons, and the records that still stand. Tap a name for the player." />
      {h && (
        <div className="card overflow-hidden">
          <div className="border-b border-white/[.06] px-3 py-2"><b className="text-sm text-white">All-time leaders</b><div className="mt-2"><Chips label="Leaders" items={BOARDS} value={board} onChange={setBoard} /></div></div>
          <div className="divide-y divide-white/[.05]">{rows.map((p, i) => row(p, i, board))}</div>
        </div>
      )}
      {h && (
        <div className="card overflow-hidden">
          <div className="border-b border-white/[.06] px-3 py-2"><b className="text-sm text-white">The best single seasons</b><div className="mt-2"><Chips label="Best seasons" items={BESTS} value={best} onChange={setBest} /></div></div>
          <div className="divide-y divide-white/[.05]">{bestRows.map((p, i) => row(p, i, best, true))}</div>
          {best === 'svp' && <p className="border-t border-white/[.06] px-3 py-2 text-[11px] text-mute">Thirty games or more.</p>}
        </div>
      )}
      {lore && (
        <div className="card p-4">
          <b className="text-white">Records that still stand</b>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {lore.records.map((r) => (
              <div key={r.what} className="rounded-2xl bg-white/[.03] p-2.5 ring-1 ring-white/[.06]">
                <div className="flex items-start justify-between gap-1"><div className="num font-display text-2xl font-extrabold text-white">{r.value}</div>{r.nhl && <span className="mt-1 shrink-0 rounded-full bg-amber-400/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-amber-200 ring-1 ring-amber-300/30">NHL</span>}</div>
                <div className="text-[12px] leading-snug text-slate-300">{r.what}</div>
                <div className="mt-0.5 text-[11px] font-semibold" style={{ color: 'var(--club)' }}>{r.who}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── the trophy case
export function FanTrophies({ h }: { h: FanHistory | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const tc = useMemo(() => (h ? trophyCase(h) : []), [h]);
  if (!tc.length) return null;
  const nominations = h!.awards.filter((a) => a.status !== 'WINNER').length;
  return (
    <section className="space-y-3">
      <Head id="trophies" title="The trophy case" sub={`Every NHL award the franchise and its players have won, from the league's records${nominations ? `, plus ${nominations} times as a finalist or runner-up` : ''}.`} />
      <div className="card divide-y divide-white/[.05] p-1">
        {tc.map((t) => {
          const isOpen = open === t.trophy;
          const names = [...new Set(t.wins.map((w) => w.name))];
          return (
            <button key={t.trophy} type="button" onClick={() => setOpen(isOpen ? null : t.trophy)} aria-expanded={isOpen} className="block w-full px-3 py-2.5 text-left">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 shrink-0 text-amber-300" />
                <span className="min-w-0 flex-1 text-sm font-semibold text-white">{t.trophy}</span>
                <span className="num shrink-0 font-display text-lg font-extrabold" style={{ color: 'var(--club)' }}>{t.wins.length}</span>
              </div>
              <div className="mt-0.5 pl-6 text-[12px] leading-snug text-slate-300">{isOpen ? null : names.slice(0, 3).join(', ')}{!isOpen && names.length > 3 ? ` and ${names.length - 3} more` : ''}</div>
              {isOpen && (
                <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                  {t.wins.sort((a, b) => a.season - b.season).map((w) => <span key={`${w.season}${w.name}`} className="rounded-full bg-white/[.05] px-2 py-0.5 text-[11px] text-slate-200 ring-1 ring-white/10"><b className="num">{String(w.season).slice(4)}</b> {w.name}</span>)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── the draft
export function FanDraft({ h }: { h: FanHistory | null }) {
  const info = usePlayerInfo();
  const [all, setAll] = useState(false);
  if (!h || !h.firsts.length) return null;
  const year = new Date().getFullYear();
  const verdicts = h.firsts.map((p) => ({ p, v: pickVerdict(p, year) }));
  const count = (v: string) => verdicts.filter((x) => x.v === v).length;
  const shown = all ? verdicts : verdicts.slice(0, 15);
  const tone = { star: 'bg-amber-400/15 text-amber-200 ring-amber-300/30', regular: 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/25', some: 'bg-white/[.05] text-slate-300 ring-white/10', bust: 'bg-red-500/10 text-red-200 ring-red-400/25', pending: 'bg-sky-500/10 text-sky-200 ring-sky-400/25' } as const;
  const word = { star: 'Star', regular: 'Regular', some: 'Some games', bust: 'Miss', pending: 'Too soon' } as const;
  return (
    <section className="space-y-3">
      <Head id="draft" title="The draft" sub={`Every first-round pick since ${h.firsts[h.firsts.length - 1].year}, and what each career became, wherever it was played.`} />
      <div className="grid grid-cols-4 gap-2">
        {(['star', 'regular', 'some', 'bust'] as const).map((v) => (
          <div key={v} className={`rounded-2xl px-2 py-2 text-center ring-1 ${tone[v]}`}><div className="num font-display text-xl font-extrabold">{count(v)}</div><div className="text-[10px] font-semibold">{word[v]}</div></div>
        ))}
      </div>
      <div className="card divide-y divide-white/[.05] overflow-hidden">
        {shown.map(({ p, v }) => (
          <button key={`${p.year}${p.overall}`} type="button" onClick={() => p.id && info?.(p.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[.03]">
            <span className="num w-10 shrink-0 text-xs font-bold text-slate-300">{p.year}</span>
            <span className="num w-8 shrink-0 rounded-md bg-white/[.06] py-0.5 text-center text-[11px] font-bold text-white">#{p.overall}</span>
            <span className="min-w-0 flex-1"><b className="block truncate text-white">{p.name}</b><span className="block truncate text-[11px] text-mute">{p.pos} · {p.from}{p.league ? ` (${p.league})` : ''}</span></span>
            <span className="shrink-0 text-right"><span className={`rounded-full px-1.5 py-px text-[10px] font-bold ring-1 ${tone[v]}`}>{word[v]}</span>
              <span className="num mt-0.5 block text-[10px] text-mute">{p.career ? (p.career.goalie ? `${p.career.gp} GP · ${p.career.w} W` : `${p.career.gp} GP · ${p.career.pts} P`) : 'no NHL games'}</span></span>
          </button>
        ))}
      </div>
      {verdicts.length > 15 && <button type="button" onClick={() => setAll(!all)} className="px-1 text-sm font-semibold text-sky-300">{all ? 'The latest fifteen' : `All ${verdicts.length} first-rounders`}</button>}
      {h.steals.length > 0 && (
        <div className="card p-4">
          <b className="text-white">The steals</b>
          <p className="text-xs text-mute">The best careers the franchise found after the first round.</p>
          <div className="mt-2 divide-y divide-white/[.05]">
            {h.steals.slice(0, 8).map((p) => (
              <button key={`${p.year}${p.overall}`} type="button" onClick={() => p.id && info?.(p.id)} className="flex w-full items-center gap-2 py-1.5 text-left text-sm">
                <span className="num w-10 shrink-0 text-xs text-slate-300">{p.year}</span>
                <span className="min-w-0 flex-1 truncate"><b className="text-white">{p.name}</b> <span className="text-[11px] text-mute">round {p.round}, #{p.overall}</span></span>
                <span className="num shrink-0 text-xs font-semibold text-white">{p.career?.goalie ? `${p.career.w} W` : `${p.career?.pts} P`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── facts, culture and a quiz
export function FanFacts({ h, lore }: { h: FanHistory | null; lore: ClubLore | undefined }) {
  const computed = useMemo(() => (h ? historyFacts(h) : []), [h]);
  const [all, setAll] = useState(false);
  const facts = [...computed, ...(lore?.facts ?? [])];
  if (!facts.length && !lore?.quiz) return null;
  const shown = all ? facts : facts.slice(0, 12);
  return (
    <section className="space-y-3">
      <Head id="facts" title="Did you know" sub={computed.length ? 'The first ones are counted from the record books, so they stay true as the seasons go on.' : undefined} />
      {facts.length > 0 && (
        <div className="card p-4">
          <ul className="space-y-2">
            {shown.map((f) => <li key={f} className="flex gap-2 text-sm leading-snug text-slate-300"><span className="shrink-0" style={{ color: 'var(--club)' }}>●</span>{f}</li>)}
          </ul>
          {facts.length > 12 && <button type="button" onClick={() => setAll(!all)} className="mt-3 text-sm font-semibold text-sky-300">{all ? 'Fewer' : `All ${facts.length} facts`}</button>}
        </div>
      )}
      {lore?.culture && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {lore.culture.map((c) => <div key={c.title} className="card p-3"><b className="text-white">{c.title}</b><p className="mt-0.5 text-[13px] leading-snug text-slate-300">{c.text}</p></div>)}
        </div>
      )}
      {lore?.quiz && lore.quiz.length > 0 && <Quiz quiz={lore.quiz} />}
    </section>
  );
}

function Quiz({ quiz }: { quiz: NonNullable<ClubLore['quiz']> }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const done = i >= quiz.length;
  const q = quiz[i];
  const choose = (k: number) => { if (picked != null) return; setPicked(k); if (k === q.answer) setScore((s) => s + 1); };
  const next = () => { setPicked(null); setI(i + 1); };
  return (
    <div className="card overflow-hidden p-4" style={{ background: 'linear-gradient(160deg, rgb(var(--club-rgb) / .14), transparent 60%)' }}>
      <div className="flex items-center gap-2"><b className="min-w-0 flex-1 text-white">How super a fan are you?</b><span className="num text-xs text-mute">{done ? `${score}/${quiz.length}` : `${i + 1} of ${quiz.length} · ${score} right`}</span></div>
      <div className="mt-2"><ShareBar value={Math.min(i, quiz.length) / quiz.length} h="h-1.5" /></div>
      {done ? (
        <div className="py-4 text-center">
          <div className="num font-display text-4xl font-extrabold" style={{ color: 'var(--club)' }}>{score}/{quiz.length}</div>
          <div className="mt-1 text-sm text-slate-200">{score === quiz.length ? 'Perfect. You could run the press box.' : score >= quiz.length * 0.75 ? 'A true believer.' : score >= quiz.length / 2 ? 'Solid. Some homework on the 80s.' : 'Bandwagon detected. Read the history and try again.'}</div>
          <button type="button" onClick={() => { setI(0); setScore(0); setPicked(null); }} className="mt-3 rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: 'rgb(var(--club-rgb))' }}>Play again</button>
        </div>
      ) : (
        <>
          <p className="mt-3 font-semibold text-white">{q.q}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {q.options.map((o, k) => {
              const state = picked == null ? 'idle' : k === q.answer ? 'right' : k === picked ? 'wrong' : 'idle';
              return (
                <button key={o} type="button" onClick={() => choose(k)} disabled={picked != null}
                  className={`min-h-[44px] rounded-2xl px-3 py-2 text-left text-sm font-semibold ring-1 transition ${state === 'right' ? 'bg-emerald-500/20 text-emerald-100 ring-emerald-400/40' : state === 'wrong' ? 'bg-red-500/20 text-red-100 ring-red-400/40' : 'bg-white/[.05] text-slate-100 ring-white/10 hover:bg-white/[.09]'}`}>{o}</button>
              );
            })}
          </div>
          {picked != null && (
            <div className="mt-2 flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm leading-snug text-slate-300"><b className={picked === q.answer ? 'text-emerald-300' : 'text-red-300'}>{picked === q.answer ? 'Right. ' : 'Not quite. '}</b>{q.why}</p>
              <button type="button" onClick={next} className="shrink-0 rounded-full px-3 py-1.5 text-sm font-bold text-white" style={{ background: 'rgb(var(--club-rgb))' }}>{i + 1 < quiz.length ? 'Next' : 'Score'}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
