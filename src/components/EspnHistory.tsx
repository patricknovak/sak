import { useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { historyChanged } from '../lib/history';
import { Sheet, useAction } from './ui';

// A league that played on ESPN brings its past in one go (docs/SUPERPOOLS.md item 9, imports with history): the
// commissioner pastes the ESPN league's link or number, and every season ESPN kept comes back with its final table,
// written in as if typed (commish_set_season), teams matched to today's by name or GM so their titles count, the same
// way the Yahoo import does. ESPN's fantasy API answers any website for a league its manager made viewable to the
// public, so this needs no server of ours; a private league is asked to open up first.
type ETeam = { id: number; name?: string; location?: string; nickname?: string; owners?: string[]; rankCalculatedFinal?: number; playoffSeed?: number; points?: number; record?: { overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number } } };
type EMember = { id: string; displayName?: string; firstName?: string; lastName?: string };
type ELeague = { seasonId: number; settings?: { name?: string }; teams?: ETeam[]; members?: EMember[]; status?: { previousSeasons?: number[]; isActive?: boolean } };
interface Season { season: string; year: number; name: string; finished: boolean; teams: { name: string; managers: string[]; points: number | null }[] }

const API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl';
const VIEWS = 'view=mTeam&view=mSettings&view=mStandings';
// ESPN names a season by the year it ends: 2026 is 2025-26
const label = (y: number) => `${y - 1}-${String(y % 100).padStart(2, '0')}`;
const idOf = (s: string) => (s.match(/leagueId=(\d+)/i)?.[1] ?? s.match(/^\s*(\d{3,12})\s*$/)?.[1] ?? null);

async function espn(path: string): Promise<ELeague | null> {
  const r = await fetch(`${API}/${path}`);
  if (r.status === 401 || r.status === 403) throw new Error('private');
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`ESPN answered ${r.status}`);
  const b = await r.json();
  return (Array.isArray(b) ? b[0] : b) ?? null;
}

// one season's table, in the order the teams finished (the final rank after the playoffs, else the record)
function table(l: ELeague, finished: boolean): Season {
  const who = new Map((l.members ?? []).map((m) => [m.id, m.displayName || [m.firstName, m.lastName].filter(Boolean).join(' ') || 'Unknown']));
  const rows = (l.teams ?? []).map((t) => ({
    name: (t.name || [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`).trim(),
    managers: (t.owners ?? []).map((o) => who.get(o) ?? '').filter(Boolean),
    points: t.points ?? t.record?.overall?.pointsFor ?? null,
    rank: t.rankCalculatedFinal || t.playoffSeed || 99,
    w: t.record?.overall?.wins ?? 0,
  }));
  rows.sort((a, b) => a.rank - b.rank || b.w - a.w || (b.points ?? 0) - (a.points ?? 0));
  return { season: label(l.seasonId), year: l.seasonId, name: l.settings?.name ?? 'ESPN league', finished, teams: rows.map(({ name, managers, points }) => ({ name, managers, points })) };
}

export function EspnHistory({ have }: { have: Set<string> }) {
  const { league, teams } = useLeague();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [seasons, setSeasons] = useState<Season[] | null>(null);
  const [tick, setTick] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  if (!league) return null;
  const current = league.season;
  const usable = (s: Season) => s.finished && s.season < current && s.teams.length >= 2;

  // the league's latest season first: it lists the years before it, each read from ESPN's history
  const find = async () => {
    const id = idOf(link);
    if (!id) { setErr('Paste the league’s ESPN link (it has leagueId= in it) or its number.'); return; }
    setErr(null); setSeasons(null); setLoading(true);
    try {
      const now = new Date();
      const thisYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
      let latest: ELeague | null = null;
      for (const y of [thisYear, thisYear - 1]) { latest = await espn(`seasons/${y}/segments/0/leagues/${id}?${VIEWS}`); if (latest) break; }
      if (!latest) { setErr('ESPN has no hockey league with that number. Check the link from the league’s page on ESPN.'); return; }
      const past = await Promise.all((latest.status?.previousSeasons ?? []).map((y) => espn(`leagueHistory/${id}?seasonId=${y}&${VIEWS}`).catch(() => null)));
      const all = [table(latest, latest.status?.isActive === false), ...past.filter((x): x is ELeague => !!x).map((l) => table(l, true))]
        .sort((a, b) => b.year - a.year);
      setSeasons(all);
      setTick(new Set(all.filter((s) => usable(s) && !have.has(s.season)).map((s) => s.season)));
    } catch (e) {
      setErr((e as Error).message === 'private'
        ? 'This ESPN league is private. Its manager can open it to read: on ESPN, League › Settings › Basic Settings, turn on “Make league viewable to public”, then try again.'
        : `Couldn’t read ESPN: ${(e as Error).message}`);
    } finally { setLoading(false); }
  };

  const norm = (x: string) => x.trim().toLowerCase();
  const replacing = [...tick].filter((x) => have.has(x)).sort();
  const write = () => (!replacing.length || confirm(`${replacing.join(', ')} ${replacing.length === 1 ? 'is' : 'are'} already in the league’s history. Replace ${replacing.length === 1 ? 'it' : 'them'} with ESPN’s table?`)) && run(async () => {
    for (const s of (seasons ?? []).filter((x) => tick.has(x.season))) {
      // today's team for each row: an exact team name first, then a manager's name, each team used once a season
      const linked = new Map<number, number>(), used = new Set<number>();
      s.teams.forEach((t, i) => { const x = teams.find((y) => !used.has(y.id) && norm(y.name) === norm(t.name)); if (x) { linked.set(i, x.id); used.add(x.id); } });
      s.teams.forEach((t, i) => {
        if (linked.has(i)) return;
        const x = teams.find((y) => !used.has(y.id) && t.managers.some((m) => norm(m) === norm(y.gm_name)));
        if (x) { linked.set(i, x.id); used.add(x.id); }
      });
      const rows = s.teams.map((t, i) => ({ team_name: t.name.slice(0, 60), gm_name: t.managers.join(' & ').slice(0, 40) || 'Unknown', team_id: linked.get(i) ?? null,
        points: t.points ?? null, prize: null, last_place: i === s.teams.length - 1 }));
      await rpc('commish_set_season', { p_season: s.season, p_note: `Played on ESPN as ${s.name}.`, p_rows: rows });
    }
    historyChanged(league.league_id); setOpen(false);
  }, `${tick.size} season${tick.size === 1 ? '' : 's'} brought in from ESPN`);

  return (
    <>
      <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-dashed border-red-400/30 bg-red-500/[.06] p-3 text-left transition hover:bg-red-500/10" onClick={() => { setOpen(true); setErr(null); }}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-500/20 text-[11px] font-black text-red-100">ESPN</span>
        <span className="min-w-0 text-sm"><span className="block font-semibold text-slate-100">Bring it from ESPN</span><span className="block text-xs text-mute">Every season your ESPN league kept, champions to last place, from its link.</span></span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Your past on ESPN" wide>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-xs text-mute" htmlFor="espn-link">The league’s ESPN link, or its number</label>
            <div className="flex gap-2">
              <input id="espn-link" className="input min-w-0 flex-1" inputMode="url" placeholder="fantasy.espn.com/hockey/league?leagueId=…" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') find(); }} />
              <button type="button" className="btn-primary shrink-0" disabled={loading || !link.trim()} onClick={find}>{loading ? 'Reading…' : 'Find it'}</button>
            </div>
          </div>
          {err && <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm leading-snug">{err}</div>}
          {loading && <div className="h-24 animate-pulse rounded-xl bg-white/[.04]" />}
          {seasons && (
            <div className="space-y-2">
              <p className="text-xs text-mute">{seasons.length} season{seasons.length === 1 ? '' : 's'} found. Tick the ones to bring in; a season already written is replaced.</p>
              {seasons.map((s) => {
                const ok = usable(s), on = tick.has(s.season);
                const champ = s.teams[0], last = s.teams[s.teams.length - 1];
                return (
                  <label key={s.year} className={`flex items-start gap-3 rounded-xl border p-3 ${on ? 'border-gold/40 bg-gold/[.06]' : 'border-white/10 bg-white/[.03]'} ${ok ? '' : 'opacity-60'}`}>
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
              <button className="btn-gold w-full py-3 text-base" disabled={busy || !tick.size} onClick={write}>Bring in {tick.size} season{tick.size === 1 ? '' : 's'}</button>
              <p className="text-[11px] text-mute">Teams line up by where they finished (the final rank after the playoffs), and the last one is the season’s last place. Each season stays editable afterwards.</p>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
