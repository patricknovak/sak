import { useEffect, useState } from 'react';
import { PROVIDERS, SERVICES } from '../lib/watch';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { fmtMoney, fmtPts, NHL_TEAMS, ordinal } from '../lib/format';
import { SEASONS, FRANCHISE_OF, type GM } from '../data/history';
import { Section, TeamBadge, Toggle, useAction, useToast } from '../components/ui';
import type { Team } from '../lib/types';
import { PushCard } from '../components/PushCard';
import { ConnectYahoo, useYahooStatus } from '../components/YahooConnect';

const EMOJIS = ['🏒', '🥅', '🇨🇿', '🐦', '🐦‍⬛', '🦅', '🧔', '👨‍👦', '🕺', '😱', '🔥', '🐺', '🦁', '🐻', '🦈', '🍺', '👑', '💀', '🤠', '🧊', '⚡', '🚨', '🐐', '🦫'];
const COLORS = ['#c8102e', '#e11d48', '#ea580c', '#f59e0b', '#16a34a', '#0f766e', '#0891b2', '#1d4ed8', '#7c3aed', '#db2777', '#111827', '#64748b'];

export default function Profile() {
  const { me, refresh } = useLeague();
  const toast = useToast();
  const { busy, run } = useAction();
  const [f, setF] = useState<Partial<Team>>({});
  const [tv, setTv] = useState<{ provider?: string; services?: string[] }>({});
  useEffect(() => { setTv(me?.tv ?? {}); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pw, setPw] = useState({ a: '', b: '' });
  const yst = useYahooStatus();
  useEffect(() => { if (me) setF(me); }, [me?.id]);
  if (!me) return null;

  const save = () => run(async () => {
    await rpc('update_my_team', { p_name: f.name, p_motto: f.motto || null, p_color: f.color, p_emoji: f.emoji, p_fav_nhl: f.fav_nhl || null, p_auto_lineup: f.auto_lineup });
    await refresh(['teams']);
  }, 'Profile saved');

  const career = SEASONS.map((s) => {
    const i = s.rows.findIndex((r) => FRANCHISE_OF[r.gm as GM] === me.id && (r.gm === me.gm_name || (me.id === 5 && r.gm === 'Dan')));
    return i < 0 ? null : { season: s.season, place: i + 1, of: s.rows.length, ...s.rows[i] };
  }).filter(Boolean) as { season: string; place: number; of: number; team: string; gm: string; points: number; prize?: number; peter?: boolean }[];

  return (
    <div className="space-y-5">
      <div className="card-hero flex items-center gap-4 p-4" style={{ '--tc': f.color } as React.CSSProperties}>
        <div className="pointer-events-none absolute -right-4 -top-6 select-none text-[120px] leading-none opacity-[.08]">{f.emoji}</div>
        <TeamBadge team={{ ...me, ...f } as Team} size={64} ring />
        <div className="relative min-w-0">
          <div className="h-display text-shine truncate text-[28px] leading-tight">{f.name}</div>
          <div className="text-sm text-white/70">GM {me.gm_name}{me.is_commish && ' · Commissioner'} · since {me.joined_season}</div>
        </div>
      </div>

      <Section title="Team identity">
        <div className="card space-y-3 p-3">
          <label className="block text-xs text-mute">Team name<input className="input mt-1" value={f.name ?? ''} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="block text-xs text-mute">Motto / trash-talk tagline<input className="input mt-1" value={f.motto ?? ''} maxLength={120} onChange={(e) => setF({ ...f, motto: e.target.value })} /></label>
          <div>
            <div className="label mb-1">Logo</div>
            <div className="flex flex-wrap gap-1.5">{EMOJIS.map((e) => <button key={e} onClick={() => setF({ ...f, emoji: e })} className={`grid h-10 w-10 place-items-center rounded-xl text-xl ${f.emoji === e ? 'bg-white/20 ring-2 ring-white' : 'bg-boards'}`}>{e}</button>)}</div>
          </div>
          <div>
            <div className="label mb-1">Colour</div>
            <div className="flex flex-wrap gap-1.5">{COLORS.map((c) => <button key={c} onClick={() => setF({ ...f, color: c })} className={`h-9 w-9 rounded-full ${f.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-rink' : ''}`} style={{ background: c }} aria-label={c} />)}
              <input type="color" value={f.color ?? '#e11d48'} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-9 w-9 rounded-full bg-transparent" /></div>
          </div>
          <label className="block text-xs text-mute">Favourite NHL team
            <select className="input mt-1" value={f.fav_nhl ?? ''} onChange={(e) => setF({ ...f, fav_nhl: e.target.value })}>
              <option value="">—</option>{Object.entries(NHL_TEAMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          {me?.role !== 'spectator' && <Toggle on={!!f.auto_lineup} onChange={(v) => setF({ ...f, auto_lineup: v })} label={<span>Auto-set my lineup every morning <span className="text-xs text-mute">(starts players with games)</span></span>} />}
          <button className="btn-primary" disabled={busy} onClick={save}>Save</button>
        </div>
      </Section>

      <Section title="Where you watch">
        <div className="card space-y-3 p-3">
          <p className="text-xs text-mute">Live NHL streams live on the broadcasters’ own players, where you sign in with your TV provider (Telus, Rogers, Bell…) or a subscription. Tell SaK what you have and every game on the NHL page gets a “Watch on …” button that goes straight to the right one, with the games you can watch flagged.</p>
          <label className="block text-xs text-mute">TV provider
            <select className="input mt-1" value={tv.provider ?? ''} onChange={(e) => setTv({ ...tv, provider: e.target.value || undefined })}>
              <option value="">None / streaming only</option>{PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select></label>
          <div>
            <div className="label mb-1">Services and channels you can sign in to</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {SERVICES.map((sv) => {
                const on = (tv.services ?? []).includes(sv.k);
                return (
                  <label key={sv.k} className={`flex cursor-pointer items-start gap-2 rounded-xl border px-2.5 py-2 text-sm ${on ? 'border-sky-400/40 bg-sky-500/10' : 'border-white/[.08] bg-white/[.03]'}`}>
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-sky-400" checked={on} onChange={() => setTv({ ...tv, services: on ? (tv.services ?? []).filter((k) => k !== sv.k) : [...(tv.services ?? []), sv.k] })} />
                    <span className="min-w-0"><span className="font-semibold">{sv.name}</span> <span className="text-[10px] text-mute">{sv.country === 'CA' ? '🇨🇦' : sv.country === 'US' ? '🇺🇸' : ''}</span><span className="block text-[11px] text-mute">{sv.note}</span></span>
                  </label>
                );
              })}
            </div>
          </div>
          <button className="btn-primary" disabled={busy} onClick={() => run(async () => { await rpc('set_tv', { p_tv: tv }); await refresh(['teams']); }, 'Saved. Watch buttons will match your services.')}>Save</button>
        </div>
      </Section>

      <Section title="Yahoo Fantasy">
        <div className="card p-3">{yst.st === undefined ? <span className="text-xs text-mute">Checking…</span> : <ConnectYahoo st={yst.st} onChange={yst.reload} />}</div>
      </Section>

      {career.length > 0 && (
        <Section title="Your SaK career">
          <div className="card divide-y divide-white/[.06]">
            {career.map((c) => (
              <div key={c.season} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-16 text-mute">{c.season}</span>
                <span className="flex-1 truncate">{c.team}</span>
                <span className={c.place === 1 ? 'text-gold font-semibold' : c.peter ? 'text-red-300' : ''}>{c.place === 1 ? '🏆 ' : c.peter ? '🪣 ' : ''}{ordinal(c.place)}</span>
                <span className="w-16 text-right">{fmtPts(c.points)}</span>
                <span className="w-14 text-right text-xs text-gold">{c.prize ? fmtMoney(c.prize) : ''}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Alerts">
        <PushCard />
      </Section>

      <Section title="Password">
        <div className="card space-y-2 p-3">
          <input className="input" type="password" autoComplete="new-password" placeholder="New password (6+ characters)" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
          <input className="input" type="password" autoComplete="new-password" placeholder="Confirm" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
          <button className="btn-ghost" disabled={pw.a.length < 6 || pw.a !== pw.b} onClick={async () => {
            const { error } = await supabase.auth.updateUser({ password: pw.a });
            if (error) toast(error.message, 'err'); else { toast('Password changed'); setPw({ a: '', b: '' }); }
          }}>Change password</button>
        </div>
      </Section>

      <div className="card p-3 text-sm text-mute">
        📱 <span className="text-slate-200">Install the app:</span> on iPhone tap Share → “Add to Home Screen”; on Android tap ⋮ → “Install app”. It opens full-screen like a native app.
      </div>
      <button className="btn-ghost w-full" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );
}
