// Delete your own account (migration 371), at the foot of Profile. The sheet reads account_delete_preview() and says,
// league by league, what becomes of each seat before anything happens: a fantasy seat stays open for a new GM, a pool
// seat stays in the table as "Former member", a pool you host passes to another member (or goes, when nobody else is
// in it). The join function's `delete_account` door does it: the database part as you, the chat photos, then the
// sign-in. Until the migration is live the preview call fails and the card keeps the old way: write to us.
import { useEffect, useState } from 'react';
import { ArrowRight, Crown, Shield, Trash2, UserX } from 'lucide-react';
import { rpc, supabase } from '../lib/supabase';
import { Section, Sheet, Spinner } from './ui';
import { useBrand } from '../lib/brand';

export type SeatPlan = {
  league_id: number; league: string; kind: string; team: string; role: string; hosts: boolean;
  outcome: 'league_deleted' | 'host_passes' | 'spectator_leaves' | 'former_member' | 'seat_open'; successor: string | null;
};
export type DeletePreview = { email: string | null; admin: boolean; seats: SeatPlan[]; posts: number };

// one plain sentence per seat, in the words a member would use
export function seatLine(s: SeatPlan): string {
  const what = s.kind === 'predict' ? 'pool' : 'league';
  const pass = s.hosts && s.successor ? ` ${s.successor} runs the ${what} from here.` : '';
  switch (s.outcome) {
    case 'league_deleted': return `Nobody else is in it, so the ${what} is deleted with everything in it.`;
    case 'host_passes': return `${s.successor} becomes the host.` + (s.kind === 'predict' ? ' Your seat stays in the table as “Former member”.' : ' Your team stays, open for a new GM.');
    case 'spectator_leaves': return 'You stop following it.';
    case 'former_member': return 'Your calls still count, under “Former member”, so the table adds up for everyone else.' + pass;
    default: return `${s.team} stays in the league with its roster and points, open for the commissioner to fill.` + pass;
  }
}

export function DeleteAccount() {
  const brand = useBrand();
  const [plan, setPlan] = useState<DeletePreview | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => { rpc<DeletePreview>('account_delete_preview').then(setPlan, () => setPlan(null)); }, []);
  return (
    <Section title="Delete your account">
      <div className="card space-y-3 p-3.5">
        <p className="text-sm leading-snug text-slate-300">Close your account for good: your sign-in, your chat posts and photos, your alerts and everything we keep about you. Your teams and calls stay, without your name, so nobody else’s standings move.</p>
        {plan === null ? (
          <p className="text-xs text-mute">To delete it, write to <a className="underline decoration-white/20 underline-offset-2" href="mailto:hello@superpoolsai.com">hello@superpoolsai.com</a> from the address you signed up with. It’s done within a week.</p>
        ) : (
          <button type="button" disabled={!plan} onClick={() => setOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-40">
            <UserX size={16} /> Delete my account…
          </button>
        )}
      </div>
      {plan && <DeleteAccountSheet plan={plan} bot={brand.bot.name} open={open} onClose={() => setOpen(false)} />}
    </Section>
  );
}

export function DeleteAccountSheet({ plan, bot, open, onClose }: { plan: DeletePreview; bot: string; open: boolean; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const ready = typed.trim().toLowerCase() === 'delete';
  const go = async () => {
    setBusy(true); setErr('');
    const { data, error } = await supabase.functions.invoke('join', { body: { delete_account: { confirm: 'delete' } } });
    if (error || !data?.ok) {
      let msg = (data as { error?: string } | null)?.error;
      // a refusal comes back as a non-2xx: its words are in the response body
      if (!msg && error && 'context' in error) msg = await (error as { context: Response }).context.json().then((j: { error?: string }) => j.error, () => undefined);
      setErr(msg || 'Couldn’t delete it just now. Try again in a minute.');
      setBusy(false);
      return;
    }
    setDone(true);
    await supabase.auth.signOut().catch(() => {});
    setTimeout(() => { window.location.hash = '#/'; window.location.reload(); }, 2500);
  };
  const close = () => { if (busy) return; setTyped(''); setErr(''); onClose(); };

  if (done) {
    return (
      <Sheet open={open} onClose={() => {}} title="Your account is deleted">
        <div className="space-y-3 py-2 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/[.06] text-2xl">👋</div>
          <p className="text-sm text-slate-300">Everything is cleared and you’re signed out. Backups roll off within seven days. Thanks for playing.</p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={close} title="Delete your account">
      <div className="space-y-4">
        {plan.admin ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/20 text-amber-200"><Shield size={18} /></span>
            <p className="text-sm leading-snug text-amber-100">You’re a platform admin, so this account can’t be deleted from the app. Take the admin role off first.</p>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500/20 text-red-200"><Trash2 size={18} /></span>
            <p className="text-sm leading-snug text-red-100">
              This deletes {plan.email ? <b className="break-all text-white">{plan.email}</b> : 'this account'} for good. It can’t be undone, and you’d need a new invite to come back.
            </p>
          </div>
        )}

        {plan.seats.length > 0 && (
          <div>
            <div className="label mb-1.5">What happens to your seats</div>
            <div className="divide-y divide-white/[.06] overflow-hidden rounded-2xl border border-white/[.08] bg-white/[.03]">
              {plan.seats.map((s) => (
                <div key={s.league_id} className="flex items-start gap-3 px-3 py-2.5">
                  <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm ${s.outcome === 'league_deleted' ? 'bg-red-500/15 text-red-200' : s.hosts ? 'bg-gold/15 text-gold' : 'bg-white/[.06] text-slate-300'}`}>
                    {s.outcome === 'league_deleted' ? <Trash2 size={15} /> : s.hosts ? <Crown size={15} /> : <ArrowRight size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold text-slate-100">{s.league}{s.hosts && <span className="ml-1.5 align-middle text-[10px] font-bold uppercase tracking-wide text-gold">you host</span>}</span>
                    <span className="block text-xs leading-snug text-mute">{seatLine(s)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-2 text-xs leading-snug sm:grid-cols-2">
          <div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-3">
            <div className="mb-1 font-semibold text-red-200">Deleted</div>
            <p className="text-mute">Your sign-in and email, {plan.posts > 0 ? `your ${plan.posts.toLocaleString()} chat ${plan.posts === 1 ? 'post' : 'posts'} and photos` : 'your chat posts and photos'}, lounge and fan zone posts, alerts, {bot}’s notes on you, a Yahoo link, a waitlist entry on your email.</p>
          </div>
          <div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-3">
            <div className="mb-1 font-semibold text-slate-200">Kept, without your name</div>
            <p className="text-mute">Each team’s roster, points, trades and bets, and each pool seat’s calls and coins, so everyone else’s tables stay right.</p>
          </div>
        </div>

        {!plan.admin && <>
          <label className="block"><span className="label">Type <b className="normal-case text-white">DELETE</b> to confirm</span>
            <input className="input mt-1 w-full" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" autoComplete="off" autoCapitalize="characters" /></label>
          {err && <div className="rounded-xl border border-red-400/30 bg-red-900/50 px-3 py-2 text-sm text-red-200">{err}</div>}
          <button type="button" disabled={!ready || busy} onClick={go}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 py-3 text-base font-bold text-white transition hover:bg-red-400 disabled:opacity-40">
            {busy ? <Spinner /> : <><Trash2 size={18} /> Delete my account for good</>}
          </button>
        </>}
      </div>
    </Sheet>
  );
}
