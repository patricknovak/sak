import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import type { LedgerRow, Proposal, Vote } from '../lib/types';
import { fmtMoney, fmtPts, STAT_LABELS } from '../lib/format';
import { ALL_TIME_2425, RULES, SEASONS, TIMELINE, TROPHIES, allTime, type GM } from '../data/history';
import { Section, Sheet, TeamBadge, TeamName, useAction, PageHeader } from '../components/ui';
import { Landmark } from 'lucide-react';

type Tab = 'history' | 'rules' | 'money' | 'votes';

export default function LeaguePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('t') as Tab) ?? 'history';
  return (
    <div className="space-y-4">
      <PageHeader icon={<Landmark size={22} className="text-gold" />} title="She’s A Keeper" sub="Est. September 2013 · 13th season" />
      <div className="scroll-x flex gap-1">
        {([['history', '📜 History'], ['rules', '📘 Rules'], ['money', '💰 Money'], ['votes', '🗳️ Proposals']] as const).map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setParams({ t: k })}>{l}</button>
        ))}
      </div>
      {tab === 'history' && <History />}
      {tab === 'rules' && <Rules />}
      {tab === 'money' && <Money />}
      {tab === 'votes' && <Votes />}
    </div>
  );
}

function History() {
  const [open, setOpen] = useState<string | null>(SEASONS[0].season);
  const champs = useMemo(() => {
    const c = new Map<GM, number>(), p = new Map<GM, number>(), money = new Map<GM, number>();
    for (const s of SEASONS) {
      c.set(s.rows[0].gm, (c.get(s.rows[0].gm) ?? 0) + 1);
      const peter = s.rows.find((r) => r.peter);
      if (peter) p.set(peter.gm, (p.get(peter.gm) ?? 0) + 1);
      for (const r of s.rows) if (r.prize) money.set(r.gm, (money.get(r.gm) ?? 0) + r.prize);
    }
    return { c: [...c].sort((a, b) => b[1] - a[1]), p: [...p].sort((a, b) => b[1] - a[1]), money: [...money].sort((a, b) => b[1] - a[1]) };
  }, []);
  const at = allTime();
  // a colour per GM so each banner looks like it belongs to its franchise
  const { teams } = useLeague();
  const gmColor = (gm: string) => teams.find((t) => t.gm_name === gm)?.color ?? '#4b5878';
  return (
    <div className="space-y-5">
      {/* championship banners in the rafters */}
      <div className="card overflow-hidden p-0">
        <div className="label flex items-center gap-1.5 px-3 pt-3 text-white/70">🏟️ Raised to the rafters</div>
        <div className="scroll-x flex gap-2.5 px-3 pb-4 pt-3">
          {SEASONS.map((s) => {
            const w = s.rows[0]; const c = gmColor(w.gm);
            return (
              <div key={s.season} className="relative w-24 shrink-0">
                <div className="mx-auto h-2 w-20 rounded-full bg-white/20" />
                <div className="relative -mt-1 flex h-36 flex-col items-center px-1.5 pt-3 text-center shadow-[0_18px_30px_-16px_rgba(0,0,0,.9)]"
                  style={{ background: `linear-gradient(180deg, ${c}, color-mix(in oklab, ${c} 55%, black))`, clipPath: 'polygon(0 0, 100% 0, 100% 86%, 50% 100%, 0 86%)' }}>
                  <div className="text-lg">🏆</div>
                  <div className="h-display text-[11px] leading-tight text-white/80">Champions</div>
                  <div className="mt-1 line-clamp-2 text-[11px] font-bold leading-tight text-white">{w.team}</div>
                  <div className="text-[10px] text-white/70">{w.gm}</div>
                  <div className="h-display mt-auto pb-5 text-base text-white">{s.season}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {TROPHIES.map((t) => (
          <div key={t.name} className="card relative overflow-hidden p-3">
            <div className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gold/20 blur-2xl" />
            <div className="relative grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-gold/30 to-gold/5 text-3xl ring-1 ring-gold/30">{t.emoji}</div>
            <div className="h-display text-gold-shine mt-2 text-xl">{t.name}</div>
            <div className="text-[11px] text-mute">since {t.since}</div>
            <p className="mt-1 text-sm text-slate-300">{t.desc}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="🏆 Titles">
          <div className="card divide-y divide-white/[.06]">{champs.c.map(([gm, n]) => <div key={gm} className="flex items-center justify-between px-3 py-2 text-sm"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: gmColor(gm) }} />{gm}</span><span className="font-semibold">{'🏆'.repeat(n)}</span></div>)}</div>
        </Section>
        <Section title="🪣 Peters">
          <div className="card divide-y divide-white/[.06]">{champs.p.map(([gm, n]) => <div key={gm} className="flex justify-between px-3 py-2 text-sm"><span>{gm}</span><span>{'🪣'.repeat(n)}</span></div>)}</div>
        </Section>
        <Section title="💵 Career winnings">
          <div className="card divide-y divide-white/[.06]">{champs.money.map(([gm, n]) => <div key={gm} className="flex justify-between px-3 py-2 text-sm"><span>{gm}</span><span className="font-semibold">{fmtMoney(n)}</span></div>)}</div>
        </Section>
      </div>

      <Section title="All-time points (through 2025-26)">
        <div className="card divide-y divide-white/[.06]">
          {at.map((r, i) => (
            <div key={r.teamId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-5 font-display text-lg text-mute">{i + 1}</span>
              <span className="flex-1">{r.franchise}{r.credit && <span className="text-xs text-mute"> · incl. expansion credit</span>}</span>
              <span className="font-semibold">{fmtPts(r.points)}</span>
            </div>
          ))}
        </div>
        <p className="mt-1 px-1 text-xs text-mute">From the league spreadsheet’s official all-time table ({ALL_TIME_2425.length} franchises through 2024-25) plus 2025-26. Expansion teams get the league average for seasons before they joined.</p>
      </Section>

      <Section title="Season by season">
        <div className="space-y-2">
          {SEASONS.map((s) => (
            <div key={s.season} className="card overflow-hidden">
              <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={() => setOpen(open === s.season ? null : s.season)}>
                <span className="h-display w-16 text-lg">{s.season}</span>
                <span className="flex-1 truncate text-sm">🏆 {s.rows[0].team} <span className="text-mute">({s.rows[0].gm})</span></span>
                <span className="text-mute">{open === s.season ? '▾' : '▸'}</span>
              </button>
              {open === s.season && (
                <div className="border-t border-line">
                  {s.note && <p className="px-3 pt-2 text-xs italic text-slate-300">{s.note}</p>}
                  {s.rows.map((r, i) => (
                    <div key={r.team} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                      <span className="w-5 text-mute">{i + 1}</span>
                      <span className="flex-1 truncate">{r.team} <span className="text-mute">· {r.gm}</span> {r.peter && '🪣'}</span>
                      {r.prize && <span className="text-xs text-gold">{fmtMoney(r.prize)}</span>}
                      <span className="w-16 text-right font-semibold">{fmtPts(r.points, 1)}</span>
                    </div>
                  ))}
                  {s.peterPenalty && <p className="px-3 pb-2 text-xs text-mute">Peter Punishment paid to the SaK Fund: {fmtMoney(s.peterPenalty)}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Timeline">
        <div className="card p-3">
          <ol className="relative space-y-3 border-l border-line pl-4">
            {TIMELINE.map((t) => (
              <li key={t.when + t.what}><span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-goal" /><div className="text-xs text-mute">{t.when}</div><div className="text-sm">{t.what}</div></li>
            ))}
          </ol>
        </div>
      </Section>
    </div>
  );
}

function Rules() {
  const { league } = useLeague();
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {RULES.map((r) => (
          <div key={r.title} className="card p-4">
            <h3 className="h-display text-lg">{r.title}</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-300">{r.items.map((i) => <li key={i} className="flex gap-2"><span className="text-goal">•</span><span>{i}</span></li>)}</ul>
          </div>
        ))}
      </div>
      {league && (
        <Section title="Scoring">
          <div className="grid gap-3 sm:grid-cols-2">
            {(['skater', 'goalie'] as const).map((k) => (
              <div key={k} className="card p-3">
                <div className="label mb-2">{k === 'skater' ? 'Forwards & defence' : 'Goalies'}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {Object.entries(league.scoring[k]).map(([s, v]) => (
                    <div key={s} className="rounded-lg bg-boards/60 px-2 py-1.5 text-center"><div className="text-[11px] text-mute">{STAT_LABELS[s] ?? s}</div><div className={`font-semibold ${v < 0 ? 'text-red-300' : ''}`}>{v > 0 ? '+' : ''}{v}</div></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Money() {
  const { league, team, teams, me } = useLeague();
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const { run } = useAction();
  const load = () => supabase.from('ledger').select('*').order('id', { ascending: false }).then(({ data }) => setLedger((data ?? []) as LedgerRow[]));
  useEffect(() => { load(); }, []);
  const info = league?.info ?? {};
  const pool = ((league?.entry_fee ?? 200) - (league?.sak_fee ?? 25)) * teams.length;
  const split = league?.prize_split ?? [60, 30, 10];
  const owing = teams.map((t) => ({ t, amt: ledger.filter((l) => l.team_id === t.id && !l.paid).reduce((s, l) => s + Number(l.amount), 0) })).filter((x) => x.amt);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><div className="label">{league?.season} prize pool</div><div className="font-display text-3xl font-bold text-gold">{fmtMoney(pool)}</div>
          <div className="mt-1 text-xs text-mute">{split.map((p, i) => `${['1st', '2nd', '3rd'][i]} ${fmtMoney((p / 100) * pool)}`).join(' · ')}</div></div>
        <div className="card p-4"><div className="label">Entry</div><div className="font-display text-3xl font-bold">{fmtMoney(league?.entry_fee)}</div><div className="mt-1 text-xs text-mute">incl. {fmtMoney(league?.sak_fee)} to the SaK Fund</div></div>
        {info.fund && <div className="card p-4"><div className="label">SaK Fund</div><div className="font-display text-3xl font-bold">{fmtMoney(info.fund.valueCad)}</div>
          <div className="mt-1 text-xs text-mute">{fmtMoney(info.fund.perMember)} per GM · {info.fund.holding} · as of {info.fund.asOf}</div></div>}
      </div>
      {info.peterOwed && <div className="card border-amber-500/30 bg-amber-500/10 p-3 text-sm">🪣 {info.peterOwed.season} Peter Punishment: {info.peterOwed.team} owes {fmtMoney(info.peterOwed.amount)} to the SaK Fund.</div>}
      {owing.length > 0 && (
        <Section title="Owing">
          <div className="card divide-y divide-white/[.06]">{owing.map(({ t, amt }) => <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm"><TeamBadge team={t} size={22} /><TeamName team={t} /><span className="ml-auto font-semibold">{fmtMoney(amt)}</span></div>)}</div>
        </Section>
      )}
      <Section title="Ledger">
        <div className="card divide-y divide-white/[.06]">
          {ledger.length === 0 && <div className="p-4 text-sm text-mute">No fees or fines yet this season. Behave.</div>}
          {ledger.map((l) => (
            <div key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <TeamBadge team={team(l.team_id)} size={22} />
              <div className="min-w-0 flex-1"><div className="truncate">{l.description}</div><div className="text-[11px] text-mute">{l.kind} · {l.season}</div></div>
              <span className="font-semibold">{fmtMoney(l.amount)}</span>
              {me?.is_commish ? <button className={`chip ${l.paid ? 'text-emerald-300' : 'text-amber-300'}`} onClick={() => run(async () => { await rpc('commish_mark_paid', { p_id: l.id, p_paid: !l.paid }); load(); })}>{l.paid ? 'paid' : 'unpaid'}</button>
                : <span className={`chip ${l.paid ? 'text-emerald-300' : 'text-amber-300'}`}>{l.paid ? 'paid' : 'unpaid'}</span>}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Votes() {
  const { me, team, teams, league } = useLeague();
  const [props, setProps] = useState<Proposal[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', body: '' });
  const { busy, run } = useAction();
  const load = () => {
    supabase.from('proposals').select('*').order('id', { ascending: false }).then(({ data }) => setProps((data ?? []) as Proposal[]));
    supabase.from('proposal_votes').select('*').then(({ data }) => setVotes((data ?? []) as Vote[]));
  };
  useEffect(() => { load(); }, []);
  const rookie = me?.joined_season === league?.season;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-mute">Proposals need a co-sponsor to go to a vote. Simple majority; the commish has veto.</p>
        <button className="btn-primary shrink-0" onClick={() => setOpen(true)}>+ Propose</button>
      </div>
      {props.map((p) => {
        const v = votes.filter((x) => x.proposal_id === p.id);
        const yes = v.filter((x) => x.vote === 'yes').length, no = v.filter((x) => x.vote === 'no').length;
        const my = v.find((x) => x.team_id === me?.id)?.vote;
        const live = p.status === 'open' && p.cosponsor_team;
        return (
          <div key={p.id} className="card p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.title}</div>
                <div className="text-xs text-mute">by {team(p.sponsor_team)?.gm_name ?? '—'}{p.cosponsor_team && ` & ${team(p.cosponsor_team)?.gm_name}`}</div>
              </div>
              <span className={`chip ${p.status === 'passed' ? 'text-emerald-300' : p.status === 'open' ? 'text-sky-300' : ''}`}>{p.status === 'open' && !p.cosponsor_team ? 'needs co-sponsor' : p.status}</span>
            </div>
            {p.body && <p className="mt-2 text-sm text-slate-300">{p.body}</p>}
            {(live || v.length > 0) && (
              <div className="mt-2">
                <div className="flex h-2 overflow-hidden rounded-full bg-boards"><div className="bg-emerald-500" style={{ width: `${(yes / teams.length) * 100}%` }} /><div className="bg-red-500" style={{ width: `${(no / teams.length) * 100}%` }} /></div>
                <div className="mt-1 text-xs text-mute">{yes} yes · {no} no · {teams.length - v.length} not voted</div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {live && !rookie && (['yes', 'no', 'abstain'] as const).map((x) => (
                <button key={x} className={`btn-sm ${my === x ? 'btn-primary' : 'btn-ghost'}`} disabled={busy} onClick={() => run(async () => { await rpc('vote_proposal', { p_id: p.id, p_vote: x }); load(); }, 'Vote recorded')}>{x === 'yes' ? '👍 Yes' : x === 'no' ? '👎 No' : 'Abstain'}</button>
              ))}
              {p.status === 'open' && !p.cosponsor_team && p.sponsor_team !== me?.id && (
                <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('cosponsor_proposal', { p_id: p.id }); load(); }, 'Co-sponsored. Voting is open!')}>🤝 Co-sponsor</button>
              )}
              {me?.is_commish && (
                <select className="ml-auto rounded-lg border border-line bg-boards px-2 py-1 text-xs" value="" onChange={(e) => e.target.value && run(async () => { await rpc('close_proposal', { p_id: p.id, p_status: e.target.value }); load(); })}>
                  <option value="">Commish…</option>
                  {['open', 'passed', 'failed', 'vetoed', 'tabled'].map((s) => <option key={s} value={s}>Mark {s}</option>)}
                </select>
              )}
            </div>
          </div>
        );
      })}
      <Sheet open={open} onClose={() => setOpen(false)} title="New rule proposal">
        <div className="space-y-2">
          <input className="input" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <textarea className="input" rows={5} placeholder="What should change, and why?" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <button className="btn-primary w-full" disabled={busy || !f.title.trim()} onClick={() => run(async () => { await rpc('create_proposal', { p_title: f.title, p_body: f.body }); setOpen(false); setF({ title: '', body: '' }); load(); }, 'Proposal posted')}>Submit</button>
        </div>
      </Sheet>
    </div>
  );
}
