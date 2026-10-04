// The draft analysis: live numbers from the projection model and the season forecast (they move as rosters
// change), plus the written commentary from draft night.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { bare, useBrand } from '../lib/brand';
import { Link } from 'react-router-dom';
import { ChevronDown, LineChart } from 'lucide-react';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { etToday, fmtPts } from '../lib/format';
import { useNhlOdds, useProjDetails, useSeasonGames } from '../lib/projections';
import { analyzeDraft, type DraftAnalysis as DA, type PickEval, type TeamAnalysis } from '../lib/draftanalysis';
import type { FPlayer } from '../lib/forecast';
import { gradeColor } from '../lib/grades';
import { PlayerSheet } from '../components/PlayerCard';
import { Headshot, PageHeader, Pos, Section, Skeleton, TeamBadge, TeamName } from '../components/ui';

interface Commentary {
  overview: string[];
  teams: Record<string, { headline: string; body: string[]; plan: string[] }>;
  written: string;
}

export function useDraftAnalysis() {
  const { teams, players, rosters, picks, draft, league, standings, playoffs } = useLeague();
  const details = useProjDetails();
  const games = useSeasonGames();
  const nhl = useNhlOdds();
  return useMemo<DA | null>(() => {
    if (!details || !games || !nhl || !players.size || !league) return null;
    const gm = teams.filter((t) => t.role !== 'spectator');
    const fp = new Map<number, FPlayer & { name: string; age?: number | null }>();
    for (const p of players.values()) {
      const d = details.get(p.id);
      fp.set(p.id, { ...p, proj: Number(p.proj), proj_gp: p.proj_gp == null ? null : Number(p.proj_gp), lo: d?.proj_meta?.lo, hi: d?.proj_meta?.hi, stats: d?.proj_stats ?? null, age: d?.proj_meta?.age ?? null });
    }
    const board = picks.filter((k) => k.season === draft?.season && k.player_id && k.overall).map((k) => ({ overall: k.overall!, round: k.round, team: k.team_id, player: k.player_id! }));
    const current = new Map(standings.map((s) => [s.team_id, Number(s.points) || 0]));
    const currentPo = new Map(playoffs.map((s) => [s.team_id, Number(s.points) || 0]));
    return analyzeDraft({ teams: gm.map((t) => ({ id: t.id, name: t.name, gm: t.gm_name })), players: fp, rosters, picks: board, games, caps: league.roster as Record<string, number>,
      from: etToday(), current, currentPo, to: league.season_end ?? undefined, nhl });
  }, [details, games, nhl, players, teams, rosters, picks, draft?.season, league, standings, playoffs]);
}

const pct = (v: number) => (v >= 0.995 ? '>99%' : v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`);
const POS = ['C', 'LW', 'RW', 'D', 'G'];
const CAT_LABEL: Record<string, string> = { g: 'G', a: 'A', ppp: 'PPP', sog: 'SOG', hit: 'HIT', blk: 'BLK', pm: '+/-', w: 'W', sv: 'SV', sho: 'SO' };
const rankCls = (r: number, n: number) => (r === 1 ? 'bg-gold/25 text-gold' : r <= 2 ? 'bg-emerald-500/20 text-emerald-200' : r >= n ? 'bg-red-500/20 text-red-200' : r >= n - 1 ? 'bg-amber-500/15 text-amber-200' : 'bg-white/[.06] text-slate-300');

export default function DraftAnalysisPage({ embedded = false }: { embedded?: boolean } = {}) {
  const brand = useBrand();
  const { team, players, me, teams, draft } = useLeague();
  const a = useDraftAnalysis();
  const [notes, setNotes] = useState<Commentary | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set(me ? [me.id] : []));
  const [detail, setDetail] = useState<number | null>(null);
  const [tbl, setTbl] = useState<'cup' | 'reg' | 'po'>('cup');
  useEffect(() => {
    supabase.from('league_reports').select('data').eq('id', `draft-${draft?.season ?? '2026-27'}`).maybeSingle().then(({ data }) => setNotes((data?.data as Commentary) ?? null));
  }, [draft?.season]);
  useEffect(() => { if (me) setOpen((o) => new Set([...o, me.id])); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = teams.filter((t) => t.role !== 'spectator').length;
  const avgDraft = a ? a.teams.reduce((s, t) => s + t.draftScore, 0) / a.teams.length : 0;

  // render functions, not components: a component defined in here would be a new type on every render, and the
  // team cards' open "every pick" lists would snap shut whenever a pick was tapped
  const pickLine = (e: PickEval, show: 'team' | 'over' = 'team') => {
    const p = players.get(e.player);
    return (
      <button key={e.overall} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[.03]" onClick={() => setDetail(e.player)}>
        <span className="num w-8 shrink-0 text-xs text-mute">#{e.overall}</span>
        <Headshot p={p} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{p?.name}</span>
          <span className="block truncate text-[11px] text-mute">{p && <Pos p={p.pos} className="mr-1 inline-flex" />}{show === 'team' ? team(e.team)?.gm_name : `board #${e.boardRank}`} · proj {fmtPts(e.proj, 0)}</span>
        </span>
        {e.stash ? <span className="chip bg-sky-500/15 text-[10px] text-sky-200">stash</span>
          : <span className={`num shrink-0 text-sm font-bold ${e.over >= 10 ? 'text-emerald-300' : e.over <= -20 ? 'text-red-300' : 'text-slate-300'}`}>{e.over > 0 ? '+' : ''}{Math.round(e.over)}</span>}
      </button>
    );
  };

  const teamCard = (t: TeamAnalysis, i: number) => {
    const tm = team(t.team);
    const c = notes?.teams?.[String(t.team)];
    const isOpen = open.has(t.team);
    const toggle = () => setOpen((o) => { const x = new Set(o); x.has(t.team) ? x.delete(t.team) : x.add(t.team); return x; });
    const topContrib = [...t.fc.players.values()].sort((x, y) => y.pts - x.pts).slice(0, 6);
    return (
      <div className={`card overflow-hidden ${t.team === me?.id ? 'ring-1 ring-sky-400/40' : ''}`}>
        <button className="flex w-full items-center gap-3 p-3 text-left" onClick={toggle}>
          <span className="num w-5 text-center font-display text-lg text-mute">{i + 1}</span>
          <TeamBadge team={tm} size={36} />
          <span className="min-w-0 flex-1">
            <TeamName team={tm} className="block truncate font-semibold" />
            <span className="block truncate text-xs text-mute">{c?.headline ?? `${tm?.gm_name} · projected ${fmtPts(t.fc.total, 0)}`}</span>
          </span>
          <span className="hidden text-right text-xs sm:block"><span className="block text-mute">🏆 Cup · Regular · Playoffs</span><span className="num font-bold">{pct(t.so.cup.first)} · {pct(t.so.reg.first)} · {pct(t.so.po.first)}</span></span>
          <span className="text-center"><span className="block text-[9px] uppercase tracking-wider text-mute">Roster</span><span className={`h-display text-2xl ${gradeColor(t.rosterGrade)}`}>{t.rosterGrade}</span></span>
          <span className="text-center"><span className="block text-[9px] uppercase tracking-wider text-mute">Draft</span><span className={`h-display text-2xl ${gradeColor(t.draftGrade)}`}>{t.draftGrade}</span></span>
          <ChevronDown size={16} className={`shrink-0 text-mute transition ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (
          <div className="space-y-3 border-t border-white/[.06] p-3">
            {c && <div className="space-y-2 text-sm leading-relaxed text-slate-200">{c.body.map((p, k) => <p key={k}>{p}</p>)}</div>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Box label={`🏆 ${bare(brand.trophy)} (full year)`} value={fmtPts(t.year, 0)} sub={`${pct(t.so.cup.first)} to win it · ${fmtPts(t.so.cup.p10, 0)}–${fmtPts(t.so.cup.p90, 0)}`} />
              <Box label="Regular season" value={fmtPts(t.fc.total, 0)} sub={`${pct(t.odds.first)} title · ${pct(t.odds.top3)} in the money · ${pct(t.odds.last)} last`} />
              <Box label="Playoffs (from zero)" value={fmtPts(t.po.total, 0)} sub={`${pct(t.so.po.first)} title · ${pct(t.so.po.top3)} in the money`} />
              <Box label="Keepers vs draft" value={`${Math.round((t.keeperPts / Math.max(1, t.keeperPts + t.draftPts)) * 100)}% / ${Math.round((t.draftPts / Math.max(1, t.keeperPts + t.draftPts)) * 100)}%`} sub="share of lineup points" />
              <Box label="Draft value" value={`${t.draftScore - avgDraft > 0 ? '+' : ''}${Math.round(t.draftScore - avgDraft)}`} sub="points vs the average draft" />
            </div>
            {t.flex.length > 0 && (
              <div>
                <div className="label mb-1">Multi-position players <span className="font-normal normal-case text-mute">· points they add by covering more than one spot</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {t.flex.map((f) => { const p = players.get(f.id); return p && (
                    <button key={f.id} onClick={() => setDetail(f.id)} className="flex items-center gap-1 rounded-full bg-white/[.06] px-2 py-0.5 text-xs"><span className="font-semibold">{p.name}</span><span className="text-mute">{p.elig.join('/')}</span><span className={`num font-bold ${f.gain >= 3 ? 'text-emerald-300' : 'text-slate-300'}`}>+{fmtPts(Math.max(0, f.gain), 0)}</span></button>); })}
                </div>
              </div>
            )}
            <div>
              <div className="label mb-1">Position strength <span className="font-normal normal-case text-mute">· rank of {n}, lineup points</span></div>
              <div className="flex flex-wrap gap-1.5">
                {POS.map((p) => <span key={p} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${rankCls(t.posRank[p], n)}`}><Pos p={p} className="min-w-0 px-1 py-0" />#{t.posRank[p]} · {fmtPts(t.fc.byPos[p] ?? 0, 0)} · {t.counts[p]} on roster</span>)}
              </div>
              <div className="label mb-1 mt-2">Categories <span className="font-normal normal-case text-mute">· rank of {n}</span></div>
              <div className="flex flex-wrap gap-1">
                {Object.keys(CAT_LABEL).map((k) => <span key={k} className={`num rounded-md px-1.5 py-0.5 text-[11px] font-bold ${rankCls(t.catRank[k], n)}`}>{CAT_LABEL[k]} {t.catRank[k]}</span>)}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="label mb-1">Carrying the load</div>
                <div className="divide-y divide-white/[.06] rounded-xl border border-white/[.07]">
                  {topContrib.map((x) => { const p = players.get(x.id); return (
                    <button key={x.id} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm" onClick={() => setDetail(x.id)}>
                      <Headshot p={p} size={24} /><span className="min-w-0 flex-1 truncate">{p?.name}</span>{p && <Pos p={p.pos} />}<span className="num w-10 text-right font-semibold">{fmtPts(x.pts, 0)}</span>
                    </button>); })}
                </div>
              </div>
              <div className="space-y-2 text-sm">
                {t.strengths.length > 0 && <div><div className="label mb-0.5">Strengths</div>{t.strengths.map((s) => <div key={s} className="text-emerald-200">▲ {s}</div>)}</div>}
                {t.weaknesses.length > 0 && <div><div className="label mb-0.5">Weaknesses</div>{t.weaknesses.map((s) => <div key={s} className="text-red-200">▼ {s}</div>)}</div>}
                {t.risks.length > 0 && <div><div className="label mb-0.5">Risks</div>{t.risks.map((s) => <div key={s} className="text-amber-200">⚠ {s}</div>)}</div>}
              </div>
            </div>
            <div className="rounded-xl border border-gold/25 bg-gold/[.06] p-3">
              <div className="label mb-1 text-gold">How to get better</div>
              <ul className="space-y-1.5 text-sm">
                {(c?.plan ?? []).map((m) => <li key={m} className="flex gap-2"><span className="text-gold">➜</span><span>{m}</span></li>)}
                {c?.plan && t.moves.length > 0 && <li className="pt-1 text-[10px] font-bold uppercase tracking-wider text-mute">From today’s numbers</li>}
                {t.moves.map((m) => <li key={m} className="flex gap-2 text-slate-200"><span className="text-mute">•</span><span>{m}</span></li>)}
              </ul>
            </div>
            <details className="rounded-xl border border-white/[.07]">
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Every pick, against where it was taken</summary>
              <div className="divide-y divide-white/[.06]">{t.picks.map((e) => pickLine(e, 'over'))}</div>
            </details>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {!embedded && <PageHeader icon={<LineChart size={22} className="text-gold" />} title="Draft analysis" sub={`${draft?.season ?? ''} · every roster played out over the real schedule`}
        right={<Link to="/draft" className="btn-ghost btn-sm">Draft board</Link>} />}
      {!a ? (
        <div className="space-y-2"><Skeleton className="h-24" /><Skeleton className="h-64" /><div className="text-center text-xs text-mute">Simulating the season…</div></div>
      ) : (
        <>
          {notes?.overview && (
            <div className="card-hero space-y-2 p-4 text-sm leading-relaxed">
              <div className="h-display text-gold-shine text-xl">The big picture</div>
              {notes.overview.map((p, k) => <p key={k} className="relative text-slate-100">{p}</p>)}
              <p className="relative text-[11px] text-white/50">Written {notes.written}. The numbers below are live: they move with trades, pickups, injuries and every game played.</p>
            </div>
          )}

          <Section title="Projected standings" right={<span className="text-xs text-mute">3,000 simulated years</span>}>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {([['cup', `🏆 ${bare(brand.trophy)} · full year`], ['reg', '🏒 Regular season'], ['po', '🔥 Playoffs']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTbl(k)} className={`chip ${tbl === k ? 'bg-gold/20 text-gold' : 'bg-white/[.05] text-mute'}`}>{l}</button>
              ))}
            </div>
            <div className="card overflow-hidden">
              <div className="scroll-x">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-white/[.04] text-[11px] uppercase tracking-wider text-mute">
                    <tr><th className="px-3 py-2 text-left">Team</th><th className="px-2 text-right">Proj</th><th className="px-2 text-left">Likely range</th><th className="px-2 text-right">Win</th><th className="px-2 text-right">Top 3</th><th className="px-2 text-right">Last</th><th className="px-2 text-center">Roster</th><th className="px-2 text-center">Draft</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/[.06]">
                    {(() => {
                      const od = (t: TeamAnalysis) => t.so[tbl];
                      const tot = (t: TeamAnalysis) => (tbl === 'cup' ? t.year : tbl === 'reg' ? t.fc.total : t.po.total);
                      const lo = Math.min(...a.teams.map((t) => od(t).p10)), hi = Math.max(...a.teams.map((t) => od(t).p90));
                      const x = (v: number) => `${((v - lo) / Math.max(1, hi - lo)) * 100}%`;
                      return [...a.teams].sort((p, q) => tot(q) - tot(p)).map((t) => (
                        <tr key={t.team} className={t.team === me?.id ? 'bg-sky-500/[.07]' : ''}>
                          <td className="px-3 py-2"><span className="flex items-center gap-2"><TeamBadge team={team(t.team)} size={24} /><span className="truncate font-semibold">{team(t.team)?.gm_name}</span></span></td>
                          <td className="num px-2 text-right font-bold">{fmtPts(tot(t), 0)}</td>
                          <td className="px-2"><div className="relative h-2 w-32 rounded-full bg-white/[.05] sm:w-44"><div className="absolute h-2 rounded-full bg-sky-400/50" style={{ left: x(od(t).p10), width: `calc(${x(od(t).p90)} - ${x(od(t).p10)})` }} /><div className="absolute -top-0.5 h-3 w-0.5 rounded bg-white" style={{ left: x(tot(t)) }} /></div></td>
                          <td className="num px-2 text-right">{pct(od(t).first)}</td>
                          <td className="num px-2 text-right">{pct(od(t).top3)}</td>
                          <td className="num px-2 text-right text-mute">{pct(od(t).last)}</td>
                          <td className={`h-display px-2 text-center text-lg ${gradeColor(t.rosterGrade)}`}>{t.rosterGrade}</td>
                          <td className={`h-display px-2 text-center text-lg ${gradeColor(t.draftGrade)}`}>{t.draftGrade}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-1 px-1 text-xs text-mute">{tbl === 'cup' ? `${brand.trophy} is the whole year, draft to Stanley Cup final: regular season plus playoff points.` : tbl === 'po' ? 'The playoffs start everyone at zero with the same rosters. Players only score while their NHL team is alive, so the forecast leans on each NHL team’s playoff odds and how deep it should go.' : 'Regular season points, kept as they stand when the NHL regular season ends.'} Roster grade: the whole team (keepers and picks) played out day by day with the best lineup each night, for the full year. Multi-position players count for what they’re worth: on nights a C or LW is off, a C/LW keeps the slot filled. Draft grade: this year’s value from the picks alone, each one against the best player still on the board at that slot. Prospect stashes are judged in later years.</p>
          </Section>

          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="🥷 Steals"><div className="card divide-y divide-white/[.06]">{a.steals.map((e) => pickLine(e))}</div></Section>
            <Section title="🚨 Reaches"><div className="card divide-y divide-white/[.06]">{a.reaches.map((e) => pickLine(e))}</div></Section>
          </div>
          {a.stashes.length > 0 && (
            <Section title="🔮 Prospect stashes">
              <div className="card divide-y divide-white/[.06]">{a.stashes.map((e) => pickLine(e))}</div>
              <p className="mt-1 px-1 text-xs text-mute">No NHL track record yet: keeper bets on the future, worth nothing this season.</p>
            </Section>
          )}
          {a.runs.length > 0 && (
            <div className="card p-3 text-sm"><span className="label mr-2">Position runs</span>{a.runs.map((r) => <span key={r.pos + r.from} className="mr-3 inline-flex items-center gap-1"><Pos p={r.pos} /> {r.n} in picks {r.from}–{r.to}</span>)}</div>
          )}

          <Section title="Team by team">
            <div className="space-y-2">{a.teams.map((t, i) => <Fragment key={t.team}>{teamCard(t, i)}</Fragment>)}</div>
          </Section>
          <p className="px-1 text-xs text-mute">Projections: the Super Pools model (three seasons of stats weighted toward last year, shooting luck and save % regressed, age curves, games played and injuries). Point values are fantasy points under the league’s scoring.</p>
        </>
      )}
      <PlayerSheet id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function Box({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/[.04] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-mute">{label}</div>
      <div className="num text-base font-bold">{value}</div>
      {sub && <div className="text-[10px] text-mute">{sub}</div>}
    </div>
  );
}
