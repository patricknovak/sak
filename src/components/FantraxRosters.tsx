import { useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { Sheet, useAction } from './ui';

// A league that played on Fantrax brings its rosters with it (docs/SUPERPOOLS.md item 9, imports: rosters next; migration
// 256). Fantrax's public API answers any website with each team's players for the current period and a map of its
// player ids to names and clubs, so the commissioner pastes the league's link and every team comes back with its
// players matched to ours by name and club. Fantrax counts forwards where we have centres and wings, so everyone lands on
// the bench (IR stays IR) and the first lineup sorts the starters. Each team written is replaced whole, so the import
// can be run again after a fix; what Fantrax has that we don't (a prospect in the minors, a name spelt another way) is
// listed and left out, and the GM adds him from the Players page.
type FItem = { id: string; position?: string; status?: string };
type FRosters = { period?: number; rosters?: Record<string, { teamName?: string; rosterItems?: FItem[] }> };
type FPlayer = { name?: string; team?: string; position?: string };
interface Pick { fid: string; name: string; club: string | null; ir: boolean; player_id: number | null }
interface FTeam { id: string; name: string; picks: Pick[] }

const API = 'https://www.fantrax.com/fxea/general';
// a Fantrax league is a 16-character id, in its links as /league/<id>/ or leagueId=<id>
const idOf = (s: string) => (s.match(/(?:league\/|leagueId=)([a-z0-9]{16})\b/i) ?? s.match(/^\s*([a-z0-9]{16})\s*$/i))?.[1]?.toLowerCase() ?? null;
// a name as it is matched: no accents, no punctuation, lower case, one space between words
const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Fantrax writes "Last, First"; ours is "First Last"
const firstLast = (n: string) => { const [last, first] = n.split(',').map((x) => x.trim()); return first ? `${first} ${last}` : n.trim(); };

async function fx<T>(call: string, q: string): Promise<T> {
  const r = await fetch(`${API}/${call}?${q}`);
  if (!r.ok) throw new Error(`Fantrax answered ${r.status}`);
  const b = await r.json();
  if (b?.error) throw new Error('missing');
  return b as T;
}

export function FantraxRosters() {
  const { league, teams, players, draft, refresh, kind } = useLeague();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState<{ name: string; period: number | null; teams: FTeam[] } | null>(null);
  // each Fantrax team, the team here it is (0: leave it out)
  const [who, setWho] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  if (!league || kind === 'predict') return null;
  const mine = teams.filter((t) => t.role === 'gm');
  const draftOn = draft?.status === 'live' || draft?.status === 'paused';
  // the roster here, less IR: a team bigger than this is refused by the database, so it is said before the button
  const max = Object.entries((league.roster as Record<string, number>) ?? {}).filter(([k]) => k !== 'IR').reduce((t, [, v]) => t + (v ?? 0), 0);

  const find = async () => {
    const id = idOf(link);
    if (!id) { setErr('Paste the league’s Fantrax link (it has /league/ and the league’s code in it).'); return; }
    setErr(null); setFound(null); setLoading(true);
    try {
      const [info, ro, ids] = await Promise.all([
        fx<{ leagueName?: string }>('getLeagueInfo', `leagueId=${id}`), fx<FRosters>('getTeamRosters', `leagueId=${id}`), fx<Record<string, FPlayer>>('getPlayerIds', 'sport=NHL'),
      ]);
      if (!ro.rosters) throw new Error('missing');
      // ours by name, then by last name and first initial with the club, for a Fantrax spelling that differs
      const byName = new Map<string, number[]>(), byShort = new Map<string, number[]>();
      for (const p of players.values()) {
        const n = norm(p.name); byName.set(n, [...(byName.get(n) ?? []), p.id]);
        const parts = n.split(' '); const s = `${parts[0]?.[0] ?? ''} ${parts[parts.length - 1]} ${p.nhl_team ?? ''}`;
        byShort.set(s, [...(byShort.get(s) ?? []), p.id]);
      }
      const match = (name: string, club: string | null): number | null => {
        const n = norm(name);
        const c = byName.get(n) ?? [];
        if (c.length === 1) return c[0];
        if (c.length > 1) return c.find((id) => players.get(id)?.nhl_team === club) ?? c[0];
        const parts = n.split(' ');
        const s = byShort.get(`${parts[0]?.[0] ?? ''} ${parts[parts.length - 1]} ${club ?? ''}`) ?? [];
        return s.length === 1 ? s[0] : null;
      };
      const list: FTeam[] = Object.entries(ro.rosters).map(([tid, t]) => ({
        id: tid, name: (t.teamName ?? 'Team').trim(),
        picks: (t.rosterItems ?? []).map((it) => {
          const p = ids[it.id];
          // a player Fantrax no longer lists (retired, or long out of the league) has an id and no name
          const name = p?.name ? firstLast(p.name) : '';
          const club = p?.team ?? null;
          return { fid: it.id, name, club, ir: /INJ/i.test(it.status ?? ''), player_id: p?.name ? match(name, club) : null };
        }),
      })).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) throw new Error('missing');
      setFound({ name: info.leagueName ?? 'Fantrax league', period: ro.period ?? null, teams: list });
      const w: Record<string, number> = {};
      const used = new Set<number>();
      for (const t of list) { const m = mine.find((y) => norm(y.name) === norm(t.name) && !used.has(y.id)); w[t.id] = m?.id ?? 0; if (m) used.add(m.id); }
      setWho(w);
    } catch (e) {
      setErr((e as Error).message === 'missing' ? 'Fantrax has no league at that link. Open the league on Fantrax and copy the address from there.' : `Couldn’t read Fantrax: ${(e as Error).message}`);
    } finally { setLoading(false); }
  };

  const going = (found?.teams ?? []).filter((t) => who[t.id] > 0);
  // the same team here picked twice would write one over the other: say so instead
  const twice = going.some((t, i) => going.findIndex((u) => who[u.id] === who[t.id]) !== i);
  const over = going.filter((t) => t.picks.filter((p) => p.player_id && !p.ir).length > max);
  const matched = going.reduce((n, t) => n + t.picks.filter((p) => p.player_id).length, 0);
  const write = () => run(async () => {
    await rpc('commish_import_rosters', { p_teams: going.map((t) => ({ team_id: who[t.id], players: t.picks.filter((p) => p.player_id).map((p) => ({ player_id: p.player_id, slot: p.ir ? 'IR' : 'BN' })) })) });
    await refresh(['rosters']);
    setOpen(false);
  }, `${matched} players on ${going.length} team${going.length === 1 ? '' : 's'}, from Fantrax`);

  return (
    <>
      <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-dashed border-sky-400/30 bg-sky-500/[.06] p-3 text-left transition hover:bg-sky-500/10" onClick={() => { setOpen(true); setErr(null); }}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-500/20 text-[10px] font-black tracking-tight text-sky-100">FTX</span>
        <span className="min-w-0 text-sm"><span className="block font-semibold text-slate-100">Bring the rosters from Fantrax</span><span className="block text-xs text-mute">Every team’s players from the league’s link, matched by name and club.</span></span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Your rosters on Fantrax" wide>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-xs text-mute" htmlFor="fantrax-roster-link">The league’s Fantrax link</label>
            <input id="fantrax-roster-link" className="input w-full font-mono text-xs" placeholder="fantrax.com/fantasy/league/…/team/roster" value={link} onChange={(e) => setLink(e.target.value)} />
            <button type="button" className="btn-primary w-full" disabled={loading || !link.trim()} onClick={find}>{loading ? 'Reading…' : 'Read the rosters'}</button>
          </div>
          {err && <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm leading-snug">{err}</div>}
          {loading && <div className="h-24 animate-pulse rounded-xl bg-white/[.04]" />}
          {found && (
            <div className="space-y-2">
              <p className="text-xs text-mute"><b className="text-slate-200">{found.name}</b>{found.period ? ` · period ${found.period}` : ''} · {found.teams.length} teams. Say which team here each one is; a team left out keeps what it has.</p>
              <ul className="space-y-2">
                {found.teams.map((t) => {
                  const ok = t.picks.filter((p) => p.player_id), miss = t.picks.filter((p) => !p.player_id), on = who[t.id] > 0;
                  const skaters = ok.filter((p) => !p.ir).length;
                  return (
                    <li key={t.id} className={`rounded-xl border p-3 ${on ? 'border-gold/40 bg-gold/[.06]' : 'border-white/10 bg-white/[.03]'}`}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="min-w-0 flex-1 basis-32 break-words text-sm font-semibold text-white">{t.name}</span>
                        <select className="input w-auto min-w-0 max-w-full py-1.5 text-sm" value={who[t.id] ?? 0} aria-label={`Team here for ${t.name}`} onChange={(e) => setWho({ ...who, [t.id]: Number(e.target.value) })}>
                          <option value={0}>Leave it out</option>
                          {mine.map((y) => <option key={y.id} value={y.id}>{y.name} ({y.gm_name})</option>)}
                        </select>
                      </div>
                      <div className="mt-1.5 text-xs text-mute">
                        <span className={skaters > max && on ? 'font-semibold text-red-300' : ''}>{ok.length} of {t.picks.length} players matched{skaters > max && on ? ` · ${skaters} for a roster of ${max}` : ''}</span>
                        {ok.some((p) => p.ir) && <span> · {ok.filter((p) => p.ir).length} on IR</span>}
                      </div>
                      {miss.length > 0 && (() => {
                        const named = miss.filter((p) => p.name), gone = miss.length - named.length;
                        return <div className="mt-1 break-words text-[11px] text-mute">Not here: {named.map((p) => p.name).join(', ')}{gone ? `${named.length ? ', and ' : ''}${gone} Fantrax no longer lists` : ''}</div>;
                      })()}
                    </li>
                  );
                })}
              </ul>
              {twice && <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm leading-snug">Two Fantrax teams point at the same team here. Pick one for each.</div>}
              {over.length > 0 && <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm leading-snug">{over.map((t) => t.name).join(', ')} {over.length === 1 ? 'has' : 'have'} more players than the roster here holds ({max}, IR aside). Raise the roster above, or leave {over.length === 1 ? 'it' : 'them'} out for now.</div>}
              {draftOn && <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm leading-snug">Not while the draft is on.</div>}
              <button className="btn-gold w-full py-3 text-base" disabled={busy || !going.length || twice || over.length > 0 || draftOn || matched === 0} onClick={write}>Bring in {matched} player{matched === 1 ? '' : 's'} on {going.length} team{going.length === 1 ? '' : 's'}</button>
              <p className="text-[11px] text-mute">Each team written is replaced whole, with everyone on the bench (IR stays IR): Fantrax counts forwards where we have centres and wings, so the first lineup sorts the starters. A player Fantrax has that isn’t here (a prospect in the minors, a name spelt another way) is left out and can be added from the Players page.</p>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
