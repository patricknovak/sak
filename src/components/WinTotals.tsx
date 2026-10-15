// Season win totals (migration 297): every team's wins for the season against a line. Before the opener each member
// calls over or under on as many as they like, a point for each right call. A call is decided the moment it can't
// change: an over once the team has passed its line, an under once it can't reach it with the games it has left; a
// whole-number line hit exactly is a push, for nobody. Once the calls lock everyone's show, with the pool's split on
// each line, each team's record and its pace.
import { useState } from 'react';
import { Check, Lock, Minus, Plus, X } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { trackFirstCall } from '../lib/analytics';
import { Crest } from './Crest';
import { Section, useAction } from './ui';
import { ShareButton, useCardBrand } from './ShareButton';
import { shareCard } from '../lib/shareCard';
import type { Club } from '../pages/Picks';

type Call = 'O' | 'U';
export interface WinsClub extends Club {
  line: number; w: number; l: number; d: number; left: number; decided: Call | 'P' | null;
  over: number | null; under: number | null; calls: { team_id: number; call: Call }[] | null;
}
export interface WinsData {
  locks_at: string | null; locked: boolean; games: number; edited: boolean; source: string | null;
  players: number; called: number; decided: number; mine: Record<string, Call>; clubs: WinsClub[];
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
// the pace: wins so far over games played, across the whole season
const pace = (c: WinsClub, games: number) => { const gp = c.w + c.l + c.d; return gp ? Math.round((c.w / gp) * games) : null; };

export function WinsGame({ gameId, data, status, reload, actAs }: { gameId: number; data: WinsData; status: 'open' | 'done'; reload: () => void; actAs?: { team: number; name: string } }) {
  const { me, teams } = useLeague();
  const { busy, run } = useAction();
  const cardBrand = useCardBrand();
  const saved = actAs ? {} : data.mine;
  const [draft, setDraft] = useState<Record<string, Call> | null>(null);
  const calls = draft ?? saved;
  const [lines, setLines] = useState<Record<string, number> | null>(null);
  const canCall = status === 'open' && !data.locked && (me?.role === 'gm' || !!actAs);
  // the host's line editor, open only while the lines can still change
  const editing = !!lines && !data.locked && status === 'open';
  const n = data.clubs.length;
  const made = Object.keys(calls).length;
  const dirty = draft != null && JSON.stringify(Object.entries(draft).sort()) !== JSON.stringify(Object.entries(saved).sort());
  const tap = (id: number, side: Call) => setDraft((d) => { const x = { ...(d ?? saved) }; if (x[id] === side) delete x[id]; else x[id] = side; return x; });
  const save = () => run(async () => {
    if (actAs) await rpc('pool_host_pick', { p_game: gameId, p_team: actAs.team, p_pick: { thing: 'wins', pick: { calls, merge: true } } });
    else { await rpc('pool_game_pick', { p_game: gameId, p_thing: 'wins', p_pick: { calls } }); trackFirstCall('wins'); }
    setDraft(null); reload();
  }, actAs ? `${actAs.name}'s calls are in` : 'Your calls are in');
  // the host's lines, a half-win at a time; only the ones changed are sent
  const lineOf = (c: WinsClub) => lines?.[c.id] ?? c.line;
  const linesChanged = lines ? Object.entries(lines).filter(([id, v]) => data.clubs.find((c) => c.id === Number(id))?.line !== v) : [];
  const saveLines = () => run(async () => {
    await rpc('pool_game_set_rules', { p_game: gameId, p_rules: { lines: Object.fromEntries(linesChanged) } });
    setLines(null); reload();
  }, 'The lines are set');
  const step = (c: WinsClub, by: number) => setLines((l) => ({ ...(l ?? {}), [c.id]: Math.min(data.games - 0.5, Math.max(0.5, lineOf(c) + by)) }));
  const right = data.clubs.filter((c) => saved[c.id] && c.decided === saved[c.id]).length;
  const wrong = data.clubs.filter((c) => saved[c.id] && c.decided && c.decided !== 'P' && c.decided !== saved[c.id]).length;
  const shareMine = () => shareCard({ kind: 'sheet', eyebrow: 'My win totals', brand: cardBrand, who: '', title: `${Object.keys(saved).length} calls on the season`,
    score: data.decided ? `${right} right, ${wrong} wrong` : 'Every call locked in',
    rows: data.clubs.filter((c) => saved[c.id]).map((c) => ({ q: `${c.short ?? c.name} ${fmt(c.line)}`, answer: saved[c.id] === 'O' ? 'Over' : 'Under',
      right: c.decided == null || c.decided === 'P' ? null : c.decided === saved[c.id] })) }, `My win totals: ${Object.keys(saved).length} calls on the season.`);

  return (
    <div className="space-y-4">
      <div className="card-hero relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/15 blur-2xl" />
        <div className="relative flex items-center gap-4">
          <div className="text-center">
            <div className="num text-4xl font-black text-white">{data.locked ? right : made}<span className="text-lg text-mute">/{data.locked ? Object.keys(saved).length || n : n}</span></div>
            <div className="text-[10px] font-bold uppercase tracking-[.16em] text-mute">{data.locked ? 'Right' : 'Called'}</div>
          </div>
          <div className="min-w-0 flex-1 text-sm text-slate-200">
            {data.locked
              ? <>{data.decided} of {n} lines decided. {data.called} {data.called === 1 ? 'player' : 'players'} made calls; everyone's show on each team.</>
              : <>Over or under on every team's wins this season. {data.locks_at ? <>Calls lock at the opener, <b className="text-white">{when(data.locks_at)}</b>.</> : null}</>}
            <div className="mt-1 text-[11px] text-mute">{data.edited ? 'Lines set by the host.' : `Lines: ${data.source ?? 'the preseason projection'}, to the half-win.`} {data.games} games each.</div>
          </div>
        </div>
      </div>

      {actAs && <p className="px-1 text-xs text-amber-100">Start from a blank sheet: {actAs.name}'s own calls stay private, and the calls you add join them (one on the same team replaces theirs).</p>}

      {me?.is_commish && status === 'open' && !data.locked && !actAs && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-black/20 px-3 py-2 ring-1 ring-white/[.06]">
          <span className="text-[13px] font-semibold text-white">{lines ? 'Set the lines' : 'The lines'}<span className="block text-[11px] font-normal text-mute">{lines ? 'A half-win at a time. A line someone has called stays as it is.' : 'Yours to change until the opener, until someone calls them'}</span></span>
          {lines
            ? <div className="flex shrink-0 gap-1.5"><button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setLines(null)}>Cancel</button>
                <button type="button" className="btn-gold px-3 py-1.5 text-xs" disabled={busy || !linesChanged.length} onClick={saveLines}>Save {linesChanged.length || ''}</button></div>
            : <button type="button" className="btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={() => setLines({})}>Edit lines</button>}
        </div>
      )}

      <Section title={editing ? 'Every line' : data.locked ? 'Every team' : 'Make your calls'}>
        <div className="card divide-y divide-white/[.05] p-1">
          {data.clubs.map((c) => {
            const mine = calls[c.id] as Call | undefined;
            const gp = c.w + c.l + c.d;
            const pc = pace(c, data.games);
            const hit = c.decided && mine ? (c.decided === 'P' ? null : c.decided === mine) : null;
            const total = (c.over ?? 0) + (c.under ?? 0);
            return (
              <div key={c.id} className={`px-3 py-2.5 ${mine && data.locked ? 'rounded-xl bg-white/[.02]' : ''}`}>
                <div className="flex items-center gap-3">
                  <Crest c={c} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-sm font-bold leading-tight text-white">{c.name}</div>
                    <div className="text-[11px] text-mute">
                      {editing ? 'Line' : <><span className="num font-bold text-gold">{fmt(c.line)}</span> wins</>}
                      {gp > 0 && <> · <span className="num text-slate-200">{c.w}-{c.l}{c.d ? `-${c.d}` : ''}</span>{pc != null && !c.decided ? `, on pace for ${pc}` : ''}</>}
                    </div>
                  </div>
                  {editing ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" aria-label="Half a win fewer" className="grid h-8 w-8 place-items-center rounded-full bg-white/[.06] text-white" onClick={() => step(c, -0.5)}><Minus className="h-4 w-4" /></button>
                      <span className={`num w-11 text-center text-base font-black ${lineOf(c) !== c.line ? 'text-gold' : 'text-white'}`}>{fmt(lineOf(c))}</span>
                      <button type="button" aria-label="Half a win more" className="grid h-8 w-8 place-items-center rounded-full bg-white/[.06] text-white" onClick={() => step(c, 0.5)}><Plus className="h-4 w-4" /></button>
                    </div>
                  ) : canCall ? (
                    <div className="flex shrink-0 gap-1">
                      {(['O', 'U'] as const).map((s) => (
                        <button key={s} type="button" onClick={() => tap(c.id, s)} aria-pressed={mine === s}
                          className={`w-[58px] rounded-xl py-2 text-xs font-black uppercase tracking-wide ring-1 transition ${mine === s ? (s === 'O' ? 'bg-emerald-400 text-[#06281b] ring-emerald-300' : 'bg-sky-400 text-[#061a2b] ring-sky-300') : 'bg-white/[.04] text-slate-200 ring-white/10'}`}>
                          {s === 'O' ? 'Over' : 'Under'}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {c.decided && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${c.decided === 'P' ? 'bg-white/[.08] text-slate-200' : c.decided === 'O' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-sky-400/15 text-sky-300'}`}>{c.decided === 'P' ? 'Push' : c.decided === 'O' ? 'Over' : 'Under'}</span>}
                      {mine
                        ? <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${hit === true ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-400/30' : hit === false ? 'bg-rose-400/10 text-rose-200 ring-rose-400/30' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}>
                            {hit === true ? <Check className="h-3 w-3" /> : hit === false ? <X className="h-3 w-3" /> : <Lock className="h-3 w-3" />}You: {mine === 'O' ? 'Over' : 'Under'}</span>
                        : <span className="text-[11px] text-mute">No call</span>}
                    </div>
                  )}
                </div>
                {data.locked && total > 0 && (
                  <div className="mt-2 flex items-center gap-2 pl-[46px]">
                    <span className="num w-14 shrink-0 text-[10px] font-bold text-emerald-300">Over {c.over}</span>
                    <div className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[.06]">
                      <div className="h-full bg-emerald-400/70" style={{ width: `${((c.over ?? 0) / total) * 100}%` }} />
                      <div className="h-full bg-sky-400/70" style={{ width: `${((c.under ?? 0) / total) * 100}%`, marginLeft: (c.over ?? 0) && (c.under ?? 0) ? 2 : 0 }} />
                    </div>
                    <span className="num w-14 shrink-0 text-right text-[10px] font-bold text-sky-300">{c.under} Under</span>
                  </div>
                )}
                {data.locked && c.calls && c.calls.length > 0 && (
                  <div className="mt-1 pl-[46px] text-[10px] leading-snug text-mute">
                    {c.calls.map((x) => `${teams.find((t) => t.id === x.team_id)?.gm_name ?? 'Someone'} ${x.call === 'O' ? 'over' : 'under'}`).join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {canCall && !editing && (dirty || (!actAs && made === 0)) && (
        <div className="sticky bottom-24 z-10">
          <button type="button" className="btn-gold w-full py-3 shadow-[0_12px_30px_-10px_rgba(0,0,0,.8)]" disabled={busy || !dirty || (!!actAs && made === 0)} onClick={save}>
            {dirty ? (actAs ? `Add ${made} ${made === 1 ? 'call' : 'calls'} for ${actAs.name}` : made === 0 ? 'Take back my calls' : `Save my ${made} ${made === 1 ? 'call' : 'calls'}`) : `${n - made} ${n - made === 1 ? 'team' : 'teams'} still to call`}
          </button>
        </div>
      )}
      {!actAs && data.locked && Object.keys(saved).length > 0 && <ShareButton className="btn-ghost w-full" label="Share my calls" make={shareMine} />}
      <p className="px-1 text-xs text-mute">
        A right call is a point: an over once the team passes its line, an under once it can't reach it with the games it has left, so points come in all season. A line hit exactly is a push, for nobody. Calls lock at the season's first game and show to everyone then. The most right calls wins; a tie is shared.
      </p>
    </div>
  );
}
