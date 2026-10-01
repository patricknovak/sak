// Ask the Book: a GM builds a long NHL market from a template (a game later in the week, a race between players
// on one stat over a window, a player's over/under, a race between NHL clubs, a club's season points), sees the
// odds the Book would give, and opens it by taking the first ticket. The Book prices nothing it isn't asked
// for, so the board only carries bets somebody wants; the suggestions show what's worth asking about right now.
import { useEffect, useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import type { BookPreview, BookRequest, BookSuggestion, BookTemplate, ClubRace, Game, MarketOption, Player } from '../lib/types';
import { etToday, fmtDate, fmtDateTime, fmtTime, NHL_TEAMS } from '../lib/format';
import { Coin, Headshot, Spinner, useAction } from './ui';

const TEMPLATES: { key: BookTemplate; icon: string; label: string; blurb: string }[] = [
  { key: 'game', icon: '🏒', label: 'A game', blurb: 'Moneyline, total or overtime on a game later in the week. Settles from the final like tonight’s.' },
  { key: 'player_race', icon: '🏁', label: 'Player race', blurb: 'Two to six players, one stat, one window. Most goals in October, most saves this week. Counted from the box scores.' },
  { key: 'player_line', icon: '📈', label: 'Player line', blurb: 'One player, one stat, over or under the Book’s number for the window.' },
  { key: 'club_race', icon: '🏆', label: 'NHL race', blurb: 'Clubs against each other: most points over a window, the division, the conference, the Presidents’ Trophy, the Cup, or in or out of the playoffs.' },
  { key: 'club_line', icon: '📊', label: 'Club points', blurb: 'A club’s regular-season points, over or under the Book’s projection.' },
];
const SKATER_STATS: [string, string][] = [['fpts', 'Fantasy points'], ['g', 'Goals'], ['a', 'Assists'], ['pts', 'Points'], ['sog', 'Shots'], ['hit', 'Hits'], ['blk', 'Blocks'], ['ppp', 'PP points']];
const GOALIE_STATS: [string, string][] = [['fpts', 'Fantasy points'], ['w', 'Wins'], ['sv', 'Saves'], ['sho', 'Shutouts']];
const RACES: [ClubRace, string][] = [['points', 'Most points over a window'], ['division', 'First in the division'], ['conference', 'First in the conference'], ['president', 'Presidents’ Trophy'], ['cup', 'Stanley Cup'], ['playoffs', 'Makes the playoffs?']];
const STAKES = [10, 25, 50, 100, 250];
const CLUBS = Object.keys(NHL_TEAMS).sort();
const american = (o: number) => (o >= 2 ? `+${Math.round((o - 1) * 100)}` : `${Math.round(-100 / (o - 1))}`);
const addDays = (d: string, n: number) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const endOfMonth = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1, 0); return x.toISOString().slice(0, 10); };

// enough of a request to price
const ready = (r: BookRequest) => {
  switch (r.template) {
    case 'game': return !!r.game_id;
    case 'player_race': return (r.players?.length ?? 0) >= 2 && !!r.stat;
    case 'player_line': return !!r.player_id && !!r.stat;
    case 'club_race': return !!r.what && (r.clubs?.length ?? 0) >= (r.what === 'playoffs' ? 1 : 2);
    case 'club_line': return !!r.club;
  }
};

export function AskBook({ onDone, start }: { onDone: () => void; start?: BookRequest }) {
  const { league, players, me } = useLeague();
  const { busy, run } = useAction();
  const today = etToday();
  const [req, setReq] = useState<BookRequest>(start ?? { template: 'game', bet: 'winner' });
  const [preview, setPreview] = useState<BookPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pricing, setPricing] = useState(false);
  const [pick, setPick] = useState<MarketOption | null>(null);
  const [stake, setStake] = useState(25);
  const [custom, setCustom] = useState('');
  const [suggestions, setSuggestions] = useState<BookSuggestion[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    rpc<BookSuggestion[]>('book_suggestions').then((s) => setSuggestions(s ?? [])).catch(() => setSuggestions([]));
    if (me) supabase.from('coin_balances').select('balance,escrow').eq('team_id', me.id).maybeSingle().then(({ data }) => setBalance(data ? data.balance - data.escrow : null));
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // price the request as it changes, a beat after the last edit
  const key = JSON.stringify(req);
  useEffect(() => {
    setPick(null);
    if (!ready(req)) { setPreview(null); setErr(null); return; }
    let alive = true;
    setPricing(true);
    const t = window.setTimeout(() => {
      rpc<BookPreview>('preview_market', { p: req })
        .then((pv) => { if (alive) { setPreview(pv); setErr(null); } })
        .catch((e: Error) => { if (alive) { setPreview(null); setErr(e.message); } })
        .finally(() => { if (alive) setPricing(false); });
    }, 350);
    return () => { alive = false; window.clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<BookRequest>) => setReq((r) => ({ ...r, ...patch }));
  const choose = (t: BookTemplate) => setReq(t === 'game' ? { template: t, bet: 'winner' } : t === 'club_race' ? { template: t, what: 'division', clubs: [] } : t === 'club_line' ? { template: t } : { template: t, stat: t === 'player_race' ? 'g' : 'fpts', players: [], from: today, to: endOfMonth(today) });
  const useSuggestion = (s: BookSuggestion) => { const { label: _l, why: _w, group: _g, ...r } = s; void _l; void _w; void _g; setReq(r); };
  const tpl = TEMPLATES.find((t) => t.key === req.template)!;
  const pay = pick ? Math.round(stake * Number(pick.odds)) : 0;

  const ask = () => run(async () => {
    if (!pick) return;
    await rpc('request_market', { p: req, p_pick: pick.key, p_coins: stake });
    onDone();
  }, `Market open: ${stake} ☘️ on ${pick?.label} @ ${pick?.odds}`);

  return (
    <div className="space-y-3">
      <p className="text-xs text-mute">The Book only prices what someone asks for. Pick a template, see the odds, and open the market by taking the first ticket: it goes on the board for everyone, marked as yours. Odds freeze when it opens. Three open requests per GM.</p>

      {suggestions && suggestions.length > 0 && (
        <div>
          <div className="label mb-1">Worth asking about</div>
          <div className="scroll-x flex gap-1">
            {suggestions.map((s, i) => (
              <button key={i} className={`chip shrink-0 py-1 ${JSON.stringify(req) === JSON.stringify((({ label: _l, why: _w, group: _g, ...r }) => r)(s)) ? 'bg-sky-500 text-ice' : ''}`} title={s.why} onClick={() => useSuggestion(s)}>
                {s.group === 'games' ? '🏒' : s.group === 'players' ? '🏁' : '🏆'} {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="scroll-x flex gap-1">
        {TEMPLATES.map((t) => <button key={t.key} className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${req.template === t.key ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`} onClick={() => choose(t.key)}>{t.icon} {t.label}</button>)}
      </div>
      <p className="text-xs text-mute">{tpl.blurb}</p>

      {req.template === 'game' && <GamePicker req={req} set={set} today={today} />}
      {(req.template === 'player_race' || req.template === 'player_line') && (
        <>
          <PlayerPicker req={req} set={set} players={players} />
          <StatPicker req={req} set={set} players={players} />
          <WindowPicker req={req} set={set} today={today} seasonEnd={league?.season_end ?? null} />
          {req.template === 'player_line' && (
            <label className="block text-xs text-mute">Line (leave blank for the Book’s number{preview?.subject.mean != null ? `, it expects ${preview.subject.mean}` : ''})
              <input className="input mt-1 w-32" inputMode="decimal" placeholder={preview ? String(preview.subject.line ?? '') : 'e.g. 7.5'} value={req.line ?? ''} onChange={(e) => set({ line: e.target.value === '' ? null : Number(e.target.value.replace(/[^\d.]/g, '')) })} />
            </label>
          )}
        </>
      )}
      {req.template === 'club_race' && (
        <>
          <select className="input" value={req.what} onChange={(e) => set({ what: e.target.value as ClubRace, clubs: [] })}>{RACES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <ClubPicker clubs={req.clubs ?? []} max={req.what === 'playoffs' ? 1 : 8} onChange={(clubs) => set({ clubs })} hint={req.what === 'playoffs' ? 'Pick the club' : req.what === 'points' ? 'Two to eight clubs' : 'Two to eight clubs; the rest of the group is “the field”'} />
          {req.what === 'points' && <WindowPicker req={req} set={set} today={today} seasonEnd={league?.season_end ?? null} />}
        </>
      )}
      {req.template === 'club_line' && (
        <>
          <ClubPicker clubs={req.club ? [req.club] : []} max={1} onChange={(c) => set({ club: c[0] })} hint="Pick the club" />
          <label className="block text-xs text-mute">Line (leave blank for the Book’s projection{preview?.subject.mean != null ? `: ${preview.subject.mean}` : ''})
            <input className="input mt-1 w-32" inputMode="decimal" placeholder={preview ? String(preview.subject.line ?? '') : 'e.g. 98.5'} value={req.line ?? ''} onChange={(e) => set({ line: e.target.value === '' ? null : Number(e.target.value.replace(/[^\d.]/g, '')) })} />
          </label>
        </>
      )}

      {/* what the Book would put up */}
      {(pricing || preview || err) && (
        <div className="rounded-xl border border-white/[.08] bg-white/[.03] p-3">
          {pricing && !preview && <div className="flex items-center gap-2 text-sm text-mute"><Spinner /> Pricing…</div>}
          {err && !pricing && <div className="text-sm text-amber-200">{err}</div>}
          {preview && (
            <div className={`space-y-2 ${pricing ? 'opacity-60' : ''}`}>
              <div className="text-sm font-semibold">{preview.title}</div>
              <div className={preview.options.length > 3 ? 'grid grid-cols-2 gap-1.5' : 'flex gap-1.5'}>
                {preview.options.map((o) => (
                  <button key={o.key} className={`flex min-w-0 flex-1 flex-col items-center rounded-xl border px-2 py-2 text-center ${pick?.key === o.key ? 'border-sky-400/60 bg-sky-500/15' : 'border-white/[.08] bg-white/[.03]'}`} onClick={() => setPick(o)}>
                    <span className="w-full truncate text-sm font-semibold">{o.label}</span>
                    <span className="num font-display text-lg font-extrabold text-gold">{Number(o.odds).toFixed(2)} <span className="text-[10px] font-normal text-mute">{american(Number(o.odds))}</span></span>
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-mute">{preview.note} Tickets until {fmtDateTime(preview.closes_at)}.</div>
            </div>
          )}
        </div>
      )}

      {preview && (
        <>
          <div>
            <div className="label mb-1">Your first ticket{balance != null ? ` (you have ${balance} ☘️ available)` : ''}</div>
            <div className="flex flex-wrap gap-1.5">
              {STAKES.map((s) => <button key={s} className={`chip py-1 ${stake === s && !custom ? 'bg-emerald-500 text-ice' : ''}`} onClick={() => { setStake(s); setCustom(''); }}>{s}</button>)}
              <input className="input w-24 py-1" inputMode="numeric" placeholder="other" value={custom} onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, ''); setCustom(v); if (v) setStake(Number(v)); }} />
            </div>
          </div>
          {pick && <div className="flex items-center justify-between rounded-xl bg-white/[.04] px-3 py-2 text-sm"><span className="text-mute">Pays if it hits</span><span className="flex items-center gap-1 font-semibold"><Coin size={14} /> {pay} <span className="text-xs text-mute">(+{pay - stake})</span></span></div>}
          <button className="btn-primary w-full" disabled={busy || pricing || !pick || stake < 5 || stake > 500} onClick={ask}>{pick ? `Open it: ${stake} ☘️ on ${pick.label}` : 'Pick a side to open the market'}</button>
          <p className="text-center text-xs text-mute">Your stake leaves your bank now and opens the market for everyone. Posted to Trash Talk. 5 to 500 ☘️.</p>
        </>
      )}
    </div>
  );
}

// games in the next two weeks, from tomorrow (tonight's are the Book's own)
function GamePicker({ req, set, today }: { req: BookRequest; set: (p: Partial<BookRequest>) => void; today: string }) {
  const [games, setGames] = useState<Game[] | null>(null);
  useEffect(() => {
    supabase.from('games').select('*').gt('date', today).lte('date', addDays(today, 14)).in('state', ['FUT', 'PRE']).order('start_utc')
      .then(({ data }) => setGames((data ?? []) as Game[]));
  }, [today]);
  const days = useMemo(() => { const m = new Map<string, Game[]>(); for (const g of games ?? []) { if (!m.has(g.date)) m.set(g.date, []); m.get(g.date)!.push(g); } return [...m.entries()]; }, [games]);
  const [day, setDay] = useState<string | null>(null);
  const cur = day ?? days[0]?.[0] ?? null;
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {([['winner', 'Moneyline'], ['total', 'Total goals'], ['ot', 'Overtime']] as const).map(([k, l]) => <button key={k} className={`chip py-1 ${req.bet === k ? 'bg-sky-500 text-ice' : ''}`} onClick={() => set({ bet: k })}>{l}</button>)}
      </div>
      {!games && <div className="flex items-center gap-2 text-sm text-mute"><Spinner /> Loading the schedule…</div>}
      {games && days.length === 0 && <div className="text-sm text-mute">No games on the schedule in the next two weeks.</div>}
      {days.length > 0 && (
        <>
          <div className="scroll-x flex gap-1">{days.map(([d, gs]) => <button key={d} className={`chip shrink-0 py-1 ${cur === d ? 'bg-sky-500 text-ice' : ''}`} onClick={() => setDay(d)}>{fmtDate(d)} <span className="text-[10px] opacity-70">{gs.length}</span></button>)}</div>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-white/[.08] divide-y divide-white/[.06]">
            {(days.find(([d]) => d === cur)?.[1] ?? []).map((g) => (
              <button key={g.id} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${req.game_id === g.id ? 'bg-sky-500/15' : 'hover:bg-white/[.04]'}`} onClick={() => set({ game_id: g.id })}>
                <span className="flex-1"><b>{g.away}</b> <span className="text-mute">@</span> <b>{g.home}</b> <span className="text-xs text-mute">{NHL_TEAMS[g.away] ?? ''} at {NHL_TEAMS[g.home] ?? ''}</span></span>
                <span className="text-xs text-mute">{fmtTime(g.start_utc)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// search the player pool; the first pick decides skaters or goalies
function PlayerPicker({ req, set, players }: { req: BookRequest; set: (p: Partial<BookRequest>) => void; players: Map<number, Player> }) {
  const { rosters, team } = useLeague();
  const [q, setQ] = useState('');
  const single = req.template === 'player_line';
  const picked = single ? (req.player_id ? [req.player_id] : []) : (req.players ?? []);
  const goalies = picked.length ? players.get(picked[0])?.pos === 'G' : null;
  const owner = (id: number) => { const r = rosters.find((x) => x.player_id === id); return r ? team(r.team_id)?.abbrev : null; };
  const list = useMemo(() => {
    const all = [...players.values()].filter((p) => p.status === 'active' && !picked.includes(p.id) && (goalies == null || (p.pos === 'G') === goalies));
    const needle = q.trim().toLowerCase();
    const hits = needle ? all.filter((p) => p.name.toLowerCase().includes(needle)) : all.filter((p) => rosters.some((r) => r.player_id === p.id));
    return hits.sort((a, b) => b.proj - a.proj).slice(0, 8);
  }, [players, q, picked.join(), goalies, rosters]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (id: number) => single ? set({ player_id: id }) : set({ players: [...picked, id] });
  const drop = (id: number) => single ? set({ player_id: undefined }) : set({ players: picked.filter((x) => x !== id) });
  return (
    <div className="space-y-1.5">
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {picked.map((id) => { const p = players.get(id); return <button key={id} className="chip items-center gap-1 py-1 bg-sky-500/20" onClick={() => drop(id)}><Headshot p={p} size={18} />{p?.name ?? id} <span className="text-xs text-mute">{p?.nhl_team}</span> ✕</button>; })}
        </div>
      )}
      {(single ? picked.length === 0 : picked.length < 6) && (
        <>
          <input className="input" placeholder={picked.length ? 'Add another…' : 'Search any NHL player…'} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="divide-y divide-white/[.06] rounded-xl border border-white/[.08]">
            {!q && <div className="px-3 py-1 text-[11px] text-mute">Rostered in the league, best first. Type a name for anyone else.</div>}
            {list.map((p) => (
              <button key={p.id} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-white/[.04]" onClick={() => { add(p.id); setQ(''); }}>
                <Headshot p={p} size={24} /><span className="flex-1 truncate">{p.name} <span className="text-xs text-mute">{p.pos} · {p.nhl_team}{owner(p.id) ? ` · ${owner(p.id)}` : ''}</span></span><span className="num text-xs text-mute">{Math.round(p.proj)} proj</span>
              </button>
            ))}
            {list.length === 0 && <div className="px-3 py-2 text-sm text-mute">Nobody by that name.</div>}
          </div>
        </>
      )}
    </div>
  );
}

function StatPicker({ req, set, players }: { req: BookRequest; set: (p: Partial<BookRequest>) => void; players: Map<number, Player> }) {
  const first = req.template === 'player_line' ? req.player_id : req.players?.[0];
  const goalie = first ? players.get(first)?.pos === 'G' : false;
  const stats = goalie ? GOALIE_STATS : SKATER_STATS;
  useEffect(() => { if (!stats.some(([k]) => k === req.stat)) set({ stat: stats[0][0] }); }, [goalie]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="scroll-x flex gap-1">{stats.map(([k, l]) => <button key={k} className={`chip shrink-0 py-1 ${req.stat === k ? 'bg-sky-500 text-ice' : ''}`} onClick={() => set({ stat: k })}>{l}</button>)}</div>;
}

// the window a race runs over: presets, or any two dates
function WindowPicker({ req, set, today, seasonEnd }: { req: BookRequest; set: (p: Partial<BookRequest>) => void; today: string; seasonEnd: string | null }) {
  const presets: [string, string, string][] = [['This week', today, addDays(today, 6)], ['This month', today, endOfMonth(today)], ['Next month', addDays(endOfMonth(today), 1), endOfMonth(addDays(endOfMonth(today), 1))], ['Rest of season', today, seasonEnd ?? addDays(today, 180)]];
  const [custom, setCustom] = useState(false);
  const on = (p: [string, string, string]) => !custom && req.from === p[1] && req.to === p[2];
  return (
    <div className="space-y-1.5">
      <div className="scroll-x flex gap-1">
        {presets.map((p) => <button key={p[0]} className={`chip shrink-0 py-1 ${on(p) ? 'bg-sky-500 text-ice' : ''}`} onClick={() => { setCustom(false); set({ from: p[1], to: p[2] }); }}>{p[0]}</button>)}
        <button className={`chip shrink-0 py-1 ${custom ? 'bg-sky-500 text-ice' : ''}`} onClick={() => setCustom(true)}>Pick dates</button>
      </div>
      {custom && (
        <div className="flex items-center gap-2 text-xs text-mute">
          <input type="date" className="input py-1" value={req.from ?? today} min={today} onChange={(e) => set({ from: e.target.value })} /> to
          <input type="date" className="input py-1" value={req.to ?? ''} min={req.from ?? today} onChange={(e) => set({ to: e.target.value })} />
        </div>
      )}
      {!custom && req.from && req.to && <div className="text-[11px] text-mute">{fmtDate(req.from)} to {fmtDate(req.to)}</div>}
    </div>
  );
}

function ClubPicker({ clubs, max, onChange, hint }: { clubs: string[]; max: number; onChange: (c: string[]) => void; hint: string }) {
  const toggle = (c: string) => onChange(clubs.includes(c) ? clubs.filter((x) => x !== c) : max === 1 ? [c] : clubs.length < max ? [...clubs, c] : clubs);
  return (
    <div>
      <div className="mb-1 text-[11px] text-mute">{hint}{clubs.length ? `: ${clubs.map((c) => NHL_TEAMS[c] ?? c).join(', ')}` : ''}</div>
      <div className="grid grid-cols-8 gap-1">
        {CLUBS.map((c) => <button key={c} className={`rounded-md py-1 text-[11px] font-semibold ${clubs.includes(c) ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-slate-300'}`} onClick={() => toggle(c)}>{c}</button>)}
      </div>
    </div>
  );
}
