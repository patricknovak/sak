// Keeper grades for every team, and Garry's keeper report with his season predictions. The grades are
// computed here with the same engine Garry uses; his write-up is stored on the league record so everyone
// reads the same one, and the commish can ask him to redo it after keepers change.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { keeperGrades, keeperGradeColor, type KeeperReport as Report, type TeamKeepers } from '../lib/keepergrades';
import { ago } from '../lib/format';
import { Pos, Section, TeamBadge, TeamName, useAction } from './ui';
import { Sparkles } from 'lucide-react';

export function useKeeperGrades() {
  const { teams, rosters, players, league } = useLeague();
  return useMemo(() => keeperGrades(teams, rosters, players, league), [teams, rosters, players, league]);
}

function TeamCard({ g, open, onToggle, onPlayer, take }: { g: TeamKeepers; open: boolean; onToggle: () => void; onPlayer: (id: number) => void; take?: string }) {
  const { team, me } = useLeague();
  const t = team(g.team);
  return (
    <div className={`card overflow-hidden ${g.team === me?.id ? 'border-sky-400/30' : ''}`}>
      <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={onToggle}>
        <span className="num w-5 text-center font-display text-lg text-mute">{g.rank}</span>
        <TeamBadge team={t} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5"><TeamName team={t} className="truncate text-sm" />{!g.submitted && <span className="chip shrink-0 bg-amber-400/15 text-[10px] text-amber-200">default keepers</span>}</div>
          <div className="text-[11px] text-mute">{g.proj} proj pts · {g.filled}/12 starters filled{g.gaps.length ? ` · needs ${g.gaps.join(', ')}` : ''}{g.injured ? ` · ${g.injured} hurt` : ''}{g.bestProj !== g.proj || g.leftBehind.length ? ` · ${g.efficiency}% of best possible` : ''}</div>
        </div>
        <span className={`h-display text-3xl ${keeperGradeColor(g.grade)}`}>{g.grade}</span>
      </button>
      {open && (
        <div className="border-t border-white/[.06] px-3 py-2">
          {take && <p className="mb-2 rounded-xl bg-white/[.04] px-3 py-2 text-sm">🎙️ {take}</p>}
          <div className="divide-y divide-white/[.06]">
            {g.keepers.map((k) => (
              <button key={k.player.id} className="flex w-full items-center gap-2 py-1.5 text-left text-sm" onClick={() => onPlayer(k.player.id)}>
                <Pos p={k.player.pos} className="w-9" />
                <span className="min-w-0 flex-1 truncate">{k.player.name} <span className="text-[11px] text-mute">{k.player.nhl_team}</span>{k.injured && <span className="ml-1 chip bg-red-500/15 text-[10px] text-red-200">{k.player.injury_status}</span>}</span>
                <span className="text-[11px] text-mute">#{k.posRank} {k.player.pos} · {k.tier}</span>
                <span className="num w-10 text-right text-xs">{Math.round(k.player.proj)}</span>
                <span className={`w-8 text-right font-display text-lg ${keeperGradeColor(k.grade)}`}>{k.grade}</span>
              </button>
            ))}
          </div>
          {g.leftBehind.length > 0 && <div className="mt-1.5 text-[11px] text-mute">Sent back to the pool: {g.leftBehind.map((p) => `${p.name} (${Math.round(p.proj)})`).join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

export function KeeperReport({ onPlayer }: { onPlayer: (id: number) => void }) {
  const { me, league, team, refresh } = useLeague();
  const grades = useKeeperGrades();
  const { busy, run } = useAction();
  const [open, setOpen] = useState<number | null>(me?.id ?? null);
  const report = league?.info?.keeper_report as Report | undefined;
  const rows = [...grades.values()].sort((a, b) => a.rank - b.rank);
  const takeFor = (id: number) => report?.teams.find((t) => t.team_id === id)?.take;
  const regen = () => run(async () => {
    const { data, error } = await supabase.functions.invoke('garry?task=keepers', { method: 'POST', body: {} });
    if (error) throw error;
    if (data && data.ok === false) throw new Error(data.error);
    await refresh(['league']);
  }, 'Garry filed his keeper report 🎙️');
  if (rows.length === 0) return null;
  return (
    <>
      <Section title="🎓 Keeper grades" right={<span className="text-xs text-mute">league-relative, projections</span>}>
        <div className="space-y-1.5">{rows.map((g) => <TeamCard key={g.team} g={g} open={open === g.team} onToggle={() => setOpen(open === g.team ? null : g.team)} onPlayer={onPlayer} take={takeFor(g.team)} />)}</div>
        <p className="mt-1.5 px-1 text-xs text-mute">A team’s grade weighs what its keepers project to score, how close that is to the best six it could have kept (while keepers are still being picked), how many of the 12 starting slots they fill, and injuries. Each keeper’s letter is his projection rank in the whole pool; the tier is his rank at his position. “Default keepers” means that GM hasn’t saved yet, so this is what the site would keep for them.</p>
      </Section>

      <Section title="🎙️ Garry’s keeper report" right={me?.is_commish ? <button className="btn btn-sm" disabled={busy} onClick={regen}><Sparkles size={14} /> {report ? 'Redo it' : 'Ask Garry'}</button> : undefined}>
        {!report ? (
          <div className="card p-4 text-sm text-mute">Garry files his report once keepers lock (and the commish can ask for it any time): a take on every GM’s keepers and his predicted standings for the season.</div>
        ) : (
          <div className="space-y-3">
            <div className="card p-3 text-sm"><p>{report.intro}</p><div className="mt-1 text-[11px] text-mute">Filed {ago(report.generated_at, Date.now())}{report.llm ? '' : ' · house lines (Grok was out)'} · based on keepers as they stood then</div></div>
            <div className="card divide-y divide-white/[.06]">
              <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-mute">Garry’s predicted standings, 2026-27</div>
              {[...report.predictions].sort((a, b) => a.rank - b.rank).map((p) => (
                <div key={p.team_id} className={`flex items-center gap-3 px-3 py-2 ${p.team_id === me?.id ? 'bg-white/[.05]' : ''}`}>
                  <span className="num w-5 text-center font-display text-lg text-mute">{p.rank}</span>
                  <TeamBadge team={team(p.team_id)} size={26} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{team(p.team_id)?.gm_name}{p.rank === 1 ? ' 🏆' : p.rank === report.predictions.length ? ' 🪣' : ''}</div><div className="text-xs text-mute">{p.line}</div></div>
                </div>
              ))}
            </div>
            {report.bold && <div className="card border-gold/30 bg-gold/[.06] p-3 text-sm">🔮 <b>Bold call:</b> {report.bold}</div>}
            <p className="px-1 text-xs text-mute">Tap a team above to read Garry’s take on their keepers. Disagree? <Link to="/chat" className="text-sky-300">Tell him in the chat</Link>, he remembers.</p>
          </div>
        )}
      </Section>
    </>
  );
}
