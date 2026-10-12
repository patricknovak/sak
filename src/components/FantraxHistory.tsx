import { useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { historyChanged } from '../lib/history';
import { Sheet, useAction } from './ui';

// A league that played on Fantrax brings its past the same way it comes from ESPN (docs/SUPERPOOLS.md item 9, imports
// with history): the commissioner pastes each season's Fantrax link, and every season comes back with its final table,
// written in as if typed (commish_set_season), teams matched to today's by name so their titles count. Fantrax gives a
// new league link each season, so one link is one season. Its public API answers any website, so this needs no server
// of ours; it gives each team's name and finish but not its manager, so the commissioner says which team here each one
// is (Who's who, matched by name to start with), and a team no longer in the league is written with its GM unknown.
type FStanding = { teamName?: string; teamId?: string; rank?: number; points?: string | number; totalPointsFor?: number };
type FInfo = { leagueName?: string; seasonYear?: number; startDate?: string; endDate?: string; scoringSystem?: { type?: string } };
interface Season { season: string; id: string; name: string; finished: boolean; record: boolean; teams: { name: string; points: number | null }[] }

const API = 'https://www.fantrax.com/fxea/general';
// a Fantrax league is a 16-character id, in its links as /league/<id>/ or leagueId=<id>
const idsOf = (s: string) => [...new Set([...s.matchAll(/(?:league\/|leagueId=)([a-z0-9]{16})\b|^\s*([a-z0-9]{16})\s*$/gim)].map((m) => (m[1] ?? m[2]).toLowerCase()))];
// a hockey season is named by the years it spans, read from the day it ends: one ending in April 2018 is 2017-18
const label = (end: string) => { const y = Number(end.slice(0, 4)); return `${y - 1}-${String(y % 100).padStart(2, '0')}`; };

async function fx<T>(call: string, id: string): Promise<T> {
  const r = await fetch(`${API}/${call}?leagueId=${id}`);
  if (!r.ok) throw new Error(`Fantrax answered ${r.status}`);
  const b = await r.json();
  if (b?.error) throw new Error('missing');
  return b as T;
}

// one season's table, in the order the teams finished; the points are the season's total (a points or roto league)
// or its points for (head to head, where the standings column is the record)
async function season(id: string): Promise<Season> {
  const [info, table] = await Promise.all([fx<FInfo>('getLeagueInfo', id), fx<FStanding[]>('getStandings', id)]);
  if (!info.endDate || !Array.isArray(table)) throw new Error('missing');
  const rows = table.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const record = rows.some((t) => /^\d+-\d+/.test(String(t.points ?? '')));
  return {
    season: label(info.endDate), id, name: info.leagueName ?? 'Fantrax league', record,
    finished: new Date(`${info.endDate}T12:00:00Z`).getTime() < Date.now(),
    teams: rows.map((t) => {
      const p = t.totalPointsFor ?? (record ? null : Number(t.points));
      return { name: (t.teamName ?? `Team ${t.teamId ?? ''}`).trim(), points: p == null || !Number.isFinite(p) ? null : Math.round(p * 10) / 10 };
    }),
  };
}

export function FantraxHistory({ have }: { have: Set<string> }) {
  const { league, teams } = useLeague();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState('');
  const [loading, setLoading] = useState(false);
  const [seasons, setSeasons] = useState<Season[] | null>(null);
  const [missed, setMissed] = useState(0);
  const [tick, setTick] = useState<Set<string>>(new Set());
  // each Fantrax team name, the team here it is (0: not in the league now)
  const [who, setWho] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  if (!league) return null;
  const current = league.season;
  const usable = (s: Season) => s.finished && s.season < current && s.teams.length >= 2;
  const names = [...new Set((seasons ?? []).filter((s) => tick.has(s.season)).flatMap((s) => s.teams.map((t) => t.name)))].sort((a, b) => a.localeCompare(b));

  const norm = (x: string) => x.trim().toLowerCase();
  const find = async () => {
    const ids = idsOf(links);
    if (!ids.length) { setErr('Paste a season’s Fantrax link (it has /league/ and the league’s code in it).'); return; }
    setErr(null); setSeasons(null); setLoading(true);
    try {
      const got = await Promise.all(ids.slice(0, 20).map((id) => season(id).catch(() => null)));
      const all = got.filter((x): x is Season => !!x);
      // two links for the same season: the last one pasted wins
      const by = new Map(all.map((s) => [s.season, s]));
      const list = [...by.values()].sort((a, b) => b.season.localeCompare(a.season));
      setMissed(ids.length - all.length);
      if (!list.length) { setErr('Fantrax has no league at that link. Open the league on Fantrax and copy the address from there.'); return; }
      setSeasons(list);
      const w: Record<string, number> = {};
      for (const s of list) for (const t of s.teams) w[t.name] ??= teams.find((y) => norm(y.name) === norm(t.name))?.id ?? 0;
      setWho(w);
      setTick(new Set(list.filter((s) => usable(s) && !have.has(s.season)).map((s) => s.season)));
    } catch (e) {
      setErr(`Couldn’t read Fantrax: ${(e as Error).message}`);
    } finally { setLoading(false); }
  };

  const replacing = [...tick].filter((x) => have.has(x)).sort();
  const write = () => (!replacing.length || confirm(`${replacing.join(', ')} ${replacing.length === 1 ? 'is' : 'are'} already in the league’s history. Replace ${replacing.length === 1 ? 'it' : 'them'} with Fantrax’s table?`)) && run(async () => {
    for (const s of (seasons ?? []).filter((x) => tick.has(x.season))) {
      // today's team for each row as Who's who says, each team used once a season; its GM comes with it
      const used = new Set<number>();
      const rows = s.teams.map((t, i) => {
        const x = teams.find((y) => y.id === who[t.name] && !used.has(y.id));
        if (x) used.add(x.id);
        return { team_name: t.name.slice(0, 60), gm_name: (x?.gm_name ?? 'Unknown').slice(0, 40), team_id: x?.id ?? null,
          points: t.points, prize: null, last_place: i === s.teams.length - 1 };
      });
      await rpc('commish_set_season', { p_season: s.season, p_note: `Played on Fantrax as ${s.name}.`, p_rows: rows });
    }
    historyChanged(league.league_id); setOpen(false);
  }, `${tick.size} season${tick.size === 1 ? '' : 's'} brought in from Fantrax`);

  return (
    <>
      <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-dashed border-sky-400/30 bg-sky-500/[.06] p-3 text-left transition hover:bg-sky-500/10" onClick={() => { setOpen(true); setErr(null); }}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-500/20 text-[10px] font-black tracking-tight text-sky-100">FTX</span>
        <span className="min-w-0 text-sm"><span className="block font-semibold text-slate-100">Bring it from Fantrax</span><span className="block text-xs text-mute">Each season’s final table, champions to last place, from its link.</span></span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Your past on Fantrax" wide>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-xs text-mute" htmlFor="fantrax-links">Each season’s Fantrax link, one a line (Fantrax starts a new league link every season)</label>
            <textarea id="fantrax-links" rows={3} className="input w-full resize-y font-mono text-xs" placeholder={'fantrax.com/fantasy/league/…/standings\nfantrax.com/fantasy/league/…/standings'} value={links} onChange={(e) => setLinks(e.target.value)} />
            <button type="button" className="btn-primary w-full" disabled={loading || !links.trim()} onClick={find}>{loading ? 'Reading…' : 'Find them'}</button>
          </div>
          {err && <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm leading-snug">{err}</div>}
          {loading && <div className="h-24 animate-pulse rounded-xl bg-white/[.04]" />}
          {seasons && (
            <div className="space-y-2">
              <p className="text-xs text-mute">{seasons.length} season{seasons.length === 1 ? '' : 's'} found{missed ? `, ${missed} link${missed === 1 ? '' : 's'} Fantrax didn’t know` : ''}. Tick the ones to bring in; a season already written is replaced.</p>
              {seasons.map((s) => {
                const ok = usable(s), on = tick.has(s.season);
                const champ = s.teams[0], last = s.teams[s.teams.length - 1];
                const known = s.teams.filter((t) => who[t.name]).length;
                return (
                  <label key={s.id} className={`flex items-start gap-3 rounded-xl border p-3 ${on ? 'border-gold/40 bg-gold/[.06]' : 'border-white/10 bg-white/[.03]'} ${ok ? '' : 'opacity-60'}`}>
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-amber-400" disabled={!ok} checked={on}
                      onChange={(e) => { const n = new Set(tick); if (e.target.checked) n.add(s.season); else n.delete(s.season); setTick(n); }} />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="flex flex-wrap items-baseline gap-x-2"><span className="num font-display text-lg font-extrabold text-white">{s.season}</span><span className="text-xs text-mute">{s.teams.length} teams{have.has(s.season) ? ' · already written' : ''}</span></span>
                      <span className="block break-words text-xs text-mute">{s.name}</span>
                      {!ok ? <span className="block text-xs text-mute">{!s.finished || s.season >= current ? 'Still being played: it’s written when it ends.' : 'No final table.'}</span> : <>
                        <span className="block break-words">🏆 <b>{champ.name}</b>{champ.points != null && <span className="text-mute"> · {champ.points}{s.record ? ' points for' : ''}</span>}</span>
                        <span className="block break-words text-xs text-mute">Last: {last.name}</span>
                        <span className="block text-[11px] text-mute">{known} of {s.teams.length} teams are teams here</span>
                      </>}
                    </span>
                  </label>
                );
              })}
              {names.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-white/[.03]">
                  <div className="border-b border-white/[.06] px-3 py-2"><div className="text-sm font-semibold text-slate-100">Who’s who</div><div className="text-[11px] text-mute">Which team here was each one? Their titles and last places follow the team.</div></div>
                  <ul className="divide-y divide-white/[.05]">
                    {names.map((n) => (
                      <li key={n} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                        <span className="min-w-0 flex-1 basis-32 break-words text-sm font-semibold text-white">{n}</span>
                        <select className="input w-auto min-w-0 max-w-full py-1.5 text-sm" value={who[n] ?? 0} aria-label={`Team here for ${n}`} onChange={(e) => setWho({ ...who, [n]: Number(e.target.value) })}>
                          <option value={0}>Not in the league now</option>
                          {teams.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.gm_name})</option>)}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button className="btn-gold w-full py-3 text-base" disabled={busy || !tick.size} onClick={write}>Bring in {tick.size} season{tick.size === 1 ? '' : 's'}</button>
              <p className="text-[11px] text-mute">Teams line up by where Fantrax ranks them in the season’s standings, and the last one is the season’s last place. Fantrax doesn’t share who managed each team, so a team not in the league now comes in with its GM unknown. Each season stays editable afterwards.</p>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
