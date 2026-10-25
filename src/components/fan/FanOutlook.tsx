// The fan zone's outlook (24 October 2026): the season simulated to its end (playoff, division and top-seed chances,
// the points it will take and the line it must clear), what the record should be, the season game by game, the
// division, last spring's champion beside this club, and the schedule still to come. The numbers are src/lib/fanDeep.ts.
import { useMemo, useState } from 'react';
import { NhlLogo } from '../ui';
import { fmtDate, NHL_TEAMS } from '../../lib/format';
import { rankWord, type FanData } from '../../lib/fanZone';
import type { Ahead, Form, Outlook, Truth, champion as championFn, division as divisionFn } from '../../lib/fanDeep';
import { Head, ShareBar, pctStr, recordOf } from './kit';

const pct0 = (v: number) => (v >= 0.995 ? '>99%' : v > 0 && v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`);

export function FanOutlook({ d, out, tr, champ, div, ah, share }: { d: FanData; out: Outlook | null; tr: Truth | null; champ: ReturnType<typeof championFn>; div: ReturnType<typeof divisionFn>; ah: Ahead | null; share?: { url: string; title: string; text: string } }) {
  const [allConf, setAllConf] = useState(false);
  if (!out) return null;
  const odds = allConf ? out.odds : out.odds.slice(0, 10);
  return (
    <section className="space-y-3">
      <Head id="outlook" title="The outlook" sub={`The rest of the season played ${out.sims.toLocaleString()} times for all 32 clubs, from each one's record pulled toward the league average while the sample is small.`} share={share} />
      <div className="card overflow-hidden p-4" style={{ background: 'linear-gradient(160deg, rgb(var(--club-rgb) / .14), transparent 55%)' }}>
        <div className="flex items-center gap-4">
          <Ring value={out.playoffs} />
          <div className="min-w-0 flex-1">
            <div className="label">Playoff chances</div>
            <div className="font-display text-[clamp(28px,9vw,40px)] font-extrabold leading-none text-white">{pct0(out.playoffs)}</div>
            <div className="mt-1 text-sm text-slate-300">Projected <b className="text-white">{out.projected.mid}</b> points <span className="text-mute">({out.projected.low} to {out.projected.high})</span></div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
          {[['Top 3 in division', out.top3], ['Win the division', out.division], ['First in the conference', out.conference], ['Presidents’ Trophy', out.presidents]].map(([k, v]) => (
            <div key={k as string} className="rounded-2xl bg-black/25 px-2.5 py-2 ring-1 ring-white/10">
              <div className="text-[11px] leading-tight text-mute">{k}</div>
              <div className="num font-display text-xl font-extrabold text-white">{pct0(v as number)}</div>
            </div>
          ))}
        </div>
        {/* the projected finish against the line */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs text-mute"><span>Where they finish</span><span>The playoff line, about <b className="text-slate-200">{out.line}</b></span></div>
          <ProjectionBar out={out} />
          <p className="mt-2 text-sm leading-snug text-slate-300">
            On their pace so far they would finish with <b className="text-white">{Math.round(out.pace)}</b> points.{' '}
            {out.need != null && out.needPace != null && (out.need > 0
              ? <>They need about <b className="text-white">{out.need}</b> more from the last {out.left} games: a {pctStr(out.needPace)} points pace.</>
              : <>They are already past the usual line.</>)}
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[.06] px-3 py-2"><b className="text-sm text-white">The conference race</b><span className="text-[11px] text-mute">playoffs · points · Cup</span></div>
        <div className="divide-y divide-white/[.05]">
          {odds.map((t) => (
            <div key={t.abbrev} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${t.abbrev === d.abbrev ? 'bg-white/[.04]' : ''}`}>
              <NhlLogo abbr={t.abbrev} size={20} />
              <span className={`w-11 shrink-0 font-semibold ${t.abbrev === d.abbrev ? 'text-white' : 'text-slate-200'}`}>{t.abbrev}</span>
              <span className="num w-9 shrink-0 text-right text-[11px] text-mute">{t.pts}p</span>
              <span className="min-w-0 flex-1"><ShareBar value={t.playoffs} tone={t.abbrev === d.abbrev ? 'club' : 'plain'} /></span>
              <span className="num w-11 shrink-0 text-right font-bold text-white">{pct0(t.playoffs)}</span>
              <span className="num w-8 shrink-0 text-right text-[11px] text-mute">{t.projected}</span>
              <span className="num w-10 shrink-0 text-right text-[11px] text-amber-200">{pct0(t.cup)}</span>
            </div>
          ))}
        </div>
        {out.odds.length > 10 && <button type="button" onClick={() => setAllConf(!allConf)} className="w-full border-t border-white/[.06] py-2 text-sm font-semibold text-sky-300">{allConf ? 'The top ten' : `All ${out.odds.length} clubs`}</button>}
      </div>

      {/* 25 October 2026: where they land, who they would meet, and the spring round by round */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="card p-4">
          <b className="text-white">Where they land</b>
          <p className="text-[11px] text-mute">The share of seasons ending in each place.</p>
          <div className="mt-2 space-y-1.5">
            {out.seeds.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-sm">
                <span className={`w-36 shrink-0 truncate ${s.label === 'Out' ? 'text-mute' : 'text-slate-200'}`}>{s.label}</span>
                <span className="min-w-0 flex-1"><ShareBar value={s.chance} tone={s.label === 'Out' ? 'bad' : 'club'} h="h-1.5" /></span>
                <span className="num w-11 shrink-0 text-right font-semibold text-white">{pct0(s.chance)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <b className="text-white">The first round</b>
          <p className="text-[11px] text-mute">The most likely opponents, as a share of every season.</p>
          {out.firstRound.length ? (
            <div className="mt-2 space-y-1.5">
              {out.firstRound.map((o) => (
                <div key={o.abbrev} className="flex items-center gap-2 text-sm">
                  <NhlLogo abbr={o.abbrev} size={20} />
                  <span className="min-w-0 flex-1 truncate text-slate-200">{o.name}</span>
                  <span className="w-16 shrink-0"><ShareBar value={o.chance / Math.max(0.01, out.playoffs)} h="h-1.5" tone="plain" /></span>
                  <span className="num w-11 shrink-0 text-right font-semibold text-white">{pct0(o.chance)}</span>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-mute">Of the seasons they make it, {pct0(out.firstRound[0].chance / Math.max(0.01, out.playoffs))} start against the {out.firstRound[0].name}.</p>
            </div>
          ) : <p className="mt-2 text-sm text-mute">No playoff series in the seasons simulated.</p>}
        </div>
      </div>
      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-2"><b className="text-white">The spring, round by round</b><span className="text-[11px] text-mute">each series by the log5 rule, four wins first</span></div>
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {([['Make it', out.playoffs], ['Win round 1', out.rounds.r1], ['Win round 2', out.rounds.r2], ['Reach the Final', out.rounds.conf], ['Win the Cup', out.rounds.cup]] as const).map(([k, v], i) => (
            <div key={k} className="min-w-0 rounded-2xl bg-black/25 px-1.5 py-2 text-center ring-1 ring-white/10">
              <div className="num font-display text-[clamp(14px,4.2vw,22px)] font-extrabold leading-tight" style={{ color: i === 4 ? 'var(--club)' : 'white' }}>{pct0(v)}</div>
              <div className="mt-0.5 text-[10px] leading-tight text-mute">{k}</div>
              <div className="mt-1.5 h-1 rounded-full bg-white/[.06]"><div className="h-1 rounded-full" style={{ width: `${Math.max(2, v * 100)}%`, background: i === 4 ? 'rgb(252 211 77)' : 'rgb(var(--club-rgb))' }} /></div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-snug text-slate-300">
          {out.rounds.cup >= 0.1 ? `A real contender: the Cup comes home in about one season in ${Math.max(2, Math.round(1 / out.rounds.cup))}.` : out.rounds.cup >= 0.03 ? `A live outsider: one season in ${Math.round(1 / out.rounds.cup)} ends with the Cup.` : out.playoffs >= 0.5 ? 'A playoff team more than a champion as things stand: the spring would need a run.' : 'The Cup is a long way off this season.'}
          {' '}The favourite in the conference: {(() => { const f = [...out.odds].sort((a, b) => b.cup - a.cup)[0]; return f ? `the ${f.name} (${pct0(f.cup)})` : '–'; })()}.
        </p>
      </div>

      {tr && (
        <div className="card p-4">
          <b className="text-white">What the record should be</b>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Mini k="Wins" v={String(tr.wins)} />
            <Mini k="Goals say" v={tr.pythagWins.toFixed(1)} />
            <Mini k="Difference" v={`${tr.luckWins >= 0 ? '+' : '−'}${Math.abs(tr.luckWins).toFixed(1)}`} tone={Math.abs(tr.luckWins) < 1 ? undefined : tr.luckWins > 0 ? 'hot' : 'cold'} />
          </div>
          {tr.adj && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <Mini k="5-on-5 goals, real" v={`${tr.adj.actualGd >= 0 ? '+' : ''}${tr.adj.actualGd}`} />
              <Mini k="With average luck" v={`${tr.adj.adjGd >= 0 ? '+' : ''}${tr.adj.adjGd.toFixed(1)}`} tone={tr.adj.adjGd < tr.adj.actualGd - 2 ? 'hot' : tr.adj.adjGd > tr.adj.actualGd + 2 ? 'cold' : undefined} />
            </div>
          )}
          <p className="mt-2 text-sm leading-snug text-slate-300">{tr.read}</p>
        </div>
      )}

      {champ && champ.lines.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center gap-2"><NhlLogo abbr={champ.abbrev} size={26} /><b className="min-w-0 flex-1 text-white">Measured against the champion</b><span className="num shrink-0 text-sm font-bold" style={{ color: 'var(--club)' }}>{champ.matched}/{champ.lines.length}</span></div>
          <p className="mt-0.5 text-xs text-mute">{champ.abbrev === d.abbrev ? 'This season against their own Cup-winning season.' : `This season against the ${d.table?.find((t) => t.abbrev === champ.abbrev)?.name ?? NHL_TEAMS[champ.abbrev] ?? champ.abbrev}, last season's Stanley Cup champions.`} A tick where they match or beat it.</p>
          <div className="mt-2 divide-y divide-white/[.05]">
            {champ.lines.map((l) => (
              <div key={l.label} className="flex items-center gap-2 py-1.5 text-sm">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black ${l.better ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/[.06] text-mute'}`}>{l.better ? '✓' : '·'}</span>
                <span className="min-w-0 flex-1 text-slate-200">{l.label}</span>
                <span className="num w-14 text-right font-semibold text-white">{l.fmt(l.us)}</span>
                <span className="num w-14 text-right text-mute">{l.fmt(l.them)}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-end gap-2 text-[10px] uppercase tracking-wider text-mute"><span className="w-14 text-right">{d.abbrev}</span><span className="w-14 text-right">{champ.abbrev} ’{String(d.prevSeason).slice(6, 8)}</span></div>
        </div>
      )}

      {div.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-white/[.06] px-3 py-2 text-sm font-bold text-white">The {div[0].divName} at a glance</div>
          <div className="scroll-x">
            <table className="w-full min-w-[340px] text-sm">
              <thead><tr className="text-[10px] uppercase tracking-wider text-mute"><th className="px-3 py-1.5 text-left font-semibold">Club</th><th className="px-1 text-right font-semibold">GP</th><th className="px-1 text-right font-semibold">Pts</th><th className="px-1 text-right font-semibold">P%</th><th className="px-1 text-right font-semibold">GD</th><th className="px-1 text-right font-semibold">PP</th><th className="px-1 text-right font-semibold">PK</th><th className="px-3 text-right font-semibold">L10</th></tr></thead>
              <tbody className="divide-y divide-white/[.05]">
                {div.map((t, i) => (
                  <tr key={t.abbrev} className={t.abbrev === d.abbrev ? 'bg-white/[.04]' : ''}>
                    <td className="px-3 py-1.5"><span className="flex items-center gap-1.5"><span className="num w-3 text-[11px] text-mute">{i + 1}</span><NhlLogo abbr={t.abbrev} size={18} /><b className={t.abbrev === d.abbrev ? 'text-white' : 'text-slate-200'}>{t.abbrev}</b></span></td>
                    <td className="num px-1 text-right text-slate-300">{t.gp}</td>
                    <td className="num px-1 text-right font-bold text-white">{t.pts}</td>
                    <td className="num px-1 text-right text-slate-300">{pctStr(t.ptsPct)}</td>
                    <td className={`num px-1 text-right ${t.gd > 0 ? 'text-emerald-300' : t.gd < 0 ? 'text-red-300' : 'text-slate-300'}`}>{t.gd > 0 ? '+' : ''}{t.gd}</td>
                    <td className="num px-1 text-right text-slate-300">{t.team ? `${(t.team.pp * 100).toFixed(0)}` : '–'}</td>
                    <td className="num px-1 text-right text-slate-300">{t.team ? `${(t.team.pk * 100).toFixed(0)}` : '–'}</td>
                    <td className="num px-3 text-right text-slate-300">{t.l10}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ah && (
        <div className="card p-4">
          <b className="text-white">The road ahead</b>
          <div className="mt-2 grid grid-cols-2 gap-2 min-[400px]:grid-cols-4">
            <Mini k="Games left" v={String(ah.left)} sub={`${ah.home} home · ${ah.road} road`} />
            <Mini k="Opponents’ points %" v={ah.oppPct != null ? pctStr(ah.oppPct) : '–'} sub={`league ${pctStr(ah.leaguePct)}`} tone={ah.oppPct != null && ah.oppPct > ah.leaguePct + 0.02 ? 'cold' : ah.oppPct != null && ah.oppPct < ah.leaguePct - 0.02 ? 'hot' : undefined} />
            <Mini k="Back-to-backs" v={String(ah.b2b)} sub="second nights left" />
            <Mini k="vs today’s top 16" v={String(ah.playoffOpp)} sub="games" />
          </div>
          <p className="mt-2 text-sm leading-snug text-slate-300">
            {ah.next10Pct != null && <>The next ten opponents take {pctStr(ah.next10Pct)} of their points, {ah.next10Pct > ah.leaguePct + 0.02 ? 'a harder stretch than average' : ah.next10Pct < ah.leaguePct - 0.02 ? 'a softer stretch than average' : 'about an average stretch'}. </>}
            {ah.trip && <>The longest road trip left is {ah.trip.games} games, {fmtDate(ah.trip.from)} to {fmtDate(ah.trip.to)}. </>}
            {ah.hardest && <>The strongest club still on the schedule: the {NHL_TEAMS[ah.hardest] ?? ah.hardest}.</>}
          </p>
        </div>
      )}
    </section>
  );
}

function Mini({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: 'hot' | 'cold' }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white/[.03] px-2 py-2 ring-1 ring-white/[.06]">
      <div className="text-[11px] leading-tight text-mute">{k}</div>
      <div className={`num font-display text-lg font-extrabold ${tone === 'hot' ? 'text-amber-200' : tone === 'cold' ? 'text-sky-200' : 'text-white'}`}>{v}</div>
      {sub && <div className="text-[10px] leading-tight text-mute">{sub}</div>}
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0" aria-hidden>
      <circle cx="44" cy="44" r={r} fill="none" stroke="rgb(255 255 255 / .08)" strokeWidth="9" />
      <circle cx="44" cy="44" r={r} fill="none" stroke="rgb(var(--club-rgb))" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 44 44)" />
    </svg>
  );
}

// the range of finishes (10th to 90th percentile), the middle, and the line
function ProjectionBar({ out }: { out: Outlook }) {
  const lo = Math.min(out.projected.low, out.line) - 6, hi = Math.max(out.projected.high, out.line) + 6;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="relative mt-2 h-9">
      <div className="absolute inset-x-0 top-3 h-3 rounded-full bg-white/[.06]" />
      <div className="absolute top-3 h-3 rounded-full" style={{ left: x(out.projected.low), width: `calc(${x(out.projected.high)} - ${x(out.projected.low)})`, background: 'rgb(var(--club-rgb) / .45)' }} />
      <div className="absolute top-1.5 h-6 w-1 -translate-x-1/2 rounded" style={{ left: x(out.projected.mid), background: 'rgb(var(--club-rgb))' }} />
      <div className="absolute top-0 h-9 w-0.5 -translate-x-1/2 bg-white/70" style={{ left: x(out.line) }} />
      <span className="num absolute top-6 -translate-x-1/2 text-[10px] text-mute" style={{ left: x(out.projected.low) }}>{out.projected.low}</span>
      <span className="num absolute top-6 -translate-x-1/2 text-[10px] text-mute" style={{ left: x(out.projected.high) }}>{out.projected.high}</span>
    </div>
  );
}

// ── the season so far, game by game: the points against the pace a playoff club needs, and each night's margin
export function FanForm({ d, fm, out }: { d: FanData; fm: Form; out: Outlook | null }) {
  const [pick, setPick] = useState<number | null>(null);
  const g = fm.games;
  const view = useMemo(() => {
    const W = 320, H = 150, P = { l: 26, r: 8, t: 8, b: 18 };
    const n = Math.max(g.length, 10);
    const maxPts = Math.max(4, g[g.length - 1]?.total ?? 0, out ? Math.round((out.line / 82) * n) : 0) + 2;
    const sx = (i: number) => P.l + (i / n) * (W - P.l - P.r), sy = (v: number) => H - P.b - (v / maxPts) * (H - P.t - P.b);
    return { W, H, P, n, maxPts, sx, sy };
  }, [g, out]);
  if (g.length < 3) return null;
  const { W, H, P, n, maxPts, sx, sy } = view;
  const path = g.map((x, i) => `${i ? 'L' : 'M'}${sx(i + 1).toFixed(1)},${sy(x.total).toFixed(1)}`).join(' ');
  const sel = pick != null ? g[pick] : g[g.length - 1];
  const maxM = Math.max(3, ...g.map((x) => Math.abs(x.us - x.them)));
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width * W - P.l) / ((W - P.l - P.r) / n)) - 1;
    setPick(Math.max(0, Math.min(g.length - 1, i)));
  };
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2"><b className="text-white">The season so far</b><span className="text-[11px] text-mute">tap the chart for a game</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full touch-none select-none" role="img" aria-label={`Points by game: ${g[g.length - 1].total} from ${g.length} games`} onPointerMove={onMove} onPointerDown={onMove}>
        {[0, Math.round(maxPts / 2), maxPts].map((v) => (
          <g key={v}><line x1={P.l} x2={W - P.r} y1={sy(v)} y2={sy(v)} stroke="rgb(255 255 255 / .06)" /><text x={P.l - 4} y={sy(v) + 3} textAnchor="end" fontSize="8" fill="rgb(148 163 184)">{v}</text></g>
        ))}
        {out && <line x1={sx(0)} y1={sy(0)} x2={sx(n)} y2={sy((out.line / 82) * n)} stroke="rgb(255 255 255 / .45)" strokeDasharray="3 3" />}
        {out && <text x={sx(n)} y={sy((out.line / 82) * n) - 4} textAnchor="end" fontSize="8" fill="rgb(203 213 225)">playoff pace</text>}
        <path d={path} fill="none" stroke="rgb(var(--club-rgb))" strokeWidth="2" strokeLinejoin="round" />
        {g.map((x, i) => <circle key={x.id} cx={sx(i + 1)} cy={sy(x.total)} r={sel === x ? 4 : 2.2} fill={x.won ? 'rgb(var(--club-rgb))' : x.ot ? 'rgb(251 191 36)' : 'rgb(148 163 184)'} stroke="#0b1222" strokeWidth={sel === x ? 2 : 0} />)}
        <text x={P.l} y={H - 4} fontSize="8" fill="rgb(148 163 184)">game 1</text>
        <text x={W - P.r} y={H - 4} textAnchor="end" fontSize="8" fill="rgb(148 163 184)">game {n}</text>
      </svg>
      {/* each night's margin */}
      <div className="mt-2 flex h-12 items-center gap-[2px]" aria-label="Goal margin each game">
        {g.map((x, i) => {
          const m = x.us - x.them, hgt = Math.max(2, (Math.abs(m) / maxM) * 22);
          const bar = <span className="w-full max-w-[10px] rounded-sm" style={{ height: hgt, background: m > 0 ? 'rgb(52 211 153 / .85)' : x.ot ? 'rgb(251 191 36 / .85)' : 'rgb(248 113 113 / .85)', boxShadow: sel === x ? '0 0 0 2px white' : undefined }} />;
          return (
            <button key={x.id} type="button" onClick={() => setPick(i)} aria-label={`Game ${x.n}: ${x.home ? 'vs' : 'at'} ${x.opp} ${x.us}-${x.them}`} className="flex h-full min-w-0 flex-1 flex-col">
              <span className="flex flex-1 items-end justify-center">{m > 0 && bar}</span>
              <span className="h-px w-full bg-white/10" />
              <span className="flex flex-1 items-start justify-center">{m <= 0 && bar}</span>
            </button>
          );
        })}
      </div>
      {sel && (
        <div className="mt-2 flex items-center gap-2 rounded-2xl bg-white/[.04] px-3 py-2 text-sm ring-1 ring-white/[.06]">
          <NhlLogo abbr={sel.opp} size={22} />
          <span className="min-w-0 flex-1 text-slate-200">Game {sel.n} · {fmtDate(sel.date)} · {sel.home ? 'vs' : 'at'} <b className="text-white">{sel.opp}</b></span>
          <span className={`num font-bold ${sel.won ? 'text-emerald-300' : sel.ot ? 'text-amber-200' : 'text-red-300'}`}>{sel.won ? 'W' : sel.ot ? 'OTL' : 'L'} {sel.us}-{sel.them}</span>
          <span className="num text-xs text-mute">{sel.total} pts</span>
        </div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-white/[.03] p-2 ring-1 ring-white/[.06]"><div className="text-[11px] text-mute">Longest win streak</div><div className="num font-display text-lg font-extrabold text-white">{fm.longestWin}</div></div>
        <div className="rounded-2xl bg-white/[.03] p-2 ring-1 ring-white/[.06]"><div className="text-[11px] text-mute">Longest point streak</div><div className="num font-display text-lg font-extrabold text-white">{fm.longestPoint}</div></div>
        <div className="rounded-2xl bg-white/[.03] p-2 ring-1 ring-white/[.06]"><div className="text-[11px] text-mute">Longest skid</div><div className="num font-display text-lg font-extrabold text-white">{fm.longestLoss}</div></div>
      </div>
      {(fm.best || fm.trend != null) && (
        <p className="mt-2 text-sm leading-snug text-slate-300">
          {fm.best && fm.best.of < g.length * 2 && <>Best stretch: {fm.best.pts} of {fm.best.of} points, {fmtDate(fm.best.from)} to {fmtDate(fm.best.to)}. </>}
          {fm.trend != null && Math.abs(fm.trend) >= 0.05 && <>The last ten games are {fm.trend > 0 ? 'better' : 'worse'} than what came before by {Math.round(Math.abs(fm.trend) * 100)} points of points percentage.</>}
          {d.standing?.streak && <> Current streak: {d.standing.streak}.</>}
        </p>
      )}
      <div className="mt-1 text-[10px] text-mute">Dots: <span style={{ color: 'var(--club)' }}>●</span> win · <span className="text-amber-300">●</span> overtime loss · <span className="text-slate-400">●</span> loss. Dashed: the pace of a club finishing on the playoff line. {recordOf(d.standing?.w ?? 0, d.standing?.l ?? 0, d.standing?.otl ?? 0)} · {rankWord(d.standing?.leagueRank ?? 0)} in the league.</div>
    </div>
  );
}
