// The other leagues' fan zones' shared pieces (25 October 2026, the NFL, the NBA and the Premier League): the data (nhl-hub's
// fan-sport-league and fan-sport tasks, kept at Cloudflare's edge), the league's read worked out once a visit (every
// measure ranked, the season simulated a few thousand times), the chance tiles, the table with every club's chances and
// the leader boards. The reading itself is src/lib/fanSport.ts.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { hub } from '../../lib/nhlhub';
import { chance, outlook, table, type Chances, type Outlook, type Sport, type SportClub, type SportClubRow, type SportLeague, type Table } from '../../lib/fanSport';
import { zonePath } from '../../lib/fanVoice';
import type { SportHistory } from '../../lib/fanSportHistory';
import { ClubMark } from './kit';

// ── the data
function useHub<T>(task: string, q: Record<string, string>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null); setFailed(false);
    hub<T>(task, q).then((d) => { if (live) setData(d); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
    // the key stands for the question
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, key, tries]);
  return { data, failed, retry: () => setTries((n) => n + 1) };
}
export const useSportLeague = (league: string) => useHub<SportLeague>('fan-sport-league', { league }, league);
export const useSportClub = (league: string, club: string) => useHub<SportClub>('fan-sport', { league, club }, `${league}:${club}`);
export const useSportHistory = (league: string) => useHub<SportHistory>('fan-sport-history', { league }, league);

// the league's read, once per answer: the ranks at once, the simulated season a moment later so the page draws first
const tables = new WeakMap<SportLeague, Table>();
const outlooks = new WeakMap<SportLeague, Outlook | null>();
export function useLeagueRead(l: SportLeague | null) {
  const tb = useMemo(() => {
    if (!l) return null;
    let t = tables.get(l);
    if (!t) { t = table(l); tables.set(l, t); }
    return t;
  }, [l]);
  const [out, setOut] = useState<Outlook | null>(() => (l && outlooks.has(l) ? outlooks.get(l)! : null));
  useEffect(() => {
    if (!l) { setOut(null); return; }
    if (outlooks.has(l)) { setOut(outlooks.get(l)!); return; }
    setOut(null);
    const t = setTimeout(() => {
      // the NBA's season has the most games left to play: fewer runs keep a phone quick, the chances barely move
      const o = outlook(l, l.sport === 'basketball' ? 2000 : 3000);
      outlooks.set(l, o);
      setOut(o);
    }, 40);
    return () => clearTimeout(t);
  }, [l]);
  return { tb, out };
}

// ── the words for each sport's spring
export const CHANCE_TILES: Record<Sport, [keyof Chances, string, string][]> = {
  football: [['playoffs', 'Playoffs', 'one of seven seeds'], ['division', 'Division', 'win it'], ['top', 'Top seed', 'and the bye'], ['conf', 'Title game', 'the conference’s'], ['finals', 'Super Bowl', 'get there'], ['title', 'Win it all', 'the Super Bowl']],
  basketball: [['playoffs', 'Playoffs', 'after the play-in'], ['top6', 'Top six', 'skip the play-in'], ['top', 'Top seed', 'in the conference'], ['conf', 'Conf. finals', 'get there'], ['finals', 'The Finals', 'get there'], ['title', 'Title', 'win it all']],
  soccer: [['title', 'Champions', 'win the league'], ['top4', 'Top four', 'the Champions League'], ['top7', 'Top seven', 'a European place'], ['relegated', 'Relegation', 'the bottom three']],
};
const BAD: (keyof Chances)[] = ['relegated'];

export function ChanceTiles({ sport, c, compact }: { sport: Sport; c: Chances | null; compact?: boolean }) {
  const tiles = CHANCE_TILES[sport];
  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-3' : tiles.length === 4 ? 'grid-cols-2 min-[420px]:grid-cols-4' : 'grid-cols-3'}`}>
      {tiles.map(([k, label, sub]) => {
        const v = c ? (c[k] as number) : null;
        const bad = BAD.includes(k);
        return (
          <div key={k} className="min-w-0 rounded-2xl bg-black/25 px-2.5 py-2 ring-1 ring-white/10">
            <div className="label truncate">{label}</div>
            <div className="num font-display text-[clamp(20px,6vw,26px)] font-extrabold leading-tight" style={{ color: v == null ? undefined : bad ? (v >= 0.25 ? 'rgb(248 113 113)' : 'rgb(203 213 225)') : v >= 0.5 ? 'var(--club)' : 'white' }}>{v == null ? '…' : chance(v)}</div>
            <div className="truncate text-[10px] text-mute">{sub}</div>
            {v != null && <div className="mt-1 h-1 rounded-full bg-white/[.06]"><div className="h-1 rounded-full" style={{ width: `${Math.max(2, v * 100)}%`, background: bad ? 'rgb(248 113 113)' : 'rgb(var(--club-rgb))' }} /></div>}
          </div>
        );
      })}
    </div>
  );
}

// ── the table, with every club's chances beside its record
export const recordOfRow = (sport: Sport, c: SportClubRow) => (sport === 'soccer' ? `${c.w}-${c.d}-${c.l}` : `${c.w}-${c.l}${c.d ? `-${c.d}` : ''}`);
export function RaceTable({ l, out, highlight, conf, grades }: { l: SportLeague; out: Outlook | null; highlight?: string; conf?: string | null; grades?: Table['grades'] | null }) {
  const soccer = l.sport === 'soccer';
  const rows = l.clubs.filter((c) => conf == null || c.conf === conf);
  const sorted = soccer ? [...rows].sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99))
    : [...rows].sort((a, b) => (out ? out.chances[b.code].playoffs - out.chances[a.code].playoffs : 0) || (b.w + b.d / 2) / Math.max(1, b.gp) - (a.w + a.d / 2) / Math.max(1, a.gp));
  const cols: [keyof Chances, string][] = soccer ? [['title', 'Title'], ['top4', 'Top 4'], ['relegated', 'Down']] : [['playoffs', 'Playoffs'], [l.sport === 'football' ? 'division' : 'top6', l.sport === 'football' ? 'Div.' : 'Top 6'], ['title', 'Title']];
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[.06] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-mute">
        <span className="w-5 text-center">#</span>
        <span className="min-w-0 flex-1">Club</span>
        <span className="num w-14 text-right">{soccer ? 'W-D-L' : 'Record'}</span>
        {soccer && <span className="num w-8 text-right">Pts</span>}
        {cols.map(([, h]) => <span key={h} className="num w-11 text-right">{h}</span>)}
      </div>
      <div className="divide-y divide-white/[.05]">
        {sorted.map((c, i) => {
          const ch = out?.chances[c.code];
          const me = c.code === highlight;
          return (
            <Link key={c.code} to={zonePath(l.league, c.code)} className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/[.03] ${me ? 'bg-white/[.06]' : ''}`} style={me ? { boxShadow: 'inset 3px 0 0 rgb(var(--club-rgb))' } : undefined}>
              <span className="num w-5 text-center text-xs font-bold text-mute">{soccer ? c.seed ?? i + 1 : i + 1}</span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <ClubMark league={l.league} code={c.code} logo={c.logo} size={22} />
                <span className={`truncate ${me ? 'font-bold text-white' : 'text-slate-200'}`}>{c.short ?? c.name}</span>
                {grades?.[c.code] && <span className="hidden shrink-0 rounded-md bg-white/[.06] px-1 text-[10px] font-bold text-slate-300 min-[400px]:inline">{grades[c.code].grade}</span>}
              </span>
              <span className="num w-14 text-right text-[12px] text-slate-300">{recordOfRow(l.sport, c)}</span>
              {soccer && <span className="num w-8 text-right font-bold text-white">{c.pts ?? 0}</span>}
              {cols.map(([k, h]) => {
                const v = ch ? (ch[k] as number) : null;
                return <span key={h} className={`num w-11 text-right text-[12px] font-semibold ${v == null ? 'text-mute' : k === 'relegated' ? (v >= 0.25 ? 'text-red-300' : 'text-slate-300') : v >= 0.5 ? 'text-white' : 'text-slate-400'}`}>{v == null ? '…' : chance(v)}</span>;
              })}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── the leaders: each category's top few, with a face where the feed has one
export function LeaderBoards({ l, cats, n = 5 }: { l: SportLeague; cats?: string[]; n?: number }) {
  const clubs = new Map(l.clubs.map((c) => [c.code, c]));
  const shown = (cats ? cats.map((k) => l.leaders.find((c) => c.cat === k)).filter((c): c is SportLeague['leaders'][number] => !!c) : l.leaders).filter((c) => c.rows.length);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {shown.map((c) => (
        <div key={c.cat} className="card p-3">
          <div className="label">{c.name.replace(/ Leaders?$/, '')}</div>
          <ol className="mt-1.5 space-y-1.5">
            {c.rows.slice(0, n).map((r, i) => (
              <li key={`${r.id}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="num w-4 text-center text-[11px] font-bold text-mute">{i + 1}</span>
                {r.headshot ? <img src={r.headshot} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded-full bg-white/[.06] object-cover" /> : r.team ? <ClubMark league={l.league} code={r.team} logo={clubs.get(r.team)?.logo} size={22} /> : <span className="h-7 w-7" />}
                <span className="min-w-0 flex-1 truncate text-slate-200">{r.name}{r.team && <span className="text-mute"> · {r.team}</span>}</span>
                <span className="num font-bold text-white">{shownValue(l.sport, r.value, r.display)}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

// a leader's number: the feed's own display, unless it rounded a half away (7.5 sacks shown as 8)
export const shownValue = (sport: Sport, value: number, display: string) =>
  (sport === 'soccer' ? String(value) : !Number.isInteger(value) && /^\d+$/.test(display) ? value.toFixed(1) : display);

// a kick-off in the reader's own time
export const kickoff = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const dayOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
