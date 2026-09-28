// Trade analysis and the trade finder, used by the Trades page builder.
import { useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import type { DraftPick, Player } from '../lib/types';
import { fmtPts } from '../lib/format';
import { evaluateSide, findTrades, gradeSide, makeValuer, posture, verdict, type Side, type SideEval, type Suggestion } from '../lib/trade';
import { gradeColor } from '../lib/grades';
import { lineFor, minSample, rosPoints, statValue, fmtStat, TIMEFRAMES, type Timeframe } from '../lib/playerstats';
import { useProjDetails, toneCls, toneIcon } from '../lib/projections';
import { Headshot, Pos, TeamBadge } from './ui';
import { Sparkles } from 'lucide-react';

export function useTradeValuer() {
  const { players, season, rosters, teams, league, draft, standings } = useLeague();
  const rostered = useMemo(() => new Set(rosters.map((r) => r.player_id)), [rosters]);
  const v = useMemo(() => makeValuer(players, season, rostered, Math.max(1, teams.length), draft?.season), [players, season, rostered, teams.length, draft?.season]);
  const caps = (league?.roster ?? {}) as Record<string, number>;
  const rosterMax = Object.entries(caps).filter(([k]) => k !== 'IR').reduce((t, [, n]) => t + n, 0) || 24;
  // how far along the season is (for buy / sell posture)
  const start = league?.season_start ? new Date(league.season_start).getTime() : 0;
  const end = start ? start + 197 * 86400000 : 0;
  const progress = league?.phase === 'season' && start ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) : 0;
  const rosterOf = (t: number) => rosters.filter((r) => r.team_id === t).map((r) => players.get(r.player_id)).filter((p): p is Player => !!p);
  return { v, rosterMax, rosterOf, inSeason: league?.phase === 'season', stance: standings.length ? null : null, standings, progress };
}

const d = (n: number) => { const r = Math.round(n); return `${r > 0 ? '+' : ''}${r}`; };
const tone = (n: number) => (n > 2 ? 'text-emerald-300' : n < -2 ? 'text-red-300' : 'text-slate-300');

export function SideCard({ e, name, mine }: { e: SideEval; name: string; mine?: boolean }) {
  const { team } = useLeague();
  return (
    <div className={`rounded-xl border p-2.5 text-sm ${mine ? 'border-sky-400/30 bg-sky-500/[.06]' : 'border-white/[.08] bg-white/[.03]'}`}>
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold"><TeamBadge team={team(e.team)} size={18} />{name}</div>
      <div className="grid grid-cols-3 gap-1 text-center">
        <div className="rounded-lg bg-black/25 p-1.5"><div className="text-[10px] text-mute">Starters</div><div className={`num font-bold ${tone(e.startersDelta)}`}>{d(e.startersDelta)}</div><div className="num text-[10px] text-mute">{fmtPts(e.startersBefore, 0)} → {fmtPts(e.startersAfter, 0)}</div></div>
        <div className="rounded-lg bg-black/25 p-1.5"><div className="text-[10px] text-mute">Depth</div><div className={`num font-bold ${tone(e.depthAfter - e.depthBefore)}`}>{d(e.depthAfter - e.depthBefore)}</div><div className="num text-[10px] text-mute">top-6 bench</div></div>
        <div className="rounded-lg bg-black/25 p-1.5"><div className="text-[10px] text-mute">Value in − out</div><div className={`num font-bold ${tone(e.net / 5)}`}>{d(e.net)}</div><div className="num text-[10px] text-mute">{fmtPts(e.valueIn, 0)} in · {fmtPts(e.valueOut, 0)} out</div></div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {e.pos.filter((p) => Math.abs(p.delta) >= 1).map((p) => <span key={p.pos} className={`flex items-center gap-1 rounded-full bg-white/[.05] px-1.5 py-0.5 text-[11px] ${tone(p.delta)}`}><Pos p={p.pos} className="min-w-0 px-1 py-0" />{d(p.delta)}</span>)}
        {e.pos.every((p) => Math.abs(p.delta) < 1) && <span className="text-[11px] text-mute">No starting spot changes hands.</span>}
      </div>
      {e.warnings.map((w) => <div key={w} className="mt-1 text-[11px] text-amber-200">⚠️ {w}</div>)}
    </div>
  );
}

// the live read on whatever is in the builder (or on an offer): grades, what each lineup gains or loses, and
// every player in the deal side by side
export function TradeAnalysis({ sides, compact }: { sides: Side[]; compact?: boolean }) {
  const { me, team } = useLeague();
  const { v, rosterMax } = useTradeValuer();
  const details = useProjDetails();
  const evals = sides.map((s) => evaluateSide(s, v, rosterMax));
  const changed = sides.some((s) => s.before.length !== s.after.length || s.picksIn.length || s.picksOut.length || s.after.some((p) => !s.before.includes(p)));
  if (!changed) return <div className="rounded-xl border border-dashed border-white/10 p-3 text-center text-xs text-mute">Tick players or picks and the analysis appears here: a grade for each side, what each lineup gains or loses, value both ways, and every player's numbers side by side.</div>;
  const name = (t: number) => (t === me?.id ? 'You' : team(t)?.gm_name ?? 'Them');
  const ageOf = (ps: Player[]) => { const a = ps.map((p) => details?.get(p.id)?.proj_meta?.age).filter((x): x is number => x != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
  const grades = sides.map((s, i) => {
    const out = s.before.filter((p) => !s.after.includes(p)), inn = s.after.filter((p) => !s.before.includes(p));
    return gradeSide(evals[i], { outAge: ageOf(out), inAge: ageOf(inn) });
  });
  const ve = verdict(evals, name);
  const cls = { good: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100', ok: 'border-white/10 bg-white/[.04] text-slate-200', warn: 'border-amber-400/30 bg-amber-500/10 text-amber-100', bad: 'border-red-400/30 bg-red-500/10 text-red-100' }[ve.tone];
  const moving = sides.flatMap((s) => s.after.filter((p) => !s.before.includes(p)).map((p) => ({ p, to: s.team, from: sides.find((o) => o.before.includes(p))?.team })));
  return (
    <div className="space-y-2">
      <div className={`rounded-xl border px-3 py-2 text-sm font-semibold ${cls}`}>{ve.text}</div>
      <div className={`grid gap-2 ${grades.length > 2 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {grades.map((g) => (
          <div key={g.team} className={`rounded-xl border p-2.5 ${g.team === me?.id ? 'border-sky-400/30 bg-sky-500/[.06]' : 'border-white/[.08] bg-white/[.03]'}`}>
            <div className="flex items-center gap-2">
              <TeamBadge team={team(g.team)} size={22} />
              <div className="min-w-0 flex-1 text-sm font-semibold">{name(g.team)}<div className="text-[10px] font-normal uppercase tracking-wider text-mute">Trade grade</div></div>
              <div className={`h-display text-4xl leading-none ${gradeColor(g.grade)}`}>{g.grade}</div>
            </div>
            <ul className="mt-1.5 space-y-0.5 text-[12px]">{g.notes.map((n) => <li key={n.text} className={toneCls[n.tone]}>{toneIcon[n.tone]} <span className="text-slate-200">{n.text}</span></li>)}</ul>
          </div>
        ))}
      </div>
      {!compact && <div className={`grid gap-2 ${evals.length > 2 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {evals.map((e) => <SideCard key={e.team} e={e} name={name(e.team)} mine={e.team === me?.id} />)}
      </div>}
      {moving.length > 0 && <TradeCompare moving={moving} />}
      <p className="px-1 text-[11px] text-mute">Grades weigh the rest-of-season lineup most, then value in and out, then depth, and dock deals that open a hole or take on an injury. Starters = each team's best possible lineup (2C 2LW 2RW 3D 1Util 2G) from SAK projections blended with this season's pace.</p>
    </div>
  );
}

// every player in the deal, every number: projection and range, rest of season, and any timeframe's stats
type CView = 'value' | 'skater' | 'goalie';
export function TradeCompare({ moving }: { moving: { p: Player; to: number; from?: number }[] }) {
  const { team, windows, season } = useLeague();
  const details = useProjDetails();
  const [tf, setTf] = useState<Timeframe>(windows.size ? 'season' : 'last');
  const [view, setView] = useState<CView>('value');
  const [perGame, setPerGame] = useState(false);
  const tfOk: Timeframe = !windows.size && TIMEFRAMES.find((x) => x.k === tf)?.live ? 'last' : tf;
  const hasG = moving.some((m) => m.p.pos === 'G'), hasS = moving.some((m) => m.p.pos !== 'G');
  const cols = view === 'value' ? ['proj', 'range', 'ros', 'fp', 'fpg'] : view === 'skater' ? ['gp', 'g', 'a', 'pts', 'pm', 'ppp', 'sog', 'hit', 'blk', 'pim', 'shpct'] : ['gp', 'w', 'l', 'svp', 'gaa', 'sho', 'sv'];
  const L: Record<string, string> = { proj: 'Proj', range: 'Bad–great year', ros: 'ROS', fp: 'FP', fpg: 'FP/G', gp: 'GP', g: 'G', a: 'A', pts: 'P', pm: '+/-', ppp: 'PPP', sog: 'SOG', hit: 'HIT', blk: 'BLK', pim: 'PIM', shpct: 'S%', w: 'W', l: 'L', svp: 'SV%', gaa: 'GAA', sho: 'SO', sv: 'SV' };
  const list = moving.filter((m) => view === 'value' || (view === 'goalie' ? m.p.pos === 'G' : m.p.pos !== 'G'));
  const cell = (p: Player, k: string) => {
    const line = lineFor(p, tfOk, windows.get(p.id), season.get(p.id));
    const m = details?.get(p.id)?.proj_meta;
    if (k === 'proj') return fmtPts(p.proj, 0);
    if (k === 'range') return m ? `${fmtPts(p.proj * m.lo, 0)}–${fmtPts(p.proj * m.hi, 0)}` : '–';
    if (k === 'ros') return fmtPts(rosPoints(p, season.get(p.id)), 0);
    if (k === 'fp') return line ? fmtPts(line.fp, 0) : '–';
    if (k === 'fpg') return line?.gp ? (line.fp / line.gp).toFixed(2) : '–';
    return fmtStat(statValue(line, k, perGame, minSample(tfOk)), k, perGame);
  };
  return (
    <div className="overflow-hidden rounded-xl border border-white/[.08]">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/[.06] bg-white/[.02] p-2">
        <span className="label mr-1">Players in the deal</span>
        {(['value', ...(hasS ? ['skater'] : []), ...(hasG ? ['goalie'] : [])] as CView[]).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${view === v ? 'bg-gold text-ice' : 'bg-white/[.05] text-mute'}`}>{v === 'value' ? 'Value' : v === 'skater' ? 'Skater stats' : 'Goalie stats'}</button>)}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {TIMEFRAMES.filter((x) => x.k !== 'proj' && x.k !== 'ros').map((x) => <button key={x.k} disabled={x.live && !windows.size} title={x.label} onClick={() => setTf(x.k)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-35 ${tfOk === x.k ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`}>{x.short}</button>)}
        {view !== 'value' && <button onClick={() => setPerGame(!perGame)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${perGame ? 'bg-emerald-500 text-ice' : 'bg-white/[.05] text-mute'}`}>Per game</button>}
      </div>
      <div className="scroll-x">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-mute"><tr><th className="px-2 py-1.5 text-left">Player</th><th className="px-2 text-left">To</th>{cols.map((k) => <th key={k} className="whitespace-nowrap px-2 text-right">{L[k]}</th>)}</tr></thead>
          <tbody className="divide-y divide-white/[.05]">
            {list.map(({ p, to }) => {
              const f = details?.get(p.id)?.proj_meta?.factors ?? [];
              return (
                <tr key={p.id} className="align-top">
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5"><Headshot p={p} size={24} /><div className="min-w-0"><div className="truncate font-semibold">{p.name}</div><div className="text-[10px] text-mute">{p.elig.join('/')} · {p.nhl_team}{p.injury_status && <span className="text-red-300"> · {p.injury_status}</span>}</div></div></div>
                    {view === 'value' && f.length > 0 && <ul className="mt-1 max-w-[260px] space-y-0.5 text-[10px] leading-snug">{f.slice(0, 3).map((x) => <li key={x.text} className={toneCls[x.tone]}>{toneIcon[x.tone]} <span className="text-slate-300">{x.text}</span></li>)}</ul>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5"><span className="flex items-center gap-1"><TeamBadge team={team(to)} size={16} />{team(to)?.abbrev}</span></td>
                  {cols.map((k) => <td key={k} className="num whitespace-nowrap px-2 py-1.5 text-right">{cell(p, k)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// deals the computer likes: better lineup for you, no worse for them
export function TradeFinder({ onBuild }: { onBuild: (partner: number, give: Player[], get: Player[]) => void }) {
  const { me, teams, team, players, standings } = useLeague();
  const { v, rosterMax, rosterOf, progress, inSeason } = useTradeValuer();
  const [partner, setPartner] = useState<number | 'any'>('any');
  const [winWin, setWinWin] = useState(true);
  const [res, setRes] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const stance = me && inSeason ? posture(me.id, standings, progress) : null;
  const run = () => {
    if (!me) return;
    setBusy(true);
    setTimeout(() => {
      const partners = teams.filter((t) => t.id !== me.id && (partner === 'any' || t.id === partner)).map((t) => ({ team: t.id, roster: rosterOf(t.id) }));
      setRes(findTrades(me.id, rosterOf(me.id), partners, v, rosterMax, { limit: partner === 'any' ? 12 : 10, winWin }));
      setBusy(false);
    }, 30);
  };
  const my = me ? rosterOf(me.id) : [];
  const weakest = useMemo(() => {
    if (!me) return null;
    const e = evaluateSide({ team: me.id, before: my, after: my, picksIn: [], picksOut: [] }, v, rosterMax);
    const all = teams.map((t) => evaluateSide({ team: t.id, before: rosterOf(t.id), after: rosterOf(t.id), picksIn: [], picksOut: [] }, v, rosterMax));
    return e.pos.map((p) => { const vals = all.map((a) => a.pos.find((x) => x.pos === p.pos)!.before); const rank = vals.filter((x) => x > p.before).length + 1; return { pos: p.pos, rank }; }).sort((a, b) => b.rank - a.rank);
  }, [me?.id, rosters_key(my), teams.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card space-y-2 p-3">
      <div>
        <div className="flex items-center gap-1.5 font-semibold"><Sparkles size={16} className="text-gold" /> Trade finder</div>
        <div className="text-xs text-mute">Searches 1-for-1, 2-for-1, 1-for-2 and 2-for-2 swaps. {winWin ? 'Win-win: both starting lineups have to get better and the value has to stay close, so the other GM has a reason to say yes. Fairest deals first.' : 'Any deal that makes your lineup better without making theirs much worse.'}{weakest && weakest[0] && <> Your weakest spot in the league: <b>{weakest[0].pos}</b> (#{weakest[0].rank} of {teams.length}).</>}</div>
        {stance && <div className={`mt-1 text-xs ${stance.mode === 'sell' ? 'text-amber-200' : 'text-emerald-200'}`}>📈 {stance.text}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm" value={partner} onChange={(e) => { setPartner(e.target.value === 'any' ? 'any' : Number(e.target.value)); setRes(null); }}>
          <option value="any">Any GM</option>
          {teams.filter((t) => t.id !== me?.id).map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.gm_name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-4 w-4 accent-emerald-400" checked={winWin} onChange={(e) => { setWinWin(e.target.checked); setRes(null); }} />Win-win only</label>
        <button className="btn-gold btn-sm" disabled={busy} onClick={run}>{busy ? 'Thinking…' : res ? 'Search again' : 'Find trades'}</button>
      </div>
      {res && res.length === 0 && <div className="rounded-xl bg-white/[.04] p-3 text-sm text-mute">Nothing that clears the bar{partner === 'any' ? '' : ` with ${team(partner as number)?.gm_name}`}{winWin ? ': no swap makes both lineups better at a fair price. Untick Win-win only to see deals that help you more than them.' : ': no swap of their top players makes your lineup at least 4 points better without hurting theirs. Try another GM, or build one by hand and read the analysis.'}</div>}
      {res && res.length > 0 && (
        <div className="divide-y divide-white/[.06] overflow-hidden rounded-xl border border-white/[.08]">
          {res.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-sm">
              <TeamBadge team={team(s.partner)} size={22} />
              <div className="min-w-0 flex-1">
                <div><span className="text-mute">You send</span> <b>{s.give.map((p) => p.name).join(' + ')}</b> <span className="text-mute">for</span> <b>{s.get.map((p) => p.name).join(' + ')}</b> <span className="text-mute">from {team(s.partner)?.gm_name}</span></div>
                <div className="text-[11px] text-mute">Your starters <span className={`num font-semibold ${tone(s.me.startersDelta)}`}>{d(s.me.startersDelta)}</span> · theirs <span className={`num font-semibold ${tone(s.them.startersDelta)}`}>{d(s.them.startersDelta)}</span> · value to them <span className="num">{d(s.them.net)}</span></div>
                <div className="text-[11px]">
                  {s.me.pos.filter((p) => p.delta >= 3).length > 0 && <span className="mr-2 text-emerald-200">You: stronger at {s.me.pos.filter((p) => p.delta >= 3).map((p) => p.pos).join(', ')}.</span>}
                  {s.them.startersDelta > 1 && <span className="text-sky-200">{team(s.partner)?.gm_name}: {s.them.pos.filter((p) => p.delta >= 3).length ? `stronger at ${s.them.pos.filter((p) => p.delta >= 3).map((p) => p.pos).join(', ')}` : 'a better lineup'}{s.give.length < s.get.length ? ', and a roster spot back' : ''}; what they give up {s.get.every((p) => !s.them.pos.some((x) => x.pos === p.pos && x.delta < -3)) ? 'was mostly sitting on their bench' : 'is covered by what they get'}.</span>}
                </div>
              </div>
              <button className="btn-ghost btn-sm shrink-0" onClick={() => onBuild(s.partner, s.give, s.get)}>Build this</button>
            </div>
          ))}
        </div>
      )}
      {!res && players.size === 0 && <div className="text-xs text-mute">Loading players…</div>}
    </div>
  );
}
const rosters_key = (ps: Player[]) => ps.map((p) => p.id).join(',');

export type { Side, DraftPick };
