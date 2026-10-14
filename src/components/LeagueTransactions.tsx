import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { realtimeChannel, supabase } from '../lib/supabase';
import { ago } from '../lib/format';
import type { Player, Transaction } from '../lib/types';
import { PlayerTag } from './PlayerCard';
import { GmPicker } from './GmPicker';
import { Section, TeamBadge } from './ui';

// Every move in the league in one place (14 October 2026, Patrick: "a global transactions on the homepage that lets you
// see all transactions and trades"): adds and drops, trades, the draft and the keepers, filtered by kind and by GM.
// An add and the drop made with it read as one move; a trade's players read as one trade, each side what it got.
type Kind = 'moves' | 'add' | 'drop' | 'trade' | 'draft' | 'keeper' | 'all';
const KINDS: { k: Kind; label: string; types: string[] | null }[] = [
  { k: 'moves', label: 'Moves & trades', types: ['add', 'drop', 'trade', 'commish'] },
  { k: 'add', label: 'Adds', types: ['add'] },
  { k: 'drop', label: 'Drops', types: ['drop'] },
  { k: 'trade', label: 'Trades', types: ['trade'] },
  { k: 'draft', label: 'Draft', types: ['draft'] },
  { k: 'keeper', label: 'Keepers', types: ['keeper', 'release'] },
  { k: 'all', label: 'Everything', types: null },
];
const ICON: Record<string, string> = { add: '➕', drop: '➖', trade: '🔄', draft: '📋', keeper: '🔒', release: '↩️', commish: '🛠️' };
const VERB: Record<string, string> = { add: 'added', drop: 'dropped', draft: 'drafted', keeper: 'kept', release: 'released', commish: 'moved by the commissioner' };
const PAGE = 40;

// a run of rows that read as one move: a trade (by its note), or one team's adds and drops in the same few seconds
type Entry = { key: string; kind: 'trade' | 'move'; at: string; team: number | null; rows: Transaction[] };
function group(rows: Transaction[]): Entry[] {
  const out: Entry[] = [];
  for (const x of rows) {
    const last = out[out.length - 1];
    if (x.type === 'trade' && x.note) {
      const same = out.find((e) => e.kind === 'trade' && e.rows[0].note === x.note);
      if (same) { same.rows.push(x); continue; }
      out.push({ key: `t${x.id}`, kind: 'trade', at: x.created_at, team: null, rows: [x] });
      continue;
    }
    if (last && last.kind === 'move' && last.team === x.team_id && (x.type === 'add' || x.type === 'drop') && last.rows.every((r) => r.type === 'add' || r.type === 'drop')
        && Math.abs(new Date(last.at).getTime() - new Date(x.created_at).getTime()) < 10_000) { last.rows.push(x); continue; }
    out.push({ key: `m${x.id}`, kind: 'move', at: x.created_at, team: x.team_id, rows: [x] });
  }
  return out;
}

export function LeagueTransactions() {
  const { team, players, league } = useLeague();
  const now = useNow(60_000);
  const [kind, setKind] = useState<Kind>('moves');
  const [gm, setGm] = useState<number | null>(null);
  const [rows, setRows] = useState<Transaction[] | null>(null);
  const [more, setMore] = useState(false);
  const types = KINDS.find((k) => k.k === kind)!.types;

  const load = useCallback(async (before?: number) => {
    let q = supabase.from('transactions').select('*').order('id', { ascending: false }).limit(PAGE);
    if (types) q = q.in('type', types);
    if (gm) q = q.or(`team_id.eq.${gm},other_team.eq.${gm}`);
    if (before) q = q.lt('id', before);
    const { data } = await q;
    const got = (data ?? []) as Transaction[];
    setMore(got.length === PAGE);
    setRows((r) => (before ? [...(r ?? []), ...got] : got));
  }, [types?.join(), gm]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setRows(null); load(); }, [load]);
  // a move made anywhere in the league lands here as it happens
  useEffect(() => {
    const ch = realtimeChannel('league-tx').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, (p) => {
      const n = p.new as Transaction & { league_id?: number };
      if (league?.league_id != null && n.league_id != null && n.league_id !== league.league_id) return;
      load();
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, league?.league_id]);

  const entries = useMemo(() => group(rows ?? []), [rows]);
  const P = (id: number | null) => (id != null ? players.get(id) : undefined);
  const name = (p: Player | undefined, id: number | null) => (p ? <PlayerTag p={p} className="font-semibold text-slate-100" /> : <span className="text-mute">Player #{id}</span>);
  const who = (id: number | null) => { const t = team(id ?? undefined); return t ? <span className="font-semibold" style={{ color: 'inherit' }}>{t.gm_name}</span> : <span>Free agents</span>; };

  return (
    <Section icon={<ArrowLeftRight size={17} className="text-gold" />} title="League transactions" right={<Link to="/trades" className="text-sm font-semibold text-sky-300">Trades →</Link>}>
      <div className="card overflow-visible">
        <div className="flex items-center gap-1.5 border-b border-white/[.06] p-2">
          <GmPicker value={gm} onChange={setGm} spectators={false} />
          <span className="h-5 w-px shrink-0 bg-white/10" />
          <div className="scroll-x flex min-w-0 flex-1 gap-1.5">
            {KINDS.map((k) => (
              <button key={k.k} onClick={() => setKind(k.k)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${kind === k.k ? 'bg-white text-ice' : 'border border-white/[.07] bg-white/[.05] text-slate-300'}`}>{k.label}</button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-white/[.06]">
          {rows === null && [0, 1, 2].map((i) => <div key={i} className="m-2 h-11 animate-pulse rounded-xl bg-white/[.04]" />)}
          {rows && entries.length === 0 && <div className="p-4 text-sm text-mute">Nothing {gm ? `for ${team(gm)?.gm_name}` : 'yet'} under {KINDS.find((k) => k.k === kind)!.label.toLowerCase()}.</div>}
          {entries.map((e) => {
            if (e.kind === 'trade') {
              // each side: what it got, and from whom
              const sides = [...new Set(e.rows.map((r) => r.team_id))];
              return (
                <div key={e.key} className="flex gap-2.5 px-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold/15 text-sm ring-1 ring-gold/30">🔄</span>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex items-baseline gap-2"><span className="font-bold text-gold">Trade</span><span className="text-xs text-mute">{ago(e.at, now)}</span></div>
                    {sides.map((s) => {
                      const got = e.rows.filter((r) => r.team_id === s);
                      return (
                        <div key={s ?? 0} className="mt-1 flex items-start gap-2">
                          <TeamBadge team={team(s ?? undefined)} size={20} />
                          <div className="min-w-0 leading-snug"><span className="text-slate-300">{who(s)} gets </span>
                            {got.map((r, i) => <Fragment key={r.id}>{i > 0 && ', '}{name(P(r.player_id), r.player_id)}</Fragment>)}
                            {got[0]?.other_team != null && <span className="text-mute"> from {team(got[0].other_team)?.gm_name}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }
            const t = team(e.team ?? undefined);
            return (
              <div key={e.key} className="flex items-start gap-2.5 px-3 py-2.5">
                <TeamBadge team={t} size={32} />
                <div className="min-w-0 flex-1 text-sm leading-snug">
                  <div className="flex items-baseline gap-2"><span className="font-bold text-slate-100">{t?.gm_name ?? 'League'}</span><span className="truncate text-xs text-mute">{t?.name}</span><span className="ml-auto shrink-0 text-xs text-mute">{ago(e.at, now)}</span></div>
                  {[...e.rows].sort((a, b) => (a.type === 'add' ? -1 : 0) - (b.type === 'add' ? -1 : 0) || a.id - b.id).map((r) => (
                    <div key={r.id} className="mt-0.5 flex items-center gap-1.5">
                      <span className="w-4 shrink-0 text-center text-xs">{ICON[r.type] ?? '•'}</span>
                      <span className="min-w-0">{name(P(r.player_id), r.player_id)} <span className="text-mute">{VERB[r.type] ?? r.type}{r.fee ? ` · $${r.fee}` : ''}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {more && rows && (
          <button onClick={() => load(rows[rows.length - 1].id)} className="w-full border-t border-white/[.06] py-2.5 text-sm font-semibold text-sky-300 hover:bg-white/[.03]">Show more</button>
        )}
      </div>
    </Section>
  );
}
