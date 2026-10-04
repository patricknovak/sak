import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { historyChanged } from '../lib/history';
import { yahoo, type YLeague, type YStatus } from '../lib/yahoo';
import { Sheet, useAction } from './ui';

// A league that played on Yahoo brings its past in one go: the commissioner picks the Yahoo league, and every season
// Yahoo kept (it links each year's league to the one before) comes back with its final table. The ticked seasons are
// written in as if typed (commish_set_season), teams matched to today's by name or GM so their titles count.
interface YSeason { key: string; name: string; season: string; finished: boolean; scoring: string; teams: { name: string; managers: string[]; rank: number | null; w: number | null; l: number | null; t: number | null; points: number | null }[] }

export function YahooHistory({ have }: { have: Set<string> }) {
  const { league, teams } = useLeague();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<YStatus | null>(null);
  const [leagues, setLeagues] = useState<YLeague[] | null>(null);
  const [picked, setPicked] = useState<YLeague | null>(null);
  const [seasons, setSeasons] = useState<YSeason[] | null>(null);
  const [tick, setTick] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  if (!league) return null;
  const current = league.season;
  const usable = (s: YSeason) => s.finished && s.season < current && s.teams.length >= 2;

  const start = () => {
    setOpen(true); setErr(null); setPicked(null); setSeasons(null);
    yahoo<YStatus>('status').then((s) => {
      setStatus(s);
      if (s.configured && s.connected) yahoo<{ leagues: YLeague[] }>('leagues').then((r) => setLeagues(r.leagues), (e: Error) => setErr(e.message));
    }, (e: Error) => setErr(e.message));
  };
  const pick = (l: YLeague) => {
    setPicked(l); setSeasons(null); setErr(null);
    yahoo<{ seasons: YSeason[] }>('history', { league_key: l.key }).then((r) => {
      setSeasons(r.seasons);
      setTick(new Set(r.seasons.filter((s) => usable(s) && !have.has(s.season)).map((s) => s.season)));
    }, (e: Error) => setErr(e.message));
  };
  const norm = (x: string) => x.trim().toLowerCase();
  const replacing = [...tick].filter((x) => have.has(x)).sort();
  const write = () => (!replacing.length || confirm(`${replacing.join(', ')} ${replacing.length === 1 ? 'is' : 'are'} already in the league’s history. Replace ${replacing.length === 1 ? 'it' : 'them'} with Yahoo’s table?`)) && run(async () => {
    for (const s of (seasons ?? []).filter((x) => tick.has(x.season))) {
      // today's team for each row: an exact team name first, then a manager's name, each team used once a season (two
      // managers sharing a nickname mustn't hand one franchise another's banner)
      const link = new Map<number, number>(), used = new Set<number>();
      s.teams.forEach((t, i) => { const x = teams.find((y) => !used.has(y.id) && norm(y.name) === norm(t.name)); if (x) { link.set(i, x.id); used.add(x.id); } });
      s.teams.forEach((t, i) => {
        if (link.has(i)) return;
        const x = teams.find((y) => !used.has(y.id) && t.managers.some((m) => norm(m) === norm(y.gm_name)));
        if (x) { link.set(i, x.id); used.add(x.id); }
      });
      const rows = s.teams.map((t, i) => ({ team_name: t.name, gm_name: t.managers.join(' & ').slice(0, 40) || 'Unknown', team_id: link.get(i) ?? null,
        points: t.points ?? null, prize: null, last_place: i === s.teams.length - 1 }));
      await rpc('commish_set_season', { p_season: s.season, p_note: `Played on Yahoo as ${s.name}.`, p_rows: rows });
    }
    historyChanged(league.league_id); setOpen(false);
  }, `${tick.size} season${tick.size === 1 ? '' : 's'} brought in from Yahoo`);

  return (
    <>
      <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-dashed border-violet-400/30 bg-violet-500/[.06] p-3 text-left transition hover:bg-violet-500/10" onClick={start}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-lg font-black text-violet-200">Y!</span>
        <span className="min-w-0 text-sm"><span className="block font-semibold text-slate-100">Bring it from Yahoo</span><span className="block text-xs text-mute">Every season your Yahoo league kept, champions to last place, in one go.</span></span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Your past on Yahoo" wide>
        <div className="space-y-3">
          {err && <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm">{err}</div>}
          {!status && !err && <div className="h-20 animate-pulse rounded-xl bg-white/[.04]" />}
          {status && !status.configured && <p className="text-sm text-mute">Yahoo isn’t set up on this site yet. Paste each season’s final table instead.</p>}
          {status?.configured && !status.connected && (
            <div className="space-y-2 text-sm">
              <p className="text-mute">Connect your Yahoo account first (it only reads your leagues), then come back here.</p>
              <Link to="/yahoo" className="btn-primary w-full">Connect Yahoo</Link>
            </div>
          )}
          {status?.connected && !picked && (
            !leagues ? <div className="h-20 animate-pulse rounded-xl bg-white/[.04]" />
              : !leagues.length ? <p className="text-sm text-mute">No Yahoo hockey leagues on this account.</p>
              : <div className="space-y-1.5">
                  <p className="text-xs text-mute">Which league is this one? Pick its latest season; the years before come with it.</p>
                  {leagues.map((l) => (
                    <button key={l.key} type="button" className="card flex w-full items-center gap-3 p-3 text-left transition active:scale-[.98]" onClick={() => pick(l)}>
                      {l.logo ? <img src={l.logo} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-500/20 font-black text-violet-200">Y!</span>}
                      <span className="min-w-0 flex-1"><span className="block break-words font-semibold">{l.name}</span><span className="block text-xs text-mute">{l.season} · {l.teams} teams{l.me ? ` · you: ${l.me.name}` : ''}</span></span>
                    </button>
                  ))}
                </div>
          )}
          {picked && !seasons && !err && <div className="space-y-2"><p className="text-sm text-mute">Walking back through {picked.name}’s seasons…</p><div className="h-24 animate-pulse rounded-xl bg-white/[.04]" /></div>}
          {picked && seasons && (
            <div className="space-y-2">
              <p className="text-xs text-mute">{seasons.length} season{seasons.length === 1 ? '' : 's'} found. Tick the ones to bring in; a season already written is replaced.</p>
              {seasons.map((s) => {
                const ok = usable(s), on = tick.has(s.season);
                const champ = s.teams[0], last = s.teams[s.teams.length - 1];
                return (
                  <label key={s.key} className={`flex items-start gap-3 rounded-xl border p-3 ${on ? 'border-gold/40 bg-gold/[.06]' : 'border-white/10 bg-white/[.03]'} ${ok ? '' : 'opacity-60'}`}>
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-amber-400" disabled={!ok} checked={on}
                      onChange={(e) => { const n = new Set(tick); if (e.target.checked) n.add(s.season); else n.delete(s.season); setTick(n); }} />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="flex flex-wrap items-baseline gap-x-2"><span className="num font-display text-lg font-extrabold text-white">{s.season}</span><span className="text-xs text-mute">{s.teams.length} teams{have.has(s.season) ? ' · already written' : ''}</span></span>
                      {!ok ? <span className="block text-xs text-mute">{!s.finished || s.season >= current ? 'Still being played: it’s written when it ends.' : 'No final table.'}</span> : <>
                        <span className="block break-words">🏆 <b>{champ.name}</b> <span className="text-mute">({champ.managers.join(' & ') || 'Unknown'})</span></span>
                        <span className="block break-words text-xs text-mute">Last: {last.name}</span>
                      </>}
                    </span>
                  </label>
                );
              })}
              <div className="flex gap-2">
                <button className="btn-gold flex-1 py-3 text-base" disabled={busy || !tick.size} onClick={write}>Bring in {tick.size} season{tick.size === 1 ? '' : 's'}</button>
                <button className="btn-ghost" onClick={() => { setPicked(null); setSeasons(null); }}>Back</button>
              </div>
              <p className="text-[11px] text-mute">Teams line up by where they finished (after the playoffs in a head-to-head league), and the last one is the season’s last place. Each season stays editable afterwards.</p>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
