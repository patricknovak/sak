// Trade analysis and the trade finder, used by the Trades page builder.
import { useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import type { DraftPick, Player } from '../lib/types';
import { fmtPts } from '../lib/format';
import { evaluateSide, findTrades, makeValuer, posture, verdict, type Side, type SideEval, type Suggestion } from '../lib/trade';
import { Pos, TeamBadge } from './ui';
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

// the live read on whatever is in the builder
export function TradeAnalysis({ sides }: { sides: Side[] }) {
  const { me, team } = useLeague();
  const { v, rosterMax } = useTradeValuer();
  const evals = sides.map((s) => evaluateSide(s, v, rosterMax));
  const changed = sides.some((s) => s.before.length !== s.after.length || s.picksIn.length || s.picksOut.length || s.after.some((p) => !s.before.includes(p)));
  if (!changed) return <div className="rounded-xl border border-dashed border-white/10 p-3 text-center text-xs text-mute">Tick players or picks and the analysis appears here: what each lineup gains or loses, value both ways, and the holes it would open.</div>;
  const name = (t: number) => (t === me?.id ? 'You' : team(t)?.gm_name ?? 'Them');
  const ve = verdict(evals, name);
  const cls = { good: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100', ok: 'border-white/10 bg-white/[.04] text-slate-200', warn: 'border-amber-400/30 bg-amber-500/10 text-amber-100', bad: 'border-red-400/30 bg-red-500/10 text-red-100' }[ve.tone];
  return (
    <div className="space-y-2">
      <div className={`rounded-xl border px-3 py-2 text-sm font-semibold ${cls}`}>{ve.text}</div>
      <div className={`grid gap-2 ${evals.length > 2 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {evals.map((e) => <SideCard key={e.team} e={e} name={name(e.team)} mine={e.team === me?.id} />)}
      </div>
      <p className="px-1 text-[11px] text-mute">Starters = projected rest-of-season points from each team’s best possible lineup (2C 2LW 2RW 3D 1Util 2G). Value counts players and picks; a pick is worth about what the player taken there projects to.</p>
    </div>
  );
}

// deals the computer likes: better lineup for you, no worse for them
export function TradeFinder({ onBuild }: { onBuild: (partner: number, give: Player[], get: Player[]) => void }) {
  const { me, teams, team, players, standings } = useLeague();
  const { v, rosterMax, rosterOf, progress, inSeason } = useTradeValuer();
  const [partner, setPartner] = useState<number | 'any'>('any');
  const [res, setRes] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const stance = me && inSeason ? posture(me.id, standings, progress) : null;
  const run = () => {
    if (!me) return;
    setBusy(true);
    setTimeout(() => {
      const partners = teams.filter((t) => t.id !== me.id && (partner === 'any' || t.id === partner)).map((t) => ({ team: t.id, roster: rosterOf(t.id) }));
      setRes(findTrades(me.id, rosterOf(me.id), partners, v, rosterMax, { limit: partner === 'any' ? 12 : 10 }));
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
        <div className="text-xs text-mute">Searches 1-for-1, 2-for-1 and 1-for-2 swaps that make your best lineup better without making theirs worse.{weakest && weakest[0] && <> Your weakest spot in the league: <b>{weakest[0].pos}</b> (#{weakest[0].rank} of {teams.length}).</>}</div>
        {stance && <div className={`mt-1 text-xs ${stance.mode === 'sell' ? 'text-amber-200' : 'text-emerald-200'}`}>📈 {stance.text}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm" value={partner} onChange={(e) => { setPartner(e.target.value === 'any' ? 'any' : Number(e.target.value)); setRes(null); }}>
          <option value="any">Any GM</option>
          {teams.filter((t) => t.id !== me?.id).map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.gm_name}</option>)}
        </select>
        <button className="btn-gold btn-sm" disabled={busy} onClick={run}>{busy ? 'Thinking…' : res ? 'Search again' : 'Find trades'}</button>
      </div>
      {res && res.length === 0 && <div className="rounded-xl bg-white/[.04] p-3 text-sm text-mute">Nothing that clears the bar{partner === 'any' ? '' : ` with ${team(partner as number)?.gm_name}`}: no swap of their top players makes your lineup at least 4 points better without hurting theirs. Try another GM, or build one by hand and read the analysis.</div>}
      {res && res.length > 0 && (
        <div className="divide-y divide-white/[.06] overflow-hidden rounded-xl border border-white/[.08]">
          {res.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-sm">
              <TeamBadge team={team(s.partner)} size={22} />
              <div className="min-w-0 flex-1">
                <div><span className="text-mute">You send</span> <b>{s.give.map((p) => p.name).join(' + ')}</b> <span className="text-mute">for</span> <b>{s.get.map((p) => p.name).join(' + ')}</b> <span className="text-mute">from {team(s.partner)?.gm_name}</span></div>
                <div className="text-[11px] text-mute">Your starters <span className={`num font-semibold ${tone(s.me.startersDelta)}`}>{d(s.me.startersDelta)}</span> · theirs <span className={`num font-semibold ${tone(s.them.startersDelta)}`}>{d(s.them.startersDelta)}</span> · value to them <span className="num">{d(s.them.net)}</span>{s.me.pos.filter((p) => p.delta >= 3).length > 0 && <> · you gain at {s.me.pos.filter((p) => p.delta >= 3).map((p) => p.pos).join(', ')}</>}</div>
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
