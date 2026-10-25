// The other leagues' history (25 October 2026): the trophy shelf (every title, the settled ones and the data's), the
// franchise in totals since ESPN's tables begin, every season as a bar coloured by how the spring went, the eras, the
// last springs, the facts a fan quotes, and the league's champions in order. The numbers are src/lib/fanSportHistory.ts;
// the data nhl-hub's fan-sport-history.
import { useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import type { Sport } from '../../lib/fanSport';
import { champions, eras, facts, foundedOf, inFinal, madeIt, mostTitles, pct, recordOf, seasonLabel, springOf, titlesOf, totals, won, type HistRow, type SportHistory } from '../../lib/fanSportHistory';
import { rankWord } from '../../lib/fanZone';
import type { FanDir } from '../../lib/fanVoice';
import { ClubMark, Head, ShowMore, pctStr } from './kit';

const barColor = (sport: Sport, r: HistRow) => (won(sport, r) ? 'rgb(252 211 77)' : inFinal(sport, r) ? 'rgb(var(--club-rgb))' : madeIt(sport, r) ? 'rgb(var(--club-rgb) / .55)' : /relegat/i.test(r.note ?? '') ? 'rgb(248 113 113 / .7)' : 'rgb(100 116 139 / .45)');

export function SportHistorySection({ h, league, club, name, dir, share }: { h: SportHistory | null; league: string; club: string; name: string; dir: FanDir; share?: React.ReactNode }) {
  const [pick, setPick] = useState<number | null>(null);
  const [allFacts, setAllFacts] = useState(false);
  const rows = h?.clubs[club] ?? [];
  const sport = (h?.sport ?? dir.sport) as Sport;
  const t = useMemo(() => titlesOf(h, league, club), [h, league, club]);
  const tot = useMemo(() => (h ? totals(sport, rows) : null), [h, sport, rows]);
  const eraList = useMemo(() => (h ? eras(sport, rows) : []), [h, sport, rows]);
  const factList = useMemo(() => (h ? facts(h, league, club, name) : []), [h, league, club, name]);
  const founded = foundedOf(league, club);
  const S = (y: number) => seasonLabel(league, sport, y);
  const sel = rows.find((r) => r.year === pick) ?? rows[rows.length - 1] ?? null;
  const springs = [...rows].reverse().slice(0, 8);
  return (
    <section className="space-y-3">
      <Head id="history" title="History" sub={founded ? `Founded ${founded}. ${h ? `Every season since ${S(h.from)} from ESPN's tables; the titles before that from the record.` : 'The seasons are loading…'}` : h ? `Every season since ${S(h.from)}, from ESPN's tables.` : undefined} right={share} />

      {/* the trophy shelf */}
      <div className="card overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, rgb(var(--club-rgb) / .16), transparent 60%)' }}>
        <div className="flex items-baseline gap-3">
          <div className="num font-display text-5xl font-extrabold leading-none" style={{ color: 'var(--club)' }}>{t.count}</div>
          <div className="min-w-0"><div className="font-display text-xl font-extrabold leading-tight text-white">{t.count === 1 ? t.one : t.what}</div><div className="text-[12px] text-mute">{t.count ? `The last in ${S(t.years[t.years.length - 1].year)}` : `Still waiting for the first`}</div></div>
        </div>
        {t.years.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {t.years.map((y) => <span key={`${y.year}${y.label ?? ''}`} title={y.label ?? t.one} className="flex items-center gap-1 rounded-xl bg-black/30 px-2.5 py-1.5 ring-1 ring-white/10"><Trophy className="h-3.5 w-3.5 text-amber-300" /><b className="num text-sm text-white">{S(y.year)}</b>{y.name && <span className="text-[10px] text-mute">as {y.name}</span>}</span>)}
          </div>
        )}
        {tot && (
          <div className="mt-3 grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
            {[
              [`Since ${S(h!.from)}`, sport === 'soccer' ? `${tot.w}-${tot.d}-${tot.l}` : `${tot.w}-${tot.l}${tot.d ? `-${tot.d}` : ''}`, `${(tot.pct * 100).toFixed(1)}% of the ${sport === 'soccer' ? 'matches' : 'games'}`],
              [sport === 'soccer' ? 'Top-four finishes' : 'Playoff seasons', String(tot.playoffs), `of ${tot.seasons} seasons`],
              [sport === 'football' ? 'Super Bowls' : sport === 'basketball' ? 'Finals' : 'Top-two finishes', String(tot.finals), tot.titles ? `${tot.titles} won` : 'none won'],
              ['Best season', tot.best ? S(tot.best.year) : '–', tot.best ? recordOf(sport, tot.best) : ''],
            ].map(([k, v, sub]) => (
              <div key={k} className="min-w-0 rounded-2xl bg-black/25 px-2.5 py-2 ring-1 ring-white/10">
                <div className="text-[11px] text-mute">{k}</div>
                <div className="num font-display text-lg font-extrabold text-white">{v}</div>
                <div className="truncate text-[10px] text-mute">{sub}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* every season as a bar */}
      {rows.length > 0 && (
        <div className="card p-4">
          <div className="flex items-baseline justify-between gap-2"><b className="text-white">Every season</b><span className="text-[11px] text-mute">tap a bar</span></div>
          <div className="mt-3 flex h-28 items-end gap-[3px]" role="img" aria-label={`${rows.length} seasons by ${sport === 'soccer' ? 'points' : 'win share'}`}>
            {rows.map((r) => {
              const v = sport === 'soccer' ? (r.pts ?? 0) / Math.max(1, 3 * (r.w + r.l + r.d)) : pct(r);
              return (
                <button key={r.year} type="button" onClick={() => setPick(r.year)} aria-label={`${S(r.year)}: ${recordOf(sport, r)}, ${springOf(sport, r)}`} className="relative flex h-full min-w-0 flex-1 items-end">
                  <span className="w-full rounded-t-[3px]" style={{ height: `${Math.max(6, (Math.min(0.9, v) - 0.1) / 0.8 * 100)}%`, background: barColor(sport, r), boxShadow: sel?.year === r.year ? '0 0 0 2px white' : undefined }} />
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-mute"><span>{S(rows[0].year)}</span><span>{S(rows[rows.length - 1].year)}</span></div>
          {sel && (
            <div className="mt-2 rounded-2xl bg-white/[.04] px-3 py-2 text-sm ring-1 ring-white/[.06]">
              <div className="flex flex-wrap items-baseline gap-x-2"><b className="text-white">{S(sel.year)}</b><span className="text-slate-300">{recordOf(sport, sel)}{sel.pts != null ? ` · ${sel.pts} pts` : ''} · {sel.pf}-{sel.pa} {sport === 'soccer' ? 'goals' : 'points'}</span>{sel.name && sel.name !== name && <span className="text-[11px] text-mute">as the {sel.name}</span>}</div>
              <div className="text-[12px] text-mute">{sel.div ? `${rankWord(sel.divRank ?? 0)} in the ${sel.div}` : sel.rank ? `${rankWord(sel.rank)} in the table` : ''}{sel.seed ? ` · ${rankWord(sel.seed)} seed` : ''} · <span className={won(sport, sel) ? 'font-bold text-amber-300' : ''}>{springOf(sport, sel)}</span>{sel.po ? ` (${sel.po.w}-${sel.po.l})` : ''}</div>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-mute">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-300" />{sport === 'soccer' ? 'Champions' : 'Won it all'}</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'rgb(var(--club-rgb))' }} />{sport === 'soccer' ? 'Top two' : 'The final'}</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'rgb(var(--club-rgb) / .55)' }} />{sport === 'soccer' ? 'Top four' : 'Playoffs'}</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-500/50" />{sport === 'soccer' ? 'The rest' : 'Missed'}</span>
            {sport === 'soccer' && <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-400/70" />Relegated</span>}
          </div>
        </div>
      )}

      {eraList.length > 0 && (
        <div className="scroll-x -mx-1 flex snap-x gap-2 px-1 pb-1">
          {eraList.map((e) => (
            <div key={e.name} className="card w-[15.5rem] shrink-0 snap-start p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--club)' }}>{S(e.from)} to {S(e.to)}</div>
              <b className="block text-white">{e.name}</b>
              <div className="mt-1.5 grid grid-cols-3 gap-1 text-center">
                <div><div className="num font-display text-base font-extrabold text-white">{pctStr(e.pct)}</div><div className="text-[10px] text-mute">{sport === 'soccer' ? 'won' : 'win %'}</div></div>
                <div><div className="num font-display text-base font-extrabold text-white">{e.playoffs}/{e.seasons}</div><div className="text-[10px] text-mute">{sport === 'soccer' ? 'top four' : 'springs'}</div></div>
                <div><div className="num font-display text-base font-extrabold text-white">{e.titles ? `${e.titles}🏆` : e.finals}</div><div className="text-[10px] text-mute">{e.titles ? 'titles' : sport === 'soccer' ? 'top two' : 'finals'}</div></div>
              </div>
              <div className="mt-1.5 text-[11px] leading-snug text-mute">Best: {S(e.best.year)}, {recordOf(sport, e.best)}. {springOf(sport, e.best)}.</div>
            </div>
          ))}
        </div>
      )}

      {springs.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center gap-1.5 font-bold text-white"><Trophy className="h-4 w-4" style={{ color: 'var(--club)' }} />{sport === 'soccer' ? 'The last seasons' : 'The last springs'}</div>
          <div className="mt-2 divide-y divide-white/[.05]">
            {springs.map((r) => (
              <div key={r.year} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="num w-16 shrink-0 text-xs font-semibold text-slate-300">{S(r.year)}</span>
                <span className="num w-16 shrink-0 text-[12px] text-slate-400">{recordOf(sport, r)}</span>
                <span className={`min-w-0 flex-1 truncate ${won(sport, r) ? 'font-bold text-amber-300' : madeIt(sport, r) ? 'text-white' : 'text-mute'}`}>{springOf(sport, r)}</span>
                {r.po && <span className="num shrink-0 text-[11px] text-mute">{r.po.w}-{r.po.l}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {factList.length > 0 && (
        <div className="card p-4">
          <b className="text-white">Did you know</b>
          <ul className="mt-2 space-y-2">
            {(allFacts ? factList : factList.slice(0, 7)).map((f) => <li key={f} className="flex gap-2 text-sm leading-snug text-slate-300"><span className="shrink-0" style={{ color: 'var(--club)' }}>●</span>{f}</li>)}
          </ul>
          <ShowMore open={allFacts} total={factList.length} shown={7} onClick={() => setAllFacts(!allFacts)} what="facts" />
        </div>
      )}

      <Champions h={h} league={league} dir={dir} highlight={club} />
      {!h && <p className="px-1 text-xs text-mute">The seasons are loading…</p>}
    </section>
  );
}

// the league's champions, newest first, with who has the most
export function Champions({ h, league, dir, highlight }: { h: SportHistory | null; league: string; dir: FanDir; highlight?: string }) {
  const [all, setAll] = useState(false);
  const sport = (h?.sport ?? dir.sport) as Sport;
  const nameOf = (code: string | null, name?: string) => name ?? (code ? dir.byCode[code]?.name ?? code : 'Unknown');
  const list = useMemo(() => champions(h, league, nameOf), [h, league, dir]);   // eslint-disable-line react-hooks/exhaustive-deps
  const most = useMemo(() => mostTitles(h, league).slice(0, 6), [h, league]);
  if (!list.length) return null;
  const what = sport === 'football' ? 'Super Bowl champions' : sport === 'basketball' ? 'NBA champions' : 'English champions';
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[.06] px-3 py-2"><b className="min-w-0 flex-1 text-sm text-white">{what}</b><span className="text-[11px] text-mute">{list.length} seasons</span></div>
      {most.length > 0 && (
        <div className="scroll-x flex gap-1.5 border-b border-white/[.06] px-3 py-2">
          {most.map(([code, n]) => <span key={code} className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ${code === highlight ? 'bg-white/[.1] text-white ring-white/20' : 'bg-white/[.04] text-slate-300 ring-white/10'}`}><ClubMark league={league} code={code} logo={dir.byCode[code]?.logo} size={14} />{dir.byCode[code]?.short ?? code} <b className="num">{n}</b></span>)}
        </div>
      )}
      <div className="divide-y divide-white/[.05]">
        {(all ? list : list.slice(0, 10)).map((c) => (
          <div key={`${c.year}${c.label ?? ''}`} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${c.club === highlight ? 'bg-white/[.05]' : ''}`}>
            <span className="num w-16 shrink-0 text-xs text-slate-300">{seasonLabel(league, sport, c.year)}</span>
            {c.club ? <ClubMark league={league} code={c.club} logo={dir.byCode[c.club]?.logo} size={20} /> : <span className="h-5 w-5 shrink-0 rounded-full bg-white/10" />}
            <span className={`min-w-0 flex-1 truncate ${c.club === highlight ? 'font-bold text-white' : 'text-slate-200'}`}>{c.name}</span>
            {c.label && <span className="shrink-0 text-[10px] text-mute">{c.label}</span>}
          </div>
        ))}
      </div>
      {list.length > 10 && <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-white/[.06] py-2 text-sm font-semibold text-sky-300">{all ? 'The latest ten' : `All ${list.length}`}</button>}
    </div>
  );
}
