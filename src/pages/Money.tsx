// League money, in the open: this season's three pots, who owes what (last season's winnings net against this
// season's entry), what the commish holds and still has to pay, the league's fund and every line behind it. Everyone
// sees everything; only the commissioner can change it.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Wallet } from 'lucide-react';
import { useLeague } from '../lib/store';
import { realtimeChannel, rpc, selectAll, supabase } from '../lib/supabase';
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format';
import { PLACES, potsOf, prizes, type PotKey } from '../lib/prizes';
import { bare, useBrand } from '../lib/brand';
import type { FundLine, FundStatus, LedgerLine, MoneyBalance, PickupStatus, Standing } from '../lib/types';
import { MoneySettings } from '../components/MoneySettings';
import { hasFeature } from '../lib/features';
import { Sparkline } from '../components/charts';
import { PageHeader, Section, Sheet, TeamBadge, useAction } from '../components/ui';
import { useHistory } from '../lib/history';

const abs = (n: number) => fmtMoney(Math.abs(Math.round(n * 100) / 100));
const KIND: Record<string, string> = { entry: 'Entry', payout: 'Winnings', peter: 'Peter Punishment', acq_fee: 'Extra pickup', fine: 'Fine', adjust: 'Adjustment', credit: 'Credit' };
const FUND_KIND: Record<string, string> = { contribution: 'Contribution', peter: 'Peter Punishment', fee: 'Pickup fee', buy: 'Shares bought', sell: 'Shares sold', withdraw: 'Withdrawal', deposit: 'Deposit', adjust: 'Adjustment' };
const METHODS = ['e-transfer', 'cash', 'netted', 'in the fund', 'other'];

export default function Money() {
  const { me, team, teams, league, standings, playoffs, cup } = useLeague();
  const { seasons: SEASONS } = useHistory();
  const brand = useBrand();
  const POTS = potsOf(brand);
  const peter = `${bare(brand.booby)} Punishment`;
  const { busy, run } = useAction();
  const [lines, setLines] = useState<LedgerLine[]>([]);
  const [bal, setBal] = useState<MoneyBalance[]>([]);
  const [fund, setFund] = useState<FundStatus | null>(null);
  const [fundLines, setFundLines] = useState<FundLine[]>([]);
  const [prices, setPrices] = useState<{ date: string; value_cad: number }[]>([]);
  const [pickups, setPickups] = useState<PickupStatus[]>([]);
  const [open, setOpen] = useState<number | null>(me?.id ?? null);
  const [sheet, setSheet] = useState<null | 'line' | 'fund' | 'price' | 'settings' | 'pay'>(null);
  const commish = !!me?.is_commish;

  const load = () => {
    selectAll<LedgerLine>('ledger', '*', 1000, ['id']).then((r) => setLines(r.map((l) => ({ ...l, amount: Number(l.amount) })).sort((a, b) => b.id - a.id)), () => {});
    supabase.from('money_balances').select('*').then(({ data }) => setBal(((data ?? []) as MoneyBalance[]).map((b) => ({ ...b, balance: Number(b.balance), owes: Number(b.owes), owed: Number(b.owed), paid_in: Number(b.paid_in), paid_out: Number(b.paid_out) }))));
    supabase.from('fund_status').select('*').maybeSingle().then(({ data }) => setFund(data ? { ...(data as FundStatus), shares: Number(data.shares), cash: Number(data.cash), stock_cad: Number(data.stock_cad), net_cad: Number(data.net_cad), owed_back: Number(data.owed_back), price_usd: data.price_usd == null ? null : Number(data.price_usd), fx_usdcad: data.fx_usdcad == null ? null : Number(data.fx_usdcad) } : null));
    supabase.from('fund_ledger').select('*').order('date', { ascending: false }).order('id', { ascending: false }).then(({ data }) => setFundLines(((data ?? []) as FundLine[]).map((l) => ({ ...l, cash: Number(l.cash), shares: Number(l.shares) }))));
    supabase.from('fund_prices').select('date,value_cad').order('date').then(({ data }) => setPrices(((data ?? []) as { date: string; value_cad: number }[]).map((p) => ({ ...p, value_cad: Number(p.value_cad) }))));
    supabase.from('pickup_status').select('*').then(({ data }) => setPickups((data ?? []) as PickupStatus[]));
  };
  useEffect(() => {
    load();
    const ch = realtimeChannel('money').on('postgres_changes', { event: '*', schema: 'public', table: 'ledger' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const money = prizes(league, teams.length);
  const balOf = (id: number) => bal.find((b) => b.team_id === id);
  const toCollect = bal.filter((b) => b.balance > 0);
  const toPay = bal.filter((b) => b.balance < 0);
  const collectTotal = toCollect.reduce((s, b) => s + b.balance, 0);
  const payTotal = -toPay.reduce((s, b) => s + b.balance, 0);
  const perGm = fund && fund.members ? fund.net_cad / fund.members : 0;
  const mine = me ? balOf(me.id) : undefined;
  const myLines = lines.filter((l) => l.team_id === me?.id && !l.paid);
  const payNote = (league?.info?.pay_note as string | undefined) ?? 'Send an Interac e-Transfer to the commissioner. Winnings are sent the same way.';
  const tables: Record<PotKey, Standing[]> = { regular: standings, playoffs, cup };
  const useMoney = hasFeature(league, 'money'), useFund = hasFeature(league, 'fund');

  return (
    <div className="space-y-5">
      <PageHeader icon={<Wallet size={22} className="text-gold" />} title="Money" sub={`${league?.season ?? ''} · ${[useMoney && 'prize pools, who owes what', useFund && `the ${brand.fund}`].filter(Boolean).join(', and ') || 'pickups'}.${useMoney || useFund ? ' Everyone sees every dollar.' : ''}`}
        right={commish && useMoney ? <button className="btn-ghost btn-sm" onClick={() => setSheet('line')}>+ Add a line</button> : undefined} />

      {!useMoney && !useFund && (
        <div className="card p-4 text-sm text-mute">This league doesn't keep its money on the site.{commish ? ' You can turn on league money or a fund under League settings on the Commissioner page.' : ''}</div>
      )}

      {/* your balance */}
      {useMoney && me && me.role !== 'spectator' && mine && (
        <div className="card-hero p-4" style={{ '--tc': mine.balance > 0 ? '#ef2a4f' : mine.balance < 0 ? '#34d399' : '#4cc3ff' } as React.CSSProperties}>
          <div className="relative flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="label text-white/70">Your balance with the league</div>
              <div className="num text-gold-shine font-display text-5xl font-extrabold leading-none">{mine.balance === 0 ? 'All square' : abs(mine.balance)}</div>
              <div className="mt-1 text-sm text-white/80">{mine.balance > 0 ? 'You owe the league.' : mine.balance < 0 ? 'The league owes you.' : 'Nothing owed either way.'}</div>
            </div>
            {mine.balance > 0 && <div className="max-w-sm text-xs text-white/70">💳 {payNote}</div>}
          </div>
          {myLines.length > 0 && (
            <div className="relative mt-3 divide-y divide-white/10 rounded-xl bg-black/25 text-sm">
              {myLines.map((l) => <LineRow key={l.id} l={l} />)}
              <div className="flex items-center justify-between px-3 py-2 font-bold"><span>Net</span><span className={mine.balance > 0 ? 'text-red-200' : 'text-emerald-200'}>{mine.balance > 0 ? `you pay ${abs(mine.balance)}` : `you receive ${abs(mine.balance)}`}</span></div>
            </div>
          )}
          <p className="relative mt-2 text-[11px] text-white/60">Winnings are netted against your next entry: win more than {fmtMoney(league?.entry_fee)} and you're paid the difference, win less and you pay the rest.</p>
        </div>
      )}

      {/* the pots */}
      {useMoney && (
      <Section title={`${league?.season} prize pool`} right={<span className="text-xs text-mute">{money.teams} × {fmtMoney(money.entry - money.fund)} after {fmtMoney(money.fund)} each to the {brand.fund}</span>}>
        <div className="card-hero p-4" style={{ '--tc': '#f7c548' } as React.CSSProperties}>
          <div className="relative flex flex-wrap items-baseline gap-x-3">
            <div className="num text-gold-shine font-display text-5xl font-extrabold leading-none">{fmtMoney(money.pool)}</div>
            <div className="text-xs text-white/70">{money.teams} GMs × {fmtMoney(money.entry)} = {fmtMoney(money.entry * money.teams)}, less {fmtMoney(money.fundTotal)} to the {brand.fund}</div>
          </div>
          <div className="relative mt-4 grid gap-2 md:grid-cols-3">
            {POTS.map((p) => {
              const pot = money.pots[p.key];
              const lead = [...tables[p.key]].sort((a, b) => a.rank - b.rank);
              const scored = lead.some((s) => Number(s.points) !== 0);
              return (
                <div key={p.key} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="flex items-baseline justify-between gap-2"><span className="font-bold">{p.icon} {p.trophy}</span><span className="text-xs text-white/60">{pot.pct}%</span></div>
                  <div className="text-[11px] text-white/60">{p.label}</div>
                  <div className="num mt-0.5 font-display text-2xl font-extrabold text-gold">{fmtMoney(pot.amount)}</div>
                  <div className="mt-2 space-y-1">
                    {pot.places.map((v, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[.05] px-2 py-1 text-sm">
                        <span className="w-8 text-[10px] font-bold uppercase text-white/60">{PLACES[i]}</span>
                        <span className="num font-bold">{fmtMoney(v)}</span>
                        {scored && lead[i] && <span className="ml-auto flex min-w-0 items-center gap-1 truncate text-xs text-white/70"><TeamBadge team={team(lead[i].team_id)} size={16} />{team(lead[i].team_id)?.gm_name}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="relative mt-3 text-[11px] text-white/60">Each pot pays {money.split.map((p, i) => `${PLACES[i]} ${p}%`).join(', ')}. The names beside each place are who'd collect if it ended today. The regular season table is kept when the NHL regular season ends; the playoffs start everyone at zero; the {bare(brand.trophy)} adds the two.</p>
        </div>
      </Section>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* balances */}
        {useMoney && (
        <Section className="min-w-0" title="Who owes what" right={<span className="text-xs text-mute">every unpaid line, every season</span>}>
          <div className="card overflow-hidden">
            <div className="grid grid-cols-3 gap-2 border-b border-white/[.06] p-3 text-center">
              <div><div className="text-[10px] uppercase tracking-wider text-mute">To collect</div><div className="num text-xl font-bold text-red-200">{fmtMoney(collectTotal)}</div><div className="text-[10px] text-mute">from {toCollect.length} GM{toCollect.length === 1 ? '' : 's'}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-mute">To pay out</div><div className="num text-xl font-bold text-emerald-200">{fmtMoney(payTotal)}</div><div className="text-[10px] text-mute">to {toPay.length} GM{toPay.length === 1 ? '' : 's'}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-mute">Net to the commish</div><div className="num text-xl font-bold">{collectTotal - payTotal >= 0 ? '' : '−'}{abs(collectTotal - payTotal)}</div><div className="text-[10px] text-mute">once everyone's square</div></div>
            </div>
            <div className="divide-y divide-white/[.06]">
              {teams.map((t) => {
                const b = balOf(t.id);
                const tl = lines.filter((l) => l.team_id === t.id);
                const unpaid = tl.filter((l) => !l.paid);
                const isOpen = open === t.id;
                return (
                  <div key={t.id}>
                    <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm" onClick={() => setOpen(isOpen ? null : t.id)}>
                      <TeamBadge team={t} size={26} />
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{t.gm_name}{t.is_commish && <span className="font-normal text-mute"> · commish</span>}</span><span className="block truncate text-[11px] text-mute">{unpaid.length ? unpaid.map((l) => `${KIND[l.kind] ?? l.kind} ${l.amount > 0 ? '' : '−'}${abs(l.amount)}`).join(' · ') : 'nothing open'}</span></span>
                      {b && b.balance !== 0 ? <span className={`num shrink-0 font-bold ${b.balance > 0 ? 'text-red-200' : 'text-emerald-200'}`}>{b.balance > 0 ? `owes ${abs(b.balance)}` : `owed ${abs(b.balance)}`}</span> : <span className="shrink-0 text-xs text-emerald-300">✓ square</span>}
                      <ChevronDown size={14} className={`shrink-0 text-mute transition ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="space-y-2 bg-black/20 px-3 pb-3">
                        <div className="divide-y divide-white/[.06] rounded-xl border border-white/[.07]">
                          {tl.length === 0 && <div className="px-3 py-2 text-xs text-mute">No lines yet.</div>}
                          {tl.map((l) => <LineRow key={l.id} l={l} commish={commish} onChange={load} />)}
                        </div>
                        {b && <div className="text-[11px] text-mute">All time: paid in {fmtMoney(b.paid_in)}, paid out {fmtMoney(b.paid_out)}.</div>}
                        {commish && unpaid.length > 0 && <SettleRow teamId={t.id} net={b?.balance ?? 0} onDone={load} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-1 px-1 text-xs text-mute">Positive lines are money a GM owes (entry, {peter}, fines); negative lines are winnings owed to them. Last season's winnings and this season's entry net out, so one e-Transfer settles each GM.</p>
        </Section>
        )}

        {/* the fund */}
        <div className="min-w-0 space-y-5">
          {useFund && (
          <Section title={`🏦 The ${brand.fund}`} right={commish ? <span className="flex gap-1"><button className="btn-ghost btn-sm" onClick={() => setSheet('fund')}>+ Entry</button><button className="btn-ghost btn-sm" onClick={() => setSheet('price')}>Price</button><button className="btn-ghost btn-sm" onClick={() => setSheet('settings')}>Settings</button></span> : undefined}>
            {!fund ? <div className="card h-40 animate-pulse" /> : (
              <div className="card space-y-3 p-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="label">Value (CAD)</div>
                    <div className="num text-gold-shine font-display text-4xl font-extrabold leading-none">{fmtMoney(Math.round(fund.net_cad))}</div>
                    <div className="mt-1 text-sm"><b>{fmtMoney(Math.round(perGm))}</b> <span className="text-mute">per GM · {fund.members} GMs</span></div>
                  </div>
                  {prices.length > 1 && <Sparkline values={prices.map((p) => p.value_cad)} color="#f7c548" width={140} height={44} />}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Box label={`${fund.shares} ${fund.symbol} shares`} value={fmtMoney(Math.round(fund.stock_cad))} sub={fund.price_usd ? `US$${fund.price_usd.toFixed(2)} × ${fund.fx_usdcad?.toFixed(4)} CAD` : 'no price yet'} />
                  <Box label="Cash" value={fmtMoney(fund.cash)} sub={`contributions, ${bare(brand.booby)} money, fees`} />
                  {fund.owed_back > 0 && <Box label="Less: owed back" value={`−${fmtMoney(fund.owed_back)}`} sub={fund.owed_back_note ?? ''} />}
                  <Box label="Priced" value={fund.priced_at ? fmtDateTime(fund.priced_at) : '—'} sub="updated each weekday after the close" />
                </div>
                {fund.purpose && <div className="rounded-xl border border-gold/25 bg-gold/[.06] px-3 py-2 text-xs text-slate-200">🎯 {fund.purpose}</div>}
                {fund.custodian && <div className="text-[11px] text-mute">{fund.custodian}. The value moves with the share price; each GM's share is the total divided equally.</div>}
                <details className="rounded-xl border border-white/[.07]">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Every movement ({fundLines.length})</summary>
                  <div className="divide-y divide-white/[.06]">
                    {fundLines.map((f) => (
                      <div key={f.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <span className="w-20 shrink-0 text-mute">{fmtDate(f.date)}</span>
                        <span className="min-w-0 flex-1 truncate">{f.kind === 'peter' ? peter : FUND_KIND[f.kind] ?? f.kind}{f.note ? ` · ${f.note}` : ''}</span>
                        {f.shares !== 0 && <span className="num shrink-0">{f.shares > 0 ? '+' : ''}{f.shares} sh</span>}
                        {f.cash !== 0 && <span className={`num shrink-0 font-semibold ${f.cash > 0 ? 'text-emerald-300' : 'text-red-300'}`}>{f.cash > 0 ? '+' : '−'}{abs(f.cash)}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </Section>
          )}

          <Section title="Free-agent pickups" right={<span className="text-xs text-mute">no paid extras · trade for more</span>}>
            <div className="card divide-y divide-white/[.06]">
              {teams.map((t) => {
                const p = pickups.find((x) => x.team_id === t.id);
                return (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <TeamBadge team={t} size={20} /><span className="min-w-0 flex-1 truncate">{t.gm_name}</span>
                    <span className="num text-xs text-mute">{p ? `${p.used} used of ${p.allowed}` : '…'}</span>
                    <span className={`num w-14 text-right font-semibold ${p && p.remaining === 0 ? 'text-red-300' : ''}`}>{p?.remaining ?? '–'} left</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-1 px-1 text-xs text-mute">{league?.max_acquisitions ?? 10} free pickups for the regular season and playoffs, plus {league?.playoff_bonus_acq ?? 3} more for everyone when the playoffs start. Unused pickups can be traded, like {brand.coin.name}.</p>
          </Section>

          <div className="card p-3 text-sm">🎲 Side-bet cash is settled GM to GM. See who owes whom on the <Link to="/bets" className="text-sky-300">cash tab</Link>.</div>
        </div>
      </div>

      {/* history */}
      {useMoney && (
      <Section title="Past payouts" right={<Link to="/league" className="text-xs text-sky-300">Full history ›</Link>}>
        <div className="card divide-y divide-white/[.06]">
          {SEASONS.slice(0, 4).map((s) => (
            <div key={s.season} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <span className="w-16 text-mute">{s.season}</span>
              {s.rows.filter((r) => r.prize).map((r, i) => <span key={r.gm}>{['🥇', '🥈', '🥉'][i]} {r.gm} <b>{fmtMoney(r.prize)}</b></span>)}
              {s.peterPenalty ? <span className="text-amber-200">🪣 {s.rows.find((r) => r.peter)?.gm} {fmtMoney(s.peterPenalty)} to the fund</span> : null}
            </div>
          ))}
        </div>
      </Section>
      )}

      {commish && useMoney && (
        <Section title="Commissioner tools">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="card space-y-2 p-3 text-sm">
              <div className="font-semibold">Season books</div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { const n = await rpc<number>('commish_bill_entries', {}); load(); return n; }, 'Entries billed (anyone missing one)')}>Bill {league?.season} entries</button>
                {POTS.map((p) => (
                  <button key={p.key} className="btn-ghost btn-sm" disabled={busy} onClick={() => { if (confirm(`Post ${p.trophy} payouts from the current ${p.label.toLowerCase()} table? Do this once it's final.`)) run(async () => { await rpc('commish_post_payouts', { p_pot: p.key }); load(); }, `${p.trophy} payouts posted`); }}>Post {p.trophy} payouts</button>
                ))}
                <button className="btn-ghost btn-sm" onClick={() => setSheet('pay')}>Payment instructions</button>
              </div>
              <p className="text-xs text-mute">Post payouts once each table is final: the {bare(brand.regular)} after the regular season (it also bills the {peter}), the {bare(brand.playoff)} and {bare(brand.trophy)} after the Stanley Cup final. Next season, bill the new entries and each winner's balance nets automatically.</p>
            </div>
            <MoneySettings />
          </div>
        </Section>
      )}

      <AddLine open={sheet === 'line'} onClose={() => setSheet(null)} onDone={load} />
      <FundEntry open={sheet === 'fund'} onClose={() => setSheet(null)} onDone={load} />
      <FundPrice open={sheet === 'price'} onClose={() => setSheet(null)} onDone={load} fund={fund} />
      <FundSettings open={sheet === 'settings'} onClose={() => setSheet(null)} onDone={load} fund={fund} />
      <PayNote open={sheet === 'pay'} onClose={() => setSheet(null)} note={payNote} />
    </div>
  );
}

function Box({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/[.04] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-mute">{label}</div>
      <div className="num font-bold">{value}</div>
      {sub && <div className="text-[10px] text-mute">{sub}</div>}
    </div>
  );
}

function LineRow({ l, commish, onChange }: { l: LedgerLine; commish?: boolean; onChange?: () => void }) {
  const { run, busy } = useAction();
  const brand = useBrand();
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate">{l.description}</div>
        <div className="text-[10px] text-mute">{l.kind === 'peter' ? `${bare(brand.booby)} Punishment` : KIND[l.kind] ?? l.kind} · {l.season}{l.paid && l.paid_at ? ` · settled ${fmtDate(l.paid_at.slice(0, 10))}${l.method ? ` by ${l.method}` : ''}` : ''}</div>
      </div>
      <span className={`num shrink-0 font-semibold ${l.amount > 0 ? 'text-red-200' : 'text-emerald-200'} ${l.paid ? 'line-through opacity-50' : ''}`}>{l.amount > 0 ? '' : '−'}{abs(l.amount)}</span>
      {commish ? (
        <span className="flex shrink-0 gap-1">
          <button className={`chip ${l.paid ? 'text-emerald-300' : 'text-amber-300'}`} disabled={busy} onClick={() => run(async () => { await rpc('commish_mark_paid', { p_id: l.id, p_paid: !l.paid, p_method: 'e-transfer' }); onChange?.(); })}>{l.paid ? 'settled' : 'open'}</button>
          {!l.paid && <button className="chip text-red-300" disabled={busy} title="Delete this line" onClick={() => { if (confirm('Delete this line?')) run(async () => { await rpc('commish_delete_line', { p_id: l.id }); onChange?.(); }); }}>✕</button>}
        </span>
      ) : <span className={`chip shrink-0 ${l.paid ? 'text-emerald-300' : 'text-amber-300'}`}>{l.paid ? 'settled' : 'open'}</span>}
    </div>
  );
}

function SettleRow({ teamId, net, onDone }: { teamId: number; net: number; onDone: () => void }) {
  const { team } = useLeague();
  const { run, busy } = useAction();
  const [method, setMethod] = useState('e-transfer');
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold/25 bg-gold/[.06] px-3 py-2 text-sm">
      <span className="flex-1">{net > 0 ? `${team(teamId)?.gm_name} sends you ${abs(net)}` : net < 0 ? `You send ${team(teamId)?.gm_name} ${abs(net)}` : 'Nets to zero'}</span>
      <select className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
      <button className="btn-gold btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('commish_settle_team', { p_team: teamId, p_method: method }); onDone(); }, 'Settled: all square')}>Mark settled</button>
    </div>
  );
}

function AddLine({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { teams, league } = useLeague();
  const { run, busy } = useAction();
  const [f, setF] = useState({ team: '', kind: 'adjust', dir: 'owes', amount: '', desc: '', season: '' });
  const seasons = useMemo(() => { const s = league?.season ?? '2026-27'; const y = Number(s.slice(0, 4)); return [s, `${y - 1}-${String(y).slice(2)}`]; }, [league?.season]);
  return (
    <Sheet open={open} onClose={onClose} title="Add a money line">
      <div className="space-y-2">
        <select className="input" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })}><option value="">GM…</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.gm_name} · {t.name}</option>)}</select>
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, dir: e.target.value === 'payout' || e.target.value === 'credit' ? 'owed' : 'owes' })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="input" value={f.season || seasons[0]} onChange={(e) => setF({ ...f, season: e.target.value })}>{seasons.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={f.dir} onChange={(e) => setF({ ...f, dir: e.target.value })}><option value="owes">GM owes the league</option><option value="owed">League owes the GM</option></select>
          <input className="input" inputMode="decimal" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} />
        </div>
        <input className="input" placeholder="Description (everyone sees it)" value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} />
        <button className="btn-primary w-full" disabled={busy || !f.team || !Number(f.amount) || !f.desc.trim()} onClick={() => run(async () => {
          await rpc('commish_money_line', { p_team: Number(f.team), p_kind: f.kind, p_amount: (f.dir === 'owes' ? 1 : -1) * Number(f.amount), p_desc: f.desc.trim(), p_season: f.season || seasons[0] });
          setF({ ...f, amount: '', desc: '' }); onClose(); onDone();
        }, 'Line added')}>Add line</button>
      </div>
    </Sheet>
  );
}

function FundEntry({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const [f, setF] = useState({ kind: 'deposit', cash: '', shares: '', note: '', date: '' });
  const sign = f.kind === 'withdraw' || f.kind === 'sell' ? -1 : 1;
  return (
    <Sheet open={open} onClose={onClose} title="Record a fund movement">
      <div className="space-y-2">
        <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['deposit', 'withdraw', 'buy', 'sell', 'adjust'].map((k) => <option key={k} value={k}>{FUND_KIND[k]}</option>)}</select>
        <div className="grid grid-cols-2 gap-2">
          <input className="input" inputMode="decimal" placeholder="Cash CAD (+ in, − out)" value={f.cash} onChange={(e) => setF({ ...f, cash: e.target.value })} />
          <input className="input" inputMode="decimal" placeholder="Shares (+ in, − out)" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} />
        </div>
        <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <input className="input" placeholder="What it was (everyone sees it)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <p className="text-xs text-mute">Buying shares: shares +, cash − what they cost. Withdrawals for the trip: cash −. It's posted in chat so nobody's surprised.</p>
        <button className="btn-primary w-full" disabled={busy || (!Number(f.cash) && !Number(f.shares)) || !f.note.trim()} onClick={() => run(async () => {
          const c = Number(f.cash) || 0, s = Number(f.shares) || 0;
          await rpc('commish_fund_entry', { p_kind: f.kind, p_cash: (f.kind === 'adjust' || f.kind === 'buy' || f.kind === 'sell') ? c : sign * Math.abs(c), p_shares: f.kind === 'adjust' ? s : sign * Math.abs(s), p_note: f.note.trim(), p_date: f.date || null });
          setF({ kind: 'deposit', cash: '', shares: '', note: '', date: '' }); onClose(); onDone();
        }, 'Fund updated')}>Record</button>
      </div>
    </Sheet>
  );
}

function FundPrice({ open, onClose, onDone, fund }: { open: boolean; onClose: () => void; onDone: () => void; fund: FundStatus | null }) {
  const { run, busy } = useAction();
  const [f, setF] = useState({ price: '', fx: '' });
  useEffect(() => { if (open && fund) setF({ price: String(fund.price_usd ?? ''), fx: String(fund.fx_usdcad ?? '') }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} onClose={onClose} title="Set the share price">
      <div className="space-y-2">
        <p className="text-xs text-mute">The price and exchange rate update themselves each weekday after the market closes. Set them by hand if you need to.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-mute">{fund?.symbol ?? 'TSLA'} price (US$)<input className="input mt-1" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <label className="text-xs text-mute">USD → CAD<input className="input mt-1" inputMode="decimal" value={f.fx} onChange={(e) => setF({ ...f, fx: e.target.value })} /></label>
        </div>
        <button className="btn-primary w-full" disabled={busy || !(Number(f.price) > 0) || !(Number(f.fx) > 0)} onClick={() => run(async () => { await rpc('commish_fund_price', { p_price: Number(f.price), p_fx: Number(f.fx) }); onClose(); onDone(); }, 'Price saved')}>Save</button>
      </div>
    </Sheet>
  );
}

function FundSettings({ open, onClose, onDone, fund }: { open: boolean; onClose: () => void; onDone: () => void; fund: FundStatus | null }) {
  const { run, busy } = useAction();
  const brand = useBrand();
  const [f, setF] = useState({ owed_back: '', owed_back_note: '', custodian: '', purpose: '', symbol: '' });
  useEffect(() => { if (open && fund) setF({ owed_back: String(fund.owed_back), owed_back_note: fund.owed_back_note ?? '', custodian: fund.custodian ?? '', purpose: fund.purpose ?? '', symbol: fund.symbol }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} onClose={onClose} title={`${brand.fund} settings`}>
      <div className="space-y-2">
        <label className="block text-xs text-mute">Owed back before the split (CAD)<input className="input mt-1" inputMode="decimal" value={f.owed_back} onChange={(e) => setF({ ...f, owed_back: e.target.value })} /></label>
        <input className="input" placeholder="Why" value={f.owed_back_note} onChange={(e) => setF({ ...f, owed_back_note: e.target.value })} />
        <input className="input" placeholder="Who holds it" value={f.custodian} onChange={(e) => setF({ ...f, custodian: e.target.value })} />
        <input className="input" placeholder="What it's for" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
        <label className="block text-xs text-mute">Stock symbol<input className="input mt-1" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} /></label>
        <button className="btn-primary w-full" disabled={busy} onClick={() => run(async () => { await rpc('commish_fund_settings', { p: { ...f, owed_back: Number(f.owed_back) || 0 } }); onClose(); onDone(); }, 'Saved')}>Save</button>
      </div>
    </Sheet>
  );
}

function PayNote({ open, onClose, note }: { open: boolean; onClose: () => void; note: string }) {
  const { league, refresh } = useLeague();
  const { run, busy } = useAction();
  const [v, setV] = useState(note);
  useEffect(() => { if (open) setV(note); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} onClose={onClose} title="How GMs pay you">
      <div className="space-y-2">
        <textarea className="input min-h-[90px]" value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. Interac e-Transfer to …" />
        <p className="text-xs text-mute">Shown to every GM who owes money.</p>
        <button className="btn-primary w-full" disabled={busy} onClick={() => run(async () => { await rpc('commish_update_league', { p: { info: { ...(league?.info ?? {}), pay_note: v.trim() } } }); await refresh(['league']); onClose(); }, 'Saved')}>Save</button>
      </div>
    </Sheet>
  );
}
