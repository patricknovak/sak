import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Spinner, TeamBadge } from '../components/ui';
import type { Team } from '../lib/types';

type DirTeam = Pick<Team, 'id' | 'name' | 'abbrev' | 'gm_name' | 'login_email' | 'color' | 'emoji' | 'role'>;

export default function Login() {
  const [teams, setTeams] = useState<DirTeam[]>([]);
  const [pick, setPick] = useState<DirTeam | null>(null);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('team_directory').select('*').order('id').then(({ data, error }) => {
      if (error) setErr('Can’t reach the league server. Try again in a minute.');
      setTeams((data ?? []) as DirTeam[]);
      const last = localStorage.getItem('sak-last-team');
      const t = (data ?? []).find((x) => String(x.id) === last);
      if (t) setPick(t as DirTeam);
    });
  }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pick) return;
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: pick.login_email, password: pw });
    setBusy(false);
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Wrong password. Ask the commish if you’re locked out.' : error.message);
    else localStorage.setItem('sak-last-team', String(pick.id));
  };

  return (
    <div className="pt-safe relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* arena lights */}
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-glow absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full" style={{ background: 'radial-gradient(closest-side, rgba(76,195,255,.28), transparent)' }} />
        <div className="absolute -left-32 top-10 h-[640px] w-40 rotate-[24deg] bg-gradient-to-b from-white/[.10] to-transparent blur-2xl" />
        <div className="absolute -right-32 top-10 h-[640px] w-40 -rotate-[24deg] bg-gradient-to-b from-white/[.10] to-transparent blur-2xl" />
        <div className="absolute bottom-0 left-1/2 h-64 w-[900px] -translate-x-1/2 rounded-[100%] border-t-[6px] border-goal/20" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="relative mx-auto mb-4 h-24 w-24">
            <div className="absolute inset-0 animate-glow rounded-[28px] bg-goal/40 blur-2xl" />
            <img src="./icon.svg" alt="" className="relative h-24 w-24 drop-shadow-2xl" />
          </div>
          <h1 className="h-display text-shine text-5xl leading-none">She’s A Keeper</h1>
          <p className="mt-2 text-xs font-bold uppercase tracking-[.3em] text-mute">SaK League · est. 2013 · 2026-27</p>
        </div>

        {!pick ? (
          <>
            <div className="label mb-3 text-center">Who are you?</div>
            <div className="stagger grid grid-cols-2 gap-2.5">
              {teams.filter((t) => t.role !== 'spectator').map((t) => (
                <button key={t.id} onClick={() => { setPick(t); setPw(''); setErr(''); }}
                  className="group card relative flex flex-col items-center gap-2 overflow-hidden px-2 py-4 transition duration-200 hover:-translate-y-0.5 active:scale-[.97]">
                  <div className="pointer-events-none absolute inset-0 opacity-60 transition group-hover:opacity-100" style={{ background: `radial-gradient(90% 70% at 50% 0%, ${t.color}55, transparent 70%)` }} />
                  <div className="relative"><TeamBadge team={t as Team} size={52} /></div>
                  <div className="relative text-center">
                    <div className="text-sm font-bold leading-tight">{t.name}</div>
                    <div className="text-xs text-mute">{t.gm_name}</div>
                  </div>
                </button>
              ))}
              {teams.length === 0 && !err && <div className="col-span-2 flex justify-center py-8"><Spinner /></div>}
            </div>
            {teams.some((t) => t.role === 'spectator') && (
              <>
                <div className="label mb-2 mt-6 text-center">Spectators</div>
                <div className="flex flex-wrap justify-center gap-2">
                  {teams.filter((t) => t.role === 'spectator').map((t) => (
                    <button key={t.id} onClick={() => { setPick(t); setPw(''); setErr(''); }} className="card flex items-center gap-2 px-3 py-2 text-sm transition hover:-translate-y-0.5 active:scale-[.97]">
                      <TeamBadge team={t as Team} size={26} /><span className="font-semibold">{t.name}</span><span className="text-xs text-mute">🍿</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <form onSubmit={signIn} className="card-hero animate-pop p-5" style={{ '--tc': pick.color } as React.CSSProperties}>
            <div className="relative mb-5 flex items-center gap-3">
              <TeamBadge team={pick as Team} size={60} ring />
              <div>
                <div className="h-display text-shine text-2xl leading-tight">{pick.name}</div>
                <div className="text-sm text-white/70">{pick.role === 'spectator' ? '🍿 Spectator pass' : `GM ${pick.gm_name}`}</div>
              </div>
            </div>
            <label className="label relative text-white/70">Password</label>
            <input className="input relative mt-1" type="password" autoFocus autoComplete="current-password" value={pw}
              onChange={(e) => setPw(e.target.value)} placeholder="Your SaK password" />
            <button className="btn-primary relative mt-4 w-full py-3 text-base" disabled={busy || !pw}>{busy ? <Spinner /> : '🏒 Drop the puck'}</button>
            <button type="button" className="relative mt-3 w-full text-center text-sm text-white/60" onClick={() => setPick(null)}>Not {pick.gm_name}? Switch team</button>
          </form>
        )}
        {err && <div className="mt-4 rounded-xl border border-red-400/30 bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">{err}</div>}
        <p className="mt-8 text-center text-xs italic text-mute">Play fair, play hard and play to win.</p>
      </div>
    </div>
  );
}
