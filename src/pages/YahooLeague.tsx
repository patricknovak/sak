// One of a GM's Yahoo leagues: standings, matchups, their lineup (editable), free agents with add/drop,
// pending trades (accept, reject, propose; commissioner allow/veto) and links to everything else on Yahoo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Shield } from 'lucide-react';
import { hub } from '../lib/nhlhub';
import { etToday } from '../lib/format';
import { yahoo, nhlAbbr, openYahoo, BENCH, SCORING, type YLeagueFull, type YMatchup, type YPlayer, type YRoster, type YTeam, type YTransaction, type YTransactions } from '../lib/yahoo';
import { Empty, PageHeader, Section, Sheet, Spinner, useAction } from '../components/ui';
import { YahooMark, useYahooStatus } from '../components/YahooConnect';

type Tab = 'standings' | 'matchups' | 'team' | 'players' | 'moves' | 'manage' | 'more';
const shift = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const rec = (t: YTeam) => (t.w == null ? null : `${t.w}-${t.l ?? 0}${t.t ? `-${t.t}` : ''}`);

export default function YahooLeague() {
  const { key = '' } = useParams();
  const [L, setL] = useState<YLeagueFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('standings');
  const [busy, setBusy] = useState(false);
  const { st } = useYahooStatus();
  const writeOk = st?.writeOk ?? null;
  const load = useCallback(() => {
    setBusy(true); setErr(null);
    yahoo<YLeagueFull>('league', { league_key: key }).then(setL, (e: Error) => setErr(e.message)).finally(() => setBusy(false));
  }, [key]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (L && !L.matchups && tab === 'matchups') setTab('standings'); }, [L, tab]);

  if (err) return <div className="space-y-3"><Link to="/yahoo" className="btn btn-sm w-fit"><ArrowLeft size={14} /> Yahoo leagues</Link><div className="card border-red-400/30 bg-red-500/10 p-3 text-sm">{err}</div></div>;
  if (!L) return <div className="grid place-items-center py-16"><Spinner /></div>;
  const me = L.me;
  const tabs: [Tab, string][] = [['standings', '🏆 Standings'], ...(L.matchups ? [['matchups', '⚔️ Matchups'] as [Tab, string]] : []), ...(me ? [['team', '🧩 My team'] as [Tab, string], ['players', '🔍 Players'] as [Tab, string], ['moves', '🔄 Moves'] as [Tab, string]] : []), ['manage', '🖥️ Manage on Yahoo'], ['more', '⚙️ More']];

  return (
    <div className="space-y-4">
      <Link to="/yahoo" className="inline-flex items-center gap-1 text-xs text-mute"><ArrowLeft size={12} /> Yahoo leagues</Link>
      <PageHeader icon={L.logo ? <img src={L.logo} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <YahooMark size={28} />} title={L.name}
        sub={<span>{L.season}-{String(Number(L.season) + 1).slice(2)} · {L.teams.length} teams · {SCORING[L.scoring] ?? L.scoring}{L.week ? ` · Week ${L.week}` : ''}{me?.commissioner ? ' · You’re the commissioner' : ''}</span>}
        right={<div className="flex gap-1">{L.url && <a href={L.url} target="_blank" rel="noreferrer" className="btn btn-sm" aria-label="Open on Yahoo"><ExternalLink size={14} /></a>}<button className="btn btn-sm" onClick={load} disabled={busy} aria-label="Refresh"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button></div>} />
      {me && (
        <div className="card flex items-center gap-3 p-3">
          {me.logo ? <img src={me.logo} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-white/[.06]"><Shield size={18} /></div>}
          <div className="min-w-0 flex-1"><div className="truncate font-semibold">{me.name}</div><div className="text-xs text-mute">{me.rank ? `${ord(me.rank)} of ${L.teams.length}` : ''}{rec(me) ? ` · ${rec(me)}` : ''}{me.pf != null ? ` · ${me.pf} pts for` : ''}{L.settings.faab && me.faab != null ? ` · $${me.faab} FAAB` : me.waiver != null ? ` · Waiver #${me.waiver}` : ''}{me.moves != null ? ` · ${me.moves} moves` : ''}</div></div>
          {me.url && <a href={me.url} target="_blank" rel="noreferrer" className="btn btn-sm"><ExternalLink size={14} /></a>}
        </div>
      )}
      <div className="scroll-x flex gap-1.5">{tabs.map(([k, l]) => <button key={k} className={`tab shrink-0 ${tab === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'standings' && <StandingsTab L={L} />}
      {tab === 'matchups' && L.matchups && <MatchupsTab L={L} />}
      {tab === 'team' && me && <TeamTab L={L} team={me} writeOk={writeOk} />}
      {tab === 'players' && me && <PlayersTab L={L} team={me} writeOk={writeOk} />}
      {tab === 'moves' && me && <MovesTab L={L} team={me} writeOk={writeOk} />}
      {tab === 'manage' && <ManageTab L={L} writeOk={writeOk} />}
      {tab === 'more' && <MoreTab L={L} />}
    </div>
  );
}

// Yahoo gave this connection read-only access: changes go through Yahoo's own page in the Yahoo window
function ReadOnly({ url, what }: { url: string | null; what: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm">
      <span className="flex-1">Yahoo only lets SaK <b>read</b> your leagues, so {what} happens on Yahoo. It opens in its own window and you stay signed in there.</span>
      {url && <button className="btn-gold btn-sm shrink-0" onClick={() => openYahoo(url)}><ExternalLink size={14} /> Open on Yahoo</button>}
    </div>
  );
}

// ───────────── manage on Yahoo: the Yahoo window ─────────────
function ManageTab({ L, writeOk }: { L: YLeagueFull; writeOk: boolean | null }) {
  const base = L.url?.replace(/\/$/, '') ?? null;
  const team = L.me?.url?.replace(/\/$/, '') ?? null;
  const items: [string, string, string | null][] = [
    ['🧩', 'Set my lineup', team],
    ['➕', 'Add or drop players', base ? `${base}/players` : null],
    ['🔄', 'Trades and transactions', base ? `${base}/transactions` : null],
    ['⚔️', 'This week’s matchup', team ? `${team}/matchup` : null],
    ['🏆', 'Standings', base ? `${base}/standings` : null],
    ['💬', 'Message board', base ? `${base}/messages` : null],
    ['⚙️', 'League settings', base ? `${base}/settings` : null],
    ...(L.me?.commissioner ? [['👑', 'Commissioner tools (league home)', base] as [string, string, string | null]] : []),
  ];
  return (
    <div className="space-y-3">
      <div className="card p-3 text-sm text-mute">
        <p>Yahoo doesn’t allow its pages inside another site, so the Yahoo window is a real browser window: one that opens beside SaK on a computer, a new tab on a phone. Sign in to Yahoo there once and it stays signed in. Everything you do there shows up here after a refresh.</p>
        {writeOk === false && <p className="mt-2 text-amber-200">Yahoo gave SaK read-only access to your account, so lineup changes, pickups and trades are done in the Yahoo window.</p>}
        {writeOk === true && <p className="mt-2 text-emerald-200">Your connection can write, so lineups, pickups and trades also work right here in SaK.</p>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.filter(([, , u]) => u).map(([icon, label, url]) => (
          <button key={label} className="card flex items-center gap-3 px-3 py-3 text-left text-sm transition active:scale-[.98]" onClick={() => openYahoo(url!)}>
            <span className="text-xl">{icon}</span><span className="flex-1 font-semibold">{label}</span><ExternalLink size={14} className="text-mute" />
          </button>
        ))}
      </div>
      {base && <button className="btn w-full" onClick={() => openYahoo(base)}><YahooMark size={16} /> Open the league home in the Yahoo window</button>}
    </div>
  );
}

// ───────────── standings ─────────────
function StandingsTab({ L }: { L: YLeagueFull }) {
  const h2h = L.scoring.startsWith('head');
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="label text-left"><th className="px-2 py-2">#</th><th className="py-2">Team</th>{h2h && <th className="px-2 py-2 text-right">W-L-T</th>}<th className="px-2 py-2 text-right">{h2h ? 'PF' : 'Pts'}</th>{h2h && <th className="hidden px-2 py-2 text-right sm:table-cell">PA</th>}<th className="hidden px-2 py-2 text-right sm:table-cell">Moves</th><th className="hidden px-2 py-2 text-right sm:table-cell">{L.settings.faab ? 'FAAB' : 'Waiver'}</th></tr></thead>
        <tbody>
          {L.teams.map((t) => (
            <tr key={t.key} className={`border-t border-white/[.06] ${t.mine ? 'bg-sky-500/10' : ''}`}>
              <td className="num px-2 py-2 text-mute">{t.rank ?? ''}{t.clinched ? '*' : ''}</td>
              <td className="py-2"><div className="flex items-center gap-2">{t.logo ? <img src={t.logo} alt="" className="h-7 w-7 rounded-md object-cover" /> : <span className="grid h-7 w-7 place-items-center rounded-md bg-white/[.06] text-xs">🏒</span>}<div className="min-w-0"><div className="truncate font-medium">{t.name}{t.commissioner || t.commishNames.length ? <span className="ml-1 text-[10px] text-amber-200" title="Commissioner">👑</span> : null}</div><div className="truncate text-[11px] text-mute">{t.managers.join(', ')}</div></div></div></td>
              {h2h && <td className="num px-2 py-2 text-right">{rec(t) ?? '—'}</td>}
              <td className="num px-2 py-2 text-right">{t.pf ?? t.points ?? '—'}</td>
              {h2h && <td className="num hidden px-2 py-2 text-right text-mute sm:table-cell">{t.pa ?? '—'}</td>}
              <td className="num hidden px-2 py-2 text-right text-mute sm:table-cell">{t.moves ?? '—'}</td>
              <td className="num hidden px-2 py-2 text-right text-mute sm:table-cell">{L.settings.faab ? (t.faab != null ? `$${t.faab}` : '—') : t.waiver ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {L.teams.some((t) => t.clinched) && <div className="px-3 py-1.5 text-[11px] text-mute">* clinched a playoff spot</div>}
    </div>
  );
}

// ───────────── matchups ─────────────
function MatchupsTab({ L }: { L: YLeagueFull }) {
  const [week, setWeek] = useState(L.week ?? 1);
  const [m, setM] = useState<YMatchup[] | null>(L.matchups);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (week === L.week) { setM(L.matchups); return; }
    setBusy(true); setM(null);
    yahoo<{ matchups: YMatchup[] }>('scoreboard', { league_key: L.key, week }).then((r) => setM(r.matchups), () => setM([])).finally(() => setBusy(false));
  }, [week, L]);
  const cat = (id: number | null) => L.settings.stats.find((s) => s.id === id)?.name ?? '';
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button className="btn btn-sm" disabled={week <= (L.startWeek ?? 1)} onClick={() => setWeek(week - 1)}><ChevronLeft size={14} /></button>
        <div className="font-semibold">Week {week}{m?.[0]?.start ? <span className="ml-1 text-xs text-mute">{fmtDay(m[0].start)} – {m[0].end ? fmtDay(m[0].end) : ''}</span> : null}</div>
        <button className="btn btn-sm" disabled={week >= (L.endWeek ?? 30)} onClick={() => setWeek(week + 1)}><ChevronRight size={14} /></button>
      </div>
      {busy && <div className="grid place-items-center py-8"><Spinner /></div>}
      {m && m.length === 0 && !busy && <Empty title="No matchups that week" />}
      {m?.map((x, i) => (
        <div key={i} className={`card p-3 ${x.teams.some((t) => t.mine) ? 'ring-1 ring-sky-400/40' : ''}`}>
          <div className="mb-1 flex items-center justify-between text-[11px] text-mute"><span>{x.playoffs ? '🏆 Playoffs' : x.consolation ? 'Consolation' : ''}</span><span>{x.status === 'postevent' ? 'Final' : x.status === 'midevent' ? 'Live' : 'Upcoming'}</span></div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {x.teams.slice(0, 2).flatMap((t, j) => [j === 1 ? <span key="mid" /> : null, ((t, j) => {
              const won = x.winner === t.key;
              return (
                <div key={t.key} className={`flex min-w-0 items-center gap-2 ${j === 1 ? 'flex-row-reverse text-right' : ''}`}>
                  {t.logo ? <img src={t.logo} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[.06]">🏒</span>}
                  <div className="min-w-0"><div className={`truncate text-sm font-semibold ${won ? 'text-gold' : ''}`}>{t.name}</div><div className="truncate text-[11px] text-mute">{rec(t) ?? t.managers[0] ?? ''}</div></div>
                </div>
              );
            })(t, j)])}
          </div>
          <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center text-center">
            <Score t={x.teams[0]} win={x.winner === x.teams[0]?.key} side="left" />
            <div className="text-xs text-mute">{x.tied ? 'Tied' : x.cats.length ? `${x.cats.filter((c) => c.winner === x.teams[0]?.key).length}-${x.cats.filter((c) => c.winner === x.teams[1]?.key).length}-${x.cats.filter((c) => c.tied).length}` : 'vs'}</div>
            <Score t={x.teams[1]} win={x.winner === x.teams[1]?.key} side="right" />
          </div>
          {x.cats.length > 0 && x.teams.some((t) => t.mine) && (
            <div className="mt-2 flex flex-wrap gap-1">{x.cats.map((c) => { const mine = x.teams.find((t) => t.mine); const win = c.winner === mine?.key; return <span key={c.stat} className={`chip ${c.tied ? '' : win ? 'bg-emerald-500/15 text-emerald-200' : 'bg-red-500/10 text-red-200'}`}>{cat(c.stat)}</span>; })}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function Score({ t, win, side }: { t?: YTeam; win: boolean; side: 'left' | 'right' }) {
  if (!t) return <div />;
  return <div className={`num font-display text-2xl font-extrabold ${win ? 'text-gold' : ''} ${side === 'right' ? 'text-right' : 'text-left'}`}>{t.points ?? '—'}{t.projected != null && <span className="ml-1 text-xs font-normal text-mute">proj {t.projected}</span>}</div>;
}

// ───────────── my team: roster and lineup ─────────────
function PlayerRow({ p, right, plays }: { p: YPlayer; right?: React.ReactNode; plays?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      {p.headshot ? <img src={p.headshot} alt="" className="h-9 w-9 shrink-0 rounded-full bg-white/[.06] object-cover" loading="lazy" /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[.06] text-xs">{p.pos}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-sm"><span className="truncate font-medium">{p.name}</span>{p.status && <span className="chip bg-red-500/15 text-red-200" title={p.injury ?? p.statusFull ?? ''}>{p.status}</span>}{plays && <span className="chip bg-emerald-500/15 text-emerald-200" title="Plays on this date">🏒 today</span>}</div>
        <div className="truncate text-[11px] text-mute">{p.team}{p.num ? ` #${p.num}` : ''} · {p.pos}{p.owner?.type === 'team' ? ` · ${p.owner.teamName}` : p.owner?.type === 'waivers' ? ` · Waivers${p.owner.waiverDate ? ` until ${p.owner.waiverDate}` : ''}` : ''}{p.owned != null ? ` · ${p.owned}% owned` : ''}</div>
      </div>
      {right}
    </div>
  );
}

function TeamTab({ L, team, writeOk }: { L: YLeagueFull; team: YTeam; writeOk: boolean | null }) {
  const [date, setDate] = useState(etToday());
  const [R, setR] = useState<YRoster | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  const { busy, run } = useAction();
  const load = useCallback(() => {
    setR(null); setErr(null); setMoves({});
    yahoo<YRoster>('roster', { team_key: team.key, date }).then(setR, (e: Error) => setErr(e.message));
    hub<{ games: { home: { abbrev: string }; away: { abbrev: string } }[] }>('scores', { date }).then((s) => setPlaying(new Set(s.games.flatMap((g) => [g.home.abbrev, g.away.abbrev]))), () => setPlaying(new Set()));
  }, [team.key, date]);
  useEffect(() => { load(); }, [load]);

  const slotOf = (p: YPlayer) => moves[p.key] ?? p.slot ?? 'BN';
  const order = useMemo(() => { const o = new Map<string, number>(); L.settings.positions.forEach((x, i) => o.set(x.pos, i)); BENCH.forEach((b, i) => { if (!o.has(b)) o.set(b, 100 + i); }); return o; }, [L]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; (R?.players ?? []).forEach((p) => { const s = slotOf(p); c[s] = (c[s] ?? 0) + 1; }); return c; }, [R, moves]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => [...(R?.players ?? [])].sort((a, b) => (order.get(slotOf(a)) ?? 50) - (order.get(slotOf(b)) ?? 50) || a.name.localeCompare(b.name)), [R, moves, order]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = Object.entries(moves).filter(([k, v]) => R?.players.find((p) => p.key === k)?.slot !== v);
  const options = (p: YPlayer) => { const ir = p.elig.filter((e) => e.startsWith('IR') || e === 'NA'); const starts = L.settings.positions.filter((x) => x.starting && (p.elig.includes(x.pos) || (x.pos === 'Util' && p.type === 'P'))).map((x) => x.pos); return [...new Set([...starts, 'BN', ...ir])]; };
  const problems = L.settings.positions.filter((x) => x.pos !== 'BN' && (counts[x.pos] ?? 0) > x.count).map((x) => `${x.pos}: ${counts[x.pos]} of ${x.count} slots`);

  const save = () => run(async () => {
    await yahoo('set_lineup', { team_key: team.key, coverage: R?.coverage ?? 'date', date: R?.date ?? date, week: R?.week, players: changed.map(([player_key, position]) => ({ player_key, position })) });
    load();
  }, 'Lineup saved on Yahoo');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button className="btn btn-sm" onClick={() => setDate(shift(date, -1))}><ChevronLeft size={14} /></button>
        <div className="text-center"><div className="font-semibold">{fmtDay(date)}</div>{date !== etToday() && <button className="text-[11px] text-sky-300" onClick={() => setDate(etToday())}>Today</button>}</div>
        <button className="btn btn-sm" onClick={() => setDate(shift(date, 1))}><ChevronRight size={14} /></button>
      </div>
      {err && <div className="card border-red-400/30 bg-red-500/10 p-3 text-sm">{err}</div>}
      {!R && !err && <div className="grid place-items-center py-8"><Spinner /></div>}
      {R && (
        <>
          <div className="flex flex-wrap gap-1">{L.settings.positions.filter((x) => x.pos !== 'BN').map((x) => <span key={x.pos} className={`chip ${(counts[x.pos] ?? 0) > x.count ? 'bg-red-500/15 text-red-200' : (counts[x.pos] ?? 0) < x.count && x.starting ? 'bg-amber-400/15 text-amber-200' : ''}`}>{x.pos} {counts[x.pos] ?? 0}/{x.count}</span>)}<span className="chip">BN {counts.BN ?? 0}</span></div>
          {R.editable === false && <div className="text-xs text-amber-200">Yahoo has locked this date’s lineup.</div>}
          {writeOk === false && <ReadOnly url={team.url} what="setting your lineup" />}
          <div className="card divide-y divide-white/[.06] px-3">
            {sorted.map((p) => {
              const s = slotOf(p);
              const starting = !BENCH.includes(s);
              return (
                <div key={p.key} className={`${starting ? '' : 'opacity-80'}`}>
                  <PlayerRow p={p} plays={playing.has(nhlAbbr(p.team))} right={
                    <select className="input w-20 py-1 text-xs" value={s} disabled={p.editable === false || R.editable === false || writeOk === false} onChange={(e) => setMoves({ ...moves, [p.key]: e.target.value })} aria-label={`Slot for ${p.name}`}>
                      {options(p).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>} />
                </div>
              );
            })}
          </div>
          {changed.length > 0 && (
            <div className="sticky bottom-20 z-10 flex items-center gap-2 rounded-2xl border border-sky-400/30 bg-ice/95 p-2 shadow-lg backdrop-blur lg:bottom-4">
              <div className="flex-1 text-xs">{changed.length} change{changed.length === 1 ? '' : 's'}{problems.length ? <span className="block text-red-200">Too many: {problems.join(', ')}</span> : null}</div>
              <button className="btn btn-sm" onClick={() => setMoves({})}>Reset</button>
              <button className="btn-primary btn-sm" disabled={busy || problems.length > 0} onClick={save}>Save to Yahoo</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ───────────── players: free agents, add/drop ─────────────
function PlayersTab({ L, team, writeOk }: { L: YLeagueFull; team: YTeam; writeOk: boolean | null }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'FA' | 'W' | 'A'>('FA');
  const [pos, setPos] = useState('');
  const [sort, setSort] = useState<'AR' | 'OR' | 'PTS'>('AR');
  const [start, setStart] = useState(0);
  const [list, setList] = useState<YPlayer[] | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<YPlayer | null>(null);
  const positions = useMemo(() => [...new Set(L.settings.positions.filter((x) => x.starting && x.pos !== 'Util').map((x) => x.pos))], [L]);
  useEffect(() => {
    const t = setTimeout(() => {
      setErr(null);
      yahoo<{ players: YPlayer[]; more: boolean }>('players', { league_key: L.key, status, position: pos || undefined, search: q || undefined, sort, start })
        .then((r) => { setList((old) => (start ? [...(old ?? []), ...r.players] : r.players)); setMore(r.more); }, (e: Error) => setErr(e.message));
    }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [L.key, status, pos, q, sort, start]);
  const reset = () => { setStart(0); setList(null); };
  return (
    <div className="space-y-2">
      <input className="input" placeholder="Search players…" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
      <div className="scroll-x flex gap-1.5">
        {([['FA', 'Free agents'], ['W', 'Waivers'], ['A', 'All']] as const).map(([k, l]) => <button key={k} className={`tab shrink-0 ${status === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => { setStatus(k); reset(); }}>{l}</button>)}
        <span className="mx-1 w-px shrink-0 bg-white/10" />
        <button className={`tab shrink-0 ${!pos ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => { setPos(''); reset(); }}>Any</button>
        {positions.map((p) => <button key={p} className={`tab shrink-0 ${pos === p ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => { setPos(p); reset(); }}>{p}</button>)}
        <select className="input ml-auto w-auto shrink-0 py-1 text-xs" value={sort} onChange={(e) => { setSort(e.target.value as 'AR'); reset(); }} aria-label="Sort"><option value="AR">Yahoo rank</option><option value="OR">Overall rank</option><option value="PTS">Fantasy points</option></select>
      </div>
      {writeOk === false && <ReadOnly url={L.url ? `${L.url.replace(/\/$/, '')}/players` : null} what="adding and dropping" />}
      {err && <div className="card border-red-400/30 bg-red-500/10 p-3 text-sm">{err}</div>}
      {!list && !err && <div className="grid place-items-center py-8"><Spinner /></div>}
      {list && list.length === 0 && <Empty title="Nobody matches" />}
      {list && list.length > 0 && (
        <div className="card divide-y divide-white/[.06] px-3">
          {list.map((p) => <PlayerRow key={p.key} p={p} right={p.owner?.type === 'team' ? <span className="text-[11px] text-mute">{p.owner.teamKey === team.key ? 'Yours' : 'Taken'}</span> : <button className="btn-blue btn-sm" onClick={() => (writeOk === false && L.url ? openYahoo(`${L.url.replace(/\/$/, '')}/players`) : setAdding(p))}>{p.owner?.type === 'waivers' ? 'Claim' : 'Add'}</button>} />)}
        </div>
      )}
      {more && <button className="btn w-full" onClick={() => setStart(start + 25)}>More</button>}
      <AddSheet L={L} team={team} p={adding} onClose={() => setAdding(null)} onDone={() => { setAdding(null); reset(); }} />
    </div>
  );
}

function AddSheet({ L, team, p, onClose, onDone }: { L: YLeagueFull; team: YTeam; p: YPlayer | null; onClose: () => void; onDone: () => void }) {
  const [roster, setRoster] = useState<YPlayer[] | null>(null);
  const [drop, setDrop] = useState('');
  const [faab, setFaab] = useState('');
  const { busy, run } = useAction();
  useEffect(() => { if (p) { setRoster(null); setDrop(''); setFaab(''); yahoo<YRoster>('roster', { team_key: team.key }).then((r) => setRoster(r.players), () => setRoster([])); } }, [p, team.key]);
  const waiver = p?.owner?.type === 'waivers';
  return (
    <Sheet open={!!p} onClose={onClose} title={p ? `${waiver ? 'Claim' : 'Add'} ${p.name}` : ''}>
      {p && (
        <div className="space-y-3 p-1">
          <PlayerRow p={p} />
          <div>
            <div className="label mb-1">Drop someone? {roster && roster.length >= L.settings.positions.reduce((a, x) => a + x.count, 0) ? <span className="text-amber-200">(roster is full)</span> : <span className="text-mute">(optional)</span>}</div>
            {!roster && <Spinner />}
            {roster && (
              <select className="input" value={drop} onChange={(e) => setDrop(e.target.value)}>
                <option value="">Nobody, just add</option>
                {roster.filter((x) => !x.undroppable).map((x) => <option key={x.key} value={x.key}>{x.name} · {x.team} {x.pos}{x.status ? ` (${x.status})` : ''}</option>)}
              </select>
            )}
          </div>
          {waiver && L.settings.faab && <label className="block text-xs text-mute">FAAB bid ($){team.faab != null ? ` · you have $${team.faab}` : ''}<input className="input mt-1" inputMode="numeric" value={faab} onChange={(e) => setFaab(e.target.value.replace(/\D/g, ''))} placeholder="0" /></label>}
          <button className="btn-primary w-full" disabled={busy || !roster} onClick={() => run(async () => { await yahoo('add_drop', { league_key: L.key, team_key: team.key, add: p.key, drop: drop || undefined, faab: waiver && L.settings.faab && faab ? Number(faab) : undefined }); onDone(); }, waiver ? 'Waiver claim placed on Yahoo' : 'Done on Yahoo')}>
            {waiver ? 'Place claim' : drop ? 'Add and drop' : 'Add'}
          </button>
          <p className="text-[11px] text-mute">Yahoo applies its own rules (roster limits, waivers, move caps) and tells you if something can’t be done.</p>
        </div>
      )}
    </Sheet>
  );
}

// ───────────── moves: trades, waivers, history ─────────────
function TxCard({ t, me, commish, onAct, busy }: { t: YTransaction; me: YTeam; commish: boolean; onAct: (action: string, t: YTransaction) => void; busy: boolean }) {
  const pending = t.type === 'pending_trade';
  const mineIn = t.trader?.key === me.key, mineOut = t.tradee?.key === me.key;
  const label = t.type === 'add/drop' ? 'Add / drop' : t.type === 'pending_trade' ? 'Trade proposal' : t.type === 'commish' ? 'Commissioner' : t.type.charAt(0).toUpperCase() + t.type.slice(1);
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between text-[11px] text-mute"><span>{label}{t.status && t.status !== 'successful' ? ` · ${t.status}` : ''}</span><span>{t.at ? new Date(t.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span></div>
      {t.trader && t.tradee && <div className="mt-1 text-sm font-semibold">{t.trader.name} ⇄ {t.tradee.name}</div>}
      <div className="mt-1 space-y-0.5 text-sm">
        {t.players.map((p) => (
          <div key={p.key + p.move} className="flex items-center gap-1.5">
            <span className={`chip ${p.move === 'add' ? 'bg-emerald-500/15 text-emerald-200' : p.move === 'drop' ? 'bg-red-500/10 text-red-200' : 'bg-sky-500/15 text-sky-200'}`}>{p.move === 'pending_trade' || p.move === 'trade' ? '⇄' : p.move}</span>
            <span className="truncate"><span className="font-medium">{p.name}</span> <span className="text-mute">{p.team} {p.pos}</span></span>
            <span className="ml-auto truncate text-[11px] text-mute">{p.move === 'add' ? `→ ${p.to ?? ''}` : p.move === 'drop' ? `from ${p.from ?? ''}` : `${p.from ?? ''} → ${p.to ?? ''}`}</span>
          </div>
        ))}
      </div>
      {t.faab != null && <div className="mt-1 text-xs text-mute">FAAB bid ${t.faab}</div>}
      {t.note && <div className="mt-1 text-xs italic text-mute">“{t.note}”</div>}
      {pending && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {mineOut && t.status === 'proposed' && <><button className="btn-primary btn-sm" disabled={busy} onClick={() => onAct('accept', t)}>Accept</button><button className="btn btn-sm" disabled={busy} onClick={() => onAct('reject', t)}>Reject</button></>}
          {mineIn && t.status === 'proposed' && <button className="btn btn-sm" disabled={busy} onClick={() => onAct('cancel', t)}>Withdraw</button>}
          {!mineIn && !mineOut && t.status === 'accepted' && <button className="btn btn-sm" disabled={busy} onClick={() => onAct('vote_against', t)}>Vote against</button>}
          {commish && t.status === 'accepted' && <><button className="btn-gold btn-sm" disabled={busy} onClick={() => onAct('allow', t)}>👑 Approve</button><button className="btn btn-sm" disabled={busy} onClick={() => onAct('disallow', t)}>👑 Veto</button></>}
        </div>
      )}
      {t.type === 'waiver' && (mineIn || t.players.some((p) => p.toKey === me.key)) && <div className="mt-2"><button className="btn btn-sm" disabled={busy} onClick={() => onAct('cancel', t)}>Cancel claim</button></div>}
    </div>
  );
}

function MovesTab({ L, team, writeOk }: { L: YLeagueFull; team: YTeam; writeOk: boolean | null }) {
  const [T, setT] = useState<YTransactions | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [propose, setPropose] = useState(false);
  const { busy, run } = useAction();
  const load = useCallback(() => { setErr(null); yahoo<YTransactions>('transactions', { league_key: L.key, team_key: team.key }).then(setT, (e: Error) => setErr(e.message)); }, [L.key, team.key]);
  useEffect(() => { load(); }, [load]);
  const act = (action: string, t: YTransaction) => {
    const msg = { accept: 'Accept this trade?', reject: 'Reject this trade?', cancel: 'Withdraw this?', allow: 'Approve this trade as commissioner?', disallow: 'Veto this trade as commissioner?', vote_against: 'Vote against this trade?' }[action] ?? 'Sure?';
    if (!confirm(msg)) return;
    run(async () => { if (action === 'cancel') await yahoo('cancel', { transaction_key: t.key }); else await yahoo('trade_respond', { transaction_key: t.key, action }); load(); }, 'Done on Yahoo');
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><div className="text-sm text-mute">{L.settings.tradeRatify === 'commish' ? 'Trades need the commissioner’s approval.' : L.settings.tradeRatify === 'vote' ? 'Trades can be voted down by the league.' : 'Trades go through automatically.'}{L.settings.tradeEnd ? ` Deadline ${L.settings.tradeEnd}.` : ''}</div><button className="btn-blue btn-sm shrink-0" onClick={() => (writeOk === false && team.url ? openYahoo(team.url) : setPropose(true))}>Propose trade</button></div>
      {writeOk === false && <ReadOnly url={L.url ? `${L.url.replace(/\/$/, '')}/transactions` : null} what="accepting, rejecting and approving trades" />}
      {err && <div className="card border-red-400/30 bg-red-500/10 p-3 text-sm">{err}</div>}
      {!T && !err && <div className="grid place-items-center py-8"><Spinner /></div>}
      {T && (
        <>
          {(T.pending.length > 0 || T.waivers.length > 0) && (
            <Section title="Pending">
              <div className="space-y-2">{[...T.pending, ...T.waivers].map((t) => <TxCard key={t.key} t={t} me={team} commish={team.commissioner} onAct={act} busy={busy || writeOk === false} />)}</div>
            </Section>
          )}
          <Section title="Recent moves">
            {T.recent.length === 0 ? <Empty title="No moves yet" /> : <div className="space-y-2">{T.recent.map((t) => <TxCard key={t.key} t={t} me={team} commish={team.commissioner} onAct={act} busy={busy || writeOk === false} />)}</div>}
          </Section>
        </>
      )}
      <ProposeSheet L={L} me={team} open={propose} onClose={() => setPropose(false)} onDone={() => { setPropose(false); load(); }} />
    </div>
  );
}

function ProposeSheet({ L, me, open, onClose, onDone }: { L: YLeagueFull; me: YTeam; open: boolean; onClose: () => void; onDone: () => void }) {
  const others = L.teams.filter((t) => t.key !== me.key);
  const [partner, setPartner] = useState('');
  const [mine, setMine] = useState<YPlayer[] | null>(null);
  const [theirs, setTheirs] = useState<YPlayer[] | null>(null);
  const [give, setGive] = useState<Set<string>>(new Set());
  const [get, setGet] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  useEffect(() => { if (open) { yahoo<YRoster>('roster', { team_key: me.key }).then((r) => setMine(r.players), () => setMine([])); setGive(new Set()); setGet(new Set()); setNote(''); } }, [open, me.key]);
  useEffect(() => { setTheirs(null); setGet(new Set()); if (partner) yahoo<YRoster>('roster', { team_key: partner }).then((r) => setTheirs(r.players), () => setTheirs([])); }, [partner]);
  const toggle = (s: Set<string>, k: string, set: (v: Set<string>) => void) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); set(n); };
  const pick = (list: YPlayer[] | null, sel: Set<string>, set: (v: Set<string>) => void) => (
    !list ? <Spinner /> : <div className="max-h-56 overflow-y-auto rounded-xl border border-white/[.08] px-2">{list.map((p) => <label key={p.key} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" className="h-4 w-4 accent-sky-400" checked={sel.has(p.key)} onChange={() => toggle(sel, p.key, set)} /><span className="truncate">{p.name} <span className="text-mute">{p.team} {p.pos}{p.status ? ` · ${p.status}` : ''}</span></span></label>)}</div>
  );
  return (
    <Sheet open={open} onClose={onClose} title="Propose a trade on Yahoo">
      <div className="space-y-3 p-1">
        <select className="input" value={partner} onChange={(e) => setPartner(e.target.value)}><option value="">Trade with…</option>{others.map((t) => <option key={t.key} value={t.key}>{t.name}{t.managers[0] ? ` (${t.managers[0]})` : ''}</option>)}</select>
        <div><div className="label mb-1">You give</div>{pick(mine, give, setGive)}</div>
        {partner && <div><div className="label mb-1">You get</div>{pick(theirs, get, setGet)}</div>}
        <input className="input" placeholder="Note to the other GM (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-primary w-full" disabled={busy || !partner || (give.size === 0 && get.size === 0)} onClick={() => run(async () => {
          await yahoo('propose_trade', { league_key: L.key, trader_team_key: me.key, tradee_team_key: partner, note: note || undefined, players: [...[...give].map((k) => ({ player_key: k, from: me.key, to: partner })), ...[...get].map((k) => ({ player_key: k, from: partner, to: me.key }))] });
          onDone();
        }, 'Trade proposed on Yahoo')}>Send proposal</button>
      </div>
    </Sheet>
  );
}

// ───────────── more: settings and Yahoo links ─────────────
function MoreTab({ L }: { L: YLeagueFull }) {
  const s = L.settings;
  const base = L.url?.replace(/\/$/, '');
  const links = base ? [['League home', base], ['Standings', `${base}/standings`], ['Players', `${base}/players`], ['Transactions', `${base}/transactions`], ['League settings', `${base}/settings`], ['Message board', `${base}/messages`]] : [];
  return (
    <div className="space-y-3">
      <Section title="On Yahoo">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {links.map(([l, u]) => <a key={l} href={u} target="_blank" rel="noreferrer" className="card flex items-center justify-between px-3 py-2.5 text-sm"><span>{l}</span><ExternalLink size={14} className="text-mute" /></a>)}
          {L.me?.url && <a href={L.me.url} target="_blank" rel="noreferrer" className="card flex items-center justify-between px-3 py-2.5 text-sm"><span>My team page</span><ExternalLink size={14} className="text-mute" /></a>}
        </div>
        <p className="mt-2 text-xs text-mute">Yahoo’s API covers lineups, adds, drops, claims and trades (including commissioner approvals). Everything else a commissioner does, such as editing settings, scores, keepers or managers, still happens on Yahoo’s own pages, so those are one tap away above.</p>
      </Section>
      <Section title="Roster">
        <div className="flex flex-wrap gap-1">{s.positions.map((p) => <span key={p.pos} className="chip">{p.count} × {p.pos}</span>)}</div>
        <div className="mt-2 text-xs text-mute">{s.weeklyDeadline === 'intraday' || !s.weeklyDeadline ? 'Daily lineups' : `Weekly lineups (deadline: ${s.weeklyDeadline})`}{s.maxAdds ? ` · ${s.maxAdds} adds max` : ''}{s.maxTrades ? ` · ${s.maxTrades} trades max` : ''}</div>
      </Section>
      <Section title="Scoring">
        <div className="flex flex-wrap gap-1">{s.stats.filter((c) => !c.displayOnly).map((c) => <span key={`${c.type}${c.id}`} className={`chip ${c.type === 'G' ? 'bg-sky-500/15 text-sky-200' : ''}`}>{c.name}</span>)}</div>
      </Section>
      <Section title="Rules">
        <div className="card divide-y divide-white/[.06] text-sm">
          {[['Scoring', SCORING[s.scoring] ?? s.scoring], ['Draft', s.draftType], ['Playoffs', s.playoffs ? `${s.playoffTeams ?? ''} teams from week ${s.playoffStart ?? ''}` : 'None'], ['Waivers', s.faab ? 'FAAB budget' : s.waiverType === 'R' ? 'Continual rolling' : s.waiverType ?? '—'], ['Trade deadline', s.tradeEnd ?? 'None'], ['Trade review', s.tradeRatify === 'commish' ? 'Commissioner' : s.tradeRatify === 'vote' ? 'League vote' : 'None'], ['Commissioner', L.teams.flatMap((t) => t.commishNames).join(', ') || '—']].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-3 py-2"><span className="text-mute">{k}</span><span className="text-right">{v}</span></div>
          ))}
        </div>
      </Section>
    </div>
  );
}
