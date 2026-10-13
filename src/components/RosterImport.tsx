import { useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { Sheet, useAction } from './ui';
import { normName, playerMatcher, type ImportTeam } from '../lib/rosterMatch';

// A league that played elsewhere brings its rosters with it (docs/SUPERPOOLS.md item 9, imports: rosters next; migration
// 256). The other site's public API answers any website with each team's players, so the commissioner pastes the
// league's link and every team comes back with its players matched to ours by name and club (src/lib/rosterMatch.ts).
// Other sites count forwards where we have centres and wings, so everyone lands on the bench (IR stays IR) and the
// first lineup sorts the starters. Each team written is replaced whole, so the import can be run again after a fix;
// what the other site has that we don't (a prospect in the minors, a name spelt another way) is listed and left out,
// and the GM adds him from the Players page. One sheet, a reader per site (FantraxRosters, EspnRosters).
export interface RosterSource {
  key: string; mark: string; title: string; blurb: string; sheet: string; label: string; placeholder: string;
  // a site the GM is already signed into (Yahoo) needs no link: the sheet reads the league it was opened for
  noLink?: boolean;
  // the site's rosters at that link, matched with the matcher given; 'missing' means no league at the link, 'private' a
  // league its manager hasn't made viewable
  read: (link: string, match: (name: string, club: string | null) => number | null) => Promise<{ name: string; note: string | null; teams: ImportTeam[] }>;
  foot: string;
}

export function RosterImport({ source }: { source: RosterSource }) {
  const { league, teams, players, draft, refresh, kind } = useLeague();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState<{ name: string; note: string | null; teams: ImportTeam[] } | null>(null);
  // each team there, the team here it is (0: leave it out)
  const [who, setWho] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  if (!league || kind === 'predict') return null;
  const mine = teams.filter((t) => t.role === 'gm');
  const draftOn = draft?.status === 'live' || draft?.status === 'paused';
  // the roster here, less IR: a team bigger than this is refused by the database, so it is said before the button
  const max = Object.entries((league.roster as Record<string, number>) ?? {}).filter(([k]) => k !== 'IR').reduce((t, [, v]) => t + (v ?? 0), 0);

  const find = async () => {
    if (!link.trim() && !source.noLink) return;
    setErr(null); setFound(null); setLoading(true);
    try {
      const got = await source.read(link, playerMatcher(players));
      if (!got.teams.length) throw new Error('missing');
      got.teams.sort((a, b) => a.name.localeCompare(b.name));
      setFound(got);
      const w: Record<string, number> = {};
      const used = new Set<number>();
      for (const t of got.teams) { const m = mine.find((y) => normName(y.name) === normName(t.name) && !used.has(y.id)); w[t.id] = m?.id ?? 0; if (m) used.add(m.id); }
      setWho(w);
    } catch (e) {
      const m = (e as Error).message;
      setErr(m === 'missing' ? `${source.title} has no league at that link. Open the league there and copy the address from the browser.`
        : m === 'private' ? `That league is private. Its manager makes it viewable to the public in its settings on ${source.title}, and then it reads.`
        : m === 'link' ? source.label : `Couldn’t read ${source.title}: ${m}`);
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
  }, `${matched} players on ${going.length} team${going.length === 1 ? '' : 's'}, from ${source.title}`);

  return (
    <>
      <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-dashed border-sky-400/30 bg-sky-500/[.06] p-3 text-left transition hover:bg-sky-500/10" onClick={() => { setOpen(true); setErr(null); }}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-500/20 text-[10px] font-black tracking-tight text-sky-100">{source.mark}</span>
        <span className="min-w-0 text-sm"><span className="block font-semibold text-slate-100">Bring the rosters from {source.title}</span><span className="block text-xs text-mute">{source.blurb}</span></span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={source.sheet} wide>
        <div className="space-y-3">
          <div className="space-y-1.5">
            {source.noLink ? <p className="text-xs text-mute">{source.label}</p> : <>
              <label className="block text-xs text-mute" htmlFor={`${source.key}-roster-link`}>{source.label}</label>
              <input id={`${source.key}-roster-link`} className="input w-full font-mono text-xs" placeholder={source.placeholder} value={link} onChange={(e) => setLink(e.target.value)} />
            </>}
            <button type="button" className="btn-primary w-full" disabled={loading || (!link.trim() && !source.noLink)} onClick={find}>{loading ? 'Reading…' : 'Read the rosters'}</button>
          </div>
          {err && <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm leading-snug">{err}</div>}
          {loading && <div className="h-24 animate-pulse rounded-xl bg-white/[.04]" />}
          {found && (
            <div className="space-y-2">
              <p className="text-xs text-mute"><b className="text-slate-200">{found.name}</b>{found.note ? ` · ${found.note}` : ''} · {found.teams.length} teams. Say which team here each one is; a team left out keeps what it has.</p>
              <ul className="space-y-2">
                {found.teams.map((t) => {
                  const ok = t.picks.filter((p) => p.player_id), miss = t.picks.filter((p) => !p.player_id), on = who[t.id] > 0;
                  const skaters = ok.filter((p) => !p.ir).length;
                  const named = miss.filter((p) => p.name), gone = miss.length - named.length;
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
                      {miss.length > 0 && <div className="mt-1 break-words text-[11px] text-mute">Not here: {named.map((p) => p.name).join(', ')}{gone ? `${named.length ? ', and ' : ''}${gone} ${source.title} no longer lists` : ''}</div>}
                    </li>
                  );
                })}
              </ul>
              {twice && <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm leading-snug">Two teams there point at the same team here. Pick one for each.</div>}
              {over.length > 0 && <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm leading-snug">{over.map((t) => t.name).join(', ')} {over.length === 1 ? 'has' : 'have'} more players than the roster here holds ({max}, IR aside). Raise the roster above, or leave {over.length === 1 ? 'it' : 'them'} out for now.</div>}
              {draftOn && <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm leading-snug">Not while the draft is on.</div>}
              <button className="btn-gold w-full py-3 text-base" disabled={busy || !going.length || twice || over.length > 0 || draftOn || matched === 0} onClick={write}>Bring in {matched} player{matched === 1 ? '' : 's'} on {going.length} team{going.length === 1 ? '' : 's'}</button>
              <p className="text-[11px] text-mute">Each team written is replaced whole, with everyone on the bench (IR stays IR): {source.foot} A player {source.title} has that isn’t here (a prospect in the minors, a name spelt another way) is left out and can be added from the Players page.</p>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
