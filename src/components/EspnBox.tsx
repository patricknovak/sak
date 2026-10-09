// A game's box score in NFL centre (nhl-hub's espn task, ESPN's public summary): the team stats side by side with a bar
// for who had more, each side's passing, rushing and receiving leaders, and every scoring play with the score after it.
import { useEffect, useState } from 'react';
import { hub } from '../lib/nhlhub';
import { Spinner } from './ui';

interface Box {
  state: 'pre' | 'in' | 'post';
  teams: { abbrev: string; name: string; logo: string | null; color: string | null; home: boolean; stats: { key: string; label: string; value: string }[] }[];
  leaders: { abbrev: string; rows: { cat: string; name: string; headshot: string | null; line: string }[] }[];
  scoring: { q: number; clock: string; abbrev: string; type: string | null; text: string; away: number; home: number }[];
}
// the first number in a stat ("7-13" third downs, "39:21" possession), to draw who had more
const num = (v: string) => (v.includes(':') ? v.split(':').reduce((m, x) => m * 60 + Number(x), 0) : Number(v.split(/[-/]/)[0]) || 0);
// stats where less is better
const LESS = new Set(['turnovers', 'totalPenaltiesYards', 'sacksYardsLost']);
const ord = (n: number) => (n > 4 ? 'OT' : `Q${n}`);

export function EspnBox({ sport, id, live }: { sport: string; id: string; live: boolean }) {
  const [box, setBox] = useState<Box | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    const load = () => hub<Box>('espn', { sport, id }).then((b) => on && setBox(b), () => on && setBox(null));
    load();
    const t = live ? window.setInterval(load, 60000) : undefined;
    return () => { on = false; if (t) window.clearInterval(t); };
  }, [sport, id, live]);
  if (box === undefined) return <div className="flex justify-center py-4"><Spinner /></div>;
  if (!box || box.teams.length < 2) return <p className="px-3.5 py-3 text-xs text-mute">The box score isn&apos;t in yet.</p>;
  const away = box.teams.find((t) => !t.home) ?? box.teams[0], home = box.teams.find((t) => t.home) ?? box.teams[1];
  const col = (t: Box['teams'][number]) => t.color ?? 'rgb(var(--gold-rgb))';
  return (
    <div className="space-y-4 border-t border-white/[.06] px-3.5 py-3">
      <div>
        <div className="mb-1.5 grid grid-cols-[1fr_auto_1fr] text-[10px] font-black uppercase tracking-wider text-mute">
          <span>{away.abbrev}</span><span>Team stats</span><span className="text-right">{home.abbrev}</span>
        </div>
        <div className="space-y-1.5">
          {away.stats.map((s) => {
            const h = home.stats.find((x) => x.key === s.key);
            if (!h) return null;
            const a = num(s.value), b = num(h.value);
            const lead = a === b ? 0 : (a > b) !== LESS.has(s.key) ? -1 : 1;
            const share = a + b > 0 ? (a / (a + b)) * 100 : 50;
            return (
              <div key={s.key}>
                <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 text-[12px]">
                  <span className={`num font-bold ${lead < 0 ? 'text-white' : 'text-slate-400'}`}>{s.value}</span>
                  <span className="text-center text-[11px] text-mute">{s.label}</span>
                  <span className={`num text-right font-bold ${lead > 0 ? 'text-white' : 'text-slate-400'}`}>{h.value}</span>
                </div>
                <div className="mt-0.5 flex h-1 overflow-hidden rounded-full bg-white/[.06]">
                  <span style={{ width: `${share}%`, background: col(away), opacity: lead < 0 ? 0.95 : 0.4 }} />
                  <span className="ml-0.5 flex-1" style={{ background: col(home), opacity: lead > 0 ? 0.95 : 0.4 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {box.leaders.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-mute">Leaders</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[away, home].map((t) => {
              const l = box.leaders.find((x) => x.abbrev === t.abbrev);
              return (
                <div key={t.abbrev} className="space-y-1.5 rounded-xl bg-white/[.03] p-2 ring-1 ring-white/[.06]">
                  {(l?.rows ?? []).map((r) => (
                    <div key={r.cat} className="flex items-center gap-2">
                      {r.headshot ? <img src={r.headshot} alt="" className="h-8 w-8 shrink-0 rounded-full bg-white/10 object-cover" /> : <span className="h-8 w-8 shrink-0 rounded-full bg-white/10" />}
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold leading-tight text-white">{r.name} <span className="text-[10px] font-bold uppercase text-mute">{t.abbrev} · {r.cat}</span></div>
                        <div className="text-[11px] leading-tight text-slate-300">{r.line}</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {box.scoring.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-mute">Scoring</div>
          <div className="space-y-1.5">
            {box.scoring.map((p, i) => (
              <div key={i} className="flex gap-2.5 text-[12px]">
                <span className="w-[3.9rem] shrink-0 text-[10px] font-bold uppercase leading-5 text-mute">{ord(p.q)} {p.clock}</span>
                <span className="min-w-0 flex-1 leading-snug text-slate-200"><b className="text-white">{p.abbrev}</b>{p.type ? <span className="ml-1 rounded bg-white/10 px-1 text-[9px] font-black text-slate-200">{p.type}</span> : null} {p.text}</span>
                <span className="num shrink-0 font-bold text-white">{p.away}-{p.home}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
