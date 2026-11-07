// The trend (7 November 2026, Patrick: how the team has done over the last two weeks and the last month): the stretch in a
// word, each window's record and share of the points against the season's, the goals for and against a game, the league
// rank where every club's games are on hand, and the month's games one chip each, the last two weeks lit.
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Flame, Snowflake } from 'lucide-react';
import { recordWord, type Trend, type TrendTone, type TrendWindow } from '../../lib/fanTrend';
import { fmtDate } from '../../lib/format';
import { Head, RankChip } from './kit';

const TONE: Record<TrendTone, { icon: typeof Flame; ring: string; text: string; word: string }> = {
  hot: { icon: Flame, ring: 'ring-emerald-400/30', text: 'text-emerald-300', word: 'Hot' },
  cold: { icon: Snowflake, ring: 'ring-sky-400/30', text: 'text-sky-300', word: 'Cold' },
  steady: { icon: Activity, ring: 'ring-white/10', text: 'text-slate-200', word: 'Steady' },
  quiet: { icon: Activity, ring: 'ring-white/10', text: 'text-slate-300', word: 'Few games' },
};
const pts = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))}`;

export function FanTrend({ t, sub, scores = 'goals' }: { t: Trend; sub?: string; scores?: string }) {
  const T = TONE[t.tone], Icon = T.icon;
  const lit = new Set(t.two.games.map((g) => `${g.date}:${g.opp}`));
  return (
    <section className="space-y-3">
      <Head id="trend" title="The trend" sub={sub ?? (t.offseason ? 'How the season ended: its last two weeks and its last month.' : 'The last two weeks and the last month against the season so far.')} />
      <div className={`card overflow-hidden p-4 ring-1 ${T.ring}`}>
        <div className="flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/[.06] ${T.text}`}><Icon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className={`font-display text-[clamp(20px,6vw,26px)] font-extrabold italic leading-tight ${T.text}`}>{t.head}</div>
            <p className="mt-0.5 text-[13px] leading-snug text-slate-300">{t.read}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <WindowTile w={t.two} label="2 weeks" kind={t.kind} scores={scores} />
          <WindowTile w={t.month} label="Month" kind={t.kind} scores={scores} />
        </div>
        {t.month.games.length > 0 && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-[11px] text-mute"><span>The month, game by game</span><span>last two weeks lit</span></div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {t.month.games.map((g) => {
                const on = lit.has(`${g.date}:${g.opp}`);
                const bg = g.res === 'W' ? 'bg-emerald-500/80 text-white' : g.res === 'OTL' || g.res === 'D' ? 'bg-amber-400/80 text-slate-900' : 'bg-red-500/75 text-white';
                return (
                  <span key={`${g.date}:${g.opp}`} title={`${fmtDate(g.date)} ${g.home ? 'vs' : 'at'} ${g.opp} ${g.us}-${g.them}`}
                    className={`flex w-9 flex-col items-center rounded-lg py-0.5 ${on ? '' : 'opacity-45'}`}>
                    <span className={`num grid h-6 w-full place-items-center rounded-md text-[11px] font-extrabold ${bg}`}>{g.res === 'OTL' ? 'OT' : g.res}</span>
                    <span className="mt-0.5 text-[9px] font-semibold leading-none text-mute">{g.home ? '' : '@'}{g.opp}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[.06] pt-2 text-[12px] text-mute">
          <span>All season <b className="num text-slate-200">{recordWord(t.season, t.kind)}</b></span>
          <span><b className="num text-slate-200">{Math.round(t.season.pct * 100)}%</b> of the {t.kind === 'other' ? 'games won' : 'points'}</span>
          <span><b className="num text-slate-200">{t.season.gf.toFixed(1)}–{t.season.ga.toFixed(1)}</b> {scores} a game</span>
        </div>
      </div>
    </section>
  );
}

function WindowTile({ w, label, kind, scores }: { w: TrendWindow; label: string; kind: Trend['kind']; scores: string }) {
  const T = TONE[w.tone];
  const Arrow = w.vsSeason >= 0.02 ? ArrowUpRight : w.vsSeason <= -0.02 ? ArrowDownRight : ArrowRight;
  const tone = w.tone === 'quiet' ? 'text-slate-300' : w.vsSeason >= 0.02 ? 'text-emerald-300' : w.vsSeason <= -0.02 ? 'text-red-300' : 'text-slate-300';
  return (
    <div className="min-w-0 rounded-2xl bg-black/25 p-2.5 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-1">
        <span className="label truncate">{label}</span>
        {w.rank != null ? <RankChip rank={w.rank} of={w.of ?? 32} /> : <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide ${T.text}`}>{T.word}</span>}
      </div>
      {w.gp ? (
        <>
          <div className="num font-display text-[clamp(20px,6.4vw,28px)] font-extrabold leading-tight text-white">{recordWord(w, kind)}</div>
          <div className={`flex flex-wrap items-center gap-x-1 text-[13px] font-bold ${tone}`}>
            <Arrow className="h-3.5 w-3.5 shrink-0" /><span className="num">{Math.round(w.pct * 100)}%</span>
            <span className="num whitespace-nowrap text-[11px] font-semibold">{pts(w.vsSeason)} vs season</span>
          </div>
          <div className="mt-1 text-[11px] leading-snug text-mute">
            <span className="num text-slate-300">{w.gf.toFixed(1)}–{w.ga.toFixed(1)}</span> {scores} a game{kind === 'hockey' ? ` · ${Math.round(w.pct * 164)}-pt pace` : ''}
            {w.before && <><br />the {w.days === 14 ? 'two weeks' : 'month'} before: <span className="num text-slate-300">{Math.round(w.before.pct * 100)}%</span></>}
          </div>
        </>
      ) : <div className="mt-1 text-sm text-slate-300">No games in it.</div>}
    </div>
  );
}
