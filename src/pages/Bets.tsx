import { useEffect, useMemo, useState } from 'react';
import { useLeague, useNow } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import type { Bet } from '../lib/types';
import { ago, etToday, fmtDate, fmtMoney, fmtPts } from '../lib/format';
import { Empty, Section, Sheet, TeamBadge, TeamName, useAction } from '../components/ui';

interface Daily { team_id: number; date: string; points: number }

const IDEAS = [
  'Most fantasy points this week', 'Loser wears the winner’s team jersey to the next GM meetup', 'Who finishes higher in the standings',
  'Over/under 45 goals for Matthews', 'Loser posts a photo in a Leafs jersey', 'First to 1,000 points',
];

export default function Bets() {
  const { me, teams, team, standings } = useLeague();
  const now = useNow(30_000);
  const { busy, run } = useAction();
  const [bets, setBets] = useState<Bet[]>([]);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ opponent: '' as string, title: '', terms: '', kind: 'custom' as Bet['kind'], stake: '', amount: '', start: etToday(), end: '' });

  const load = () => supabase.from('bets').select('*').order('id', { ascending: false }).then(({ data }) => setBets((data ?? []) as Bet[]));
  useEffect(() => {
    load();
    supabase.from('team_daily').select('team_id,date,points').then(({ data }) => setDaily((data ?? []) as Daily[]));
    const ch = supabase.channel('bets-page').on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const h2h = (b: Bet, t: number | null) => daily.filter((d) => d.team_id === t && (!b.start_date || d.date >= b.start_date) && (!b.end_date || d.date <= b.end_date)).reduce((s, d) => s + Number(d.points), 0);
  const rank = (t: number | null) => standings.find((s) => s.team_id === t)?.rank;

  const create = () => run(async () => {
    await rpc('create_bet', {
      p_opponent: f.opponent ? Number(f.opponent) : null, p_title: f.title, p_terms: f.terms || null, p_kind: f.kind,
      p_stake: f.stake || null, p_amount: f.amount ? Number(f.amount) : null,
      p_start: f.kind === 'h2h' ? f.start || null : null, p_end: f.kind === 'h2h' ? f.end || null : null,
    });
    setOpen(false); setF({ ...f, title: '', terms: '', stake: '', amount: '' }); load();
  }, 'Bet posted 🎲');

  const groups = useMemo(() => ({
    open: bets.filter((b) => b.status === 'open'),
    live: bets.filter((b) => b.status === 'accepted'),
    settled: bets.filter((b) => b.status === 'settled'),
  }), [bets]);

  // who owes whom (unpaid cash bets)
  const owed = groups.settled.filter((b) => !b.paid && (b.amount ?? 0) > 0);
  const record = (t: number) => ({
    w: groups.settled.filter((b) => b.winner_team === t).length,
    l: groups.settled.filter((b) => b.winner_team && b.winner_team !== t && (b.creator_team === t || b.opponent_team === t)).length,
  });

  const BetCard = ({ b }: { b: Bet }) => {
    const mine = b.creator_team === me?.id || b.opponent_team === me?.id;
    const other = b.creator_team === me?.id ? b.opponent_team : b.creator_team;
    return (
      <div className={`card p-3 ${mine ? 'border-sky-500/40' : ''}`}>
        <div className="flex items-start gap-2">
          <div className="flex -space-x-2"><TeamBadge team={team(b.creator_team)} size={30} /><TeamBadge team={team(b.opponent_team)} size={30} /></div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-snug">{b.title}</div>
            <div className="text-xs text-mute">
              <TeamName team={team(b.creator_team)} /> vs {b.opponent_team ? <TeamName team={team(b.opponent_team)} /> : <span className="text-amber-300">anyone</span>} · {ago(b.created_at, now)}
            </div>
          </div>
          {(b.amount || b.stake) && <div className="text-right text-sm"><div className="font-display text-lg font-bold text-gold">{b.amount ? fmtMoney(b.amount) : ''}</div><div className="max-w-28 text-[11px] text-mute">{b.stake}</div></div>}
        </div>
        {b.terms && <p className="mt-2 text-sm text-slate-300">{b.terms}</p>}
        {b.kind === 'h2h' && b.opponent_team && (
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-boards/60 p-2 text-center">
            {[b.creator_team, b.opponent_team].map((t) => (
              <div key={t}><div className="text-xs text-mute">{team(t)?.gm_name}</div><div className="font-display text-2xl font-bold">{fmtPts(h2h(b, t))}</div></div>
            ))}
            <div className="col-span-2 text-[11px] text-mute">Fantasy points {b.start_date ? fmtDate(b.start_date) : 'start'} → {b.end_date ? fmtDate(b.end_date) : 'season end'}</div>
          </div>
        )}
        {b.kind === 'season' && b.opponent_team && (
          <div className="mt-2 text-xs text-mute">Currently: {team(b.creator_team)?.gm_name} #{rank(b.creator_team) ?? '–'} · {team(b.opponent_team)?.gm_name} #{rank(b.opponent_team) ?? '–'}</div>
        )}
        {b.status === 'settled' && (
          <div className="mt-2 flex items-center gap-2 text-sm">🏆 <TeamName team={team(b.winner_team!)} /> won {b.paid ? <span className="chip text-emerald-300">paid</span> : (b.amount ? <span className="chip text-amber-300">unpaid</span> : null)}
            {!b.paid && (b.winner_team === me?.id || me?.is_commish) && (b.amount || b.stake) && <button className="btn-ghost btn-sm ml-auto" onClick={() => run(async () => { await rpc('mark_bet_paid', { p_bet: b.id }); load(); }, 'Marked paid')}>Mark paid</button>}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {b.status === 'open' && b.creator_team !== me?.id && (!b.opponent_team || b.opponent_team === me?.id) && (
            <>
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('respond_bet', { p_bet: b.id, p_accept: true }); load(); }, 'You’re on! 🤝')}>Take the bet</button>
              {b.opponent_team === me?.id && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('respond_bet', { p_bet: b.id, p_accept: false }); load(); }, 'Declined 🐔')}>Decline</button>}
            </>
          )}
          {b.status === 'open' && b.creator_team === me?.id && <button className="btn-ghost btn-sm" onClick={() => run(async () => { await rpc('cancel_bet', { p_bet: b.id }); load(); })}>Cancel</button>}
          {b.status === 'accepted' && mine && !b.proposed_winner && (
            <>
              <button className="btn-blue btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('claim_bet', { p_bet: b.id, p_winner: me!.id }); load(); }, 'Claim sent. They need to confirm.')}>I won</button>
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => confirm('Concede this bet?') && run(async () => { await rpc('claim_bet', { p_bet: b.id, p_winner: other }); load(); }, 'Conceded. Pay up. 💸')}>I lost</button>
            </>
          )}
          {b.status === 'accepted' && b.proposed_winner && (
            b.proposed_by !== me?.id && mine ? (
              <><span className="self-center text-xs text-amber-200">{team(b.proposed_by)?.gm_name} claims the win.</span>
                <button className="btn-primary btn-sm" onClick={() => run(async () => { await rpc('confirm_bet', { p_bet: b.id }); load(); }, 'Settled')}>Confirm</button></>
            ) : <span className="text-xs text-mute">Waiting for {team(b.proposed_by === b.creator_team ? b.opponent_team : b.creator_team)?.gm_name} to confirm {team(b.proposed_winner)?.gm_name} won.</span>
          )}
          {b.status === 'accepted' && me?.is_commish && (
            <select className="ml-auto rounded-lg border border-line bg-boards px-2 py-1 text-xs" value="" onChange={(e) => e.target.value && run(async () => { await rpc('commish_settle_bet', { p_bet: b.id, p_winner: Number(e.target.value) }); load(); })}>
              <option value="">⚖️ Commish ruling…</option>
              {[b.creator_team, b.opponent_team].map((t) => <option key={t!} value={t!}>{team(t)?.name} wins</option>)}
            </select>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="h-display text-2xl">Side Bets</h1>
          <p className="text-sm text-mute">Put your money (or your dignity) where your mouth is.</p>
        </div>
        <button className="btn-primary" onClick={() => setOpen(true)}>🎲 New bet</button>
      </div>

      <div className="scroll-x flex gap-2">
        {teams.map((t) => { const r = record(t.id); return (
          <div key={t.id} className="card flex shrink-0 items-center gap-2 px-3 py-2"><TeamBadge team={t} size={24} /><div className="text-xs"><div className="font-semibold">{t.gm_name}</div><div className="text-mute">{r.w}-{r.l}</div></div></div>
        ); })}
      </div>

      {owed.length > 0 && (
        <Section title="💸 Outstanding">
          <div className="card divide-y divide-line">
            {owed.map((b) => {
              const loser = b.winner_team === b.creator_team ? b.opponent_team : b.creator_team;
              return <div key={b.id} className="flex items-center gap-2 px-3 py-2 text-sm"><TeamName team={team(loser)} /> owes <TeamName team={team(b.winner_team!)} /><span className="ml-auto font-semibold text-gold">{fmtMoney(b.amount)}</span></div>;
            })}
          </div>
        </Section>
      )}
      {groups.open.length > 0 && <Section title="Open challenges"><div className="grid gap-2 sm:grid-cols-2">{groups.open.map((b) => <BetCard key={b.id} b={b} />)}</div></Section>}
      <Section title="Live bets">
        {groups.live.length === 0 ? <div className="card"><Empty icon="🎲" title="No live bets">Challenge someone. You know who.</Empty></div>
          : <div className="grid gap-2 sm:grid-cols-2">{groups.live.map((b) => <BetCard key={b.id} b={b} />)}</div>}
      </Section>
      {groups.settled.length > 0 && <Section title="Settled"><div className="grid gap-2 sm:grid-cols-2">{groups.settled.map((b) => <BetCard key={b.id} b={b} />)}</div></Section>}

      <Sheet open={open} onClose={() => setOpen(false)} title="New side bet">
        <div className="space-y-3">
          <div>
            <div className="label mb-1">Who are you calling out?</div>
            <div className="flex flex-wrap gap-1.5">
              <button className={`chip py-1 ${f.opponent === '' ? 'bg-white text-ice' : ''}`} onClick={() => setF({ ...f, opponent: '' })}>Anyone (open)</button>
              {teams.filter((t) => t.id !== me?.id).map((t) => (
                <button key={t.id} className={`chip py-1 ${f.opponent === String(t.id) ? 'bg-white text-ice' : ''}`} onClick={() => setF({ ...f, opponent: String(t.id) })}>{t.emoji} {t.gm_name}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1">Type</div>
            <div className="flex gap-1.5">
              {([['custom', 'Anything'], ['h2h', 'Fantasy points H2H'], ['season', 'Final standings']] as const).map(([k, l]) => (
                <button key={k} className={`chip py-1 ${f.kind === k ? 'bg-white text-ice' : ''}`} onClick={() => setF({ ...f, kind: k })}>{l}</button>
              ))}
            </div>
          </div>
          <input className="input" placeholder="The bet (e.g. More points this week)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={140} />
          <div className="scroll-x flex gap-1">{IDEAS.map((i) => <button key={i} className="chip shrink-0" onClick={() => setF({ ...f, title: i })}>{i}</button>)}</div>
          <textarea className="input" rows={2} placeholder="Terms / fine print (optional)" value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />
          {f.kind === 'h2h' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-mute">From<input type="date" className="input mt-1" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
              <label className="text-xs text-mute">To<input type="date" className="input mt-1" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
            </div>
          )}
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <input className="input" inputMode="decimal" placeholder="$ amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} />
            <input className="input" placeholder="…and/or stakes: a two-four, dinner, bragging rights" value={f.stake} onChange={(e) => setF({ ...f, stake: e.target.value })} />
          </div>
          <button className="btn-primary w-full" disabled={busy || f.title.trim().length < 3} onClick={create}>Post it to the league</button>
          <p className="text-center text-xs text-mute">Bets are announced in Trash Talk. Settle up between yourselves; the commish is the final ruling.</p>
        </div>
      </Sheet>
    </div>
  );
}
