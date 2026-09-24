import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Spinner, TeamBadge } from '../components/ui';
import type { Team } from '../lib/types';

type DirTeam = Pick<Team, 'id' | 'name' | 'abbrev' | 'gm_name' | 'login_email' | 'color' | 'emoji'>;

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
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{
        background: 'radial-gradient(60% 40% at 50% 0%, #e11d4855, transparent), radial-gradient(50% 40% at 80% 100%, #38bdf833, transparent)' }} />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <img src="./icon.svg" alt="" className="mx-auto mb-3 h-20 w-20 drop-shadow-2xl" />
          <h1 className="h-display text-4xl">She’s A Keeper</h1>
          <p className="mt-1 text-sm text-mute">SaK League · est. 2013 · 2026-27 season</p>
        </div>

        {!pick ? (
          <>
            <div className="label mb-2 text-center">Who are you?</div>
            <div className="grid grid-cols-2 gap-2">
              {teams.map((t) => (
                <button key={t.id} onClick={() => { setPick(t); setPw(''); setErr(''); }}
                  className="card flex flex-col items-center gap-2 px-2 py-4 transition hover:border-white/40 active:scale-[.98]">
                  <TeamBadge team={t as Team} size={48} />
                  <div className="text-center">
                    <div className="text-sm font-semibold leading-tight">{t.name}</div>
                    <div className="text-xs text-mute">{t.gm_name}</div>
                  </div>
                </button>
              ))}
              {teams.length === 0 && !err && <div className="col-span-2 flex justify-center py-8"><Spinner /></div>}
            </div>
          </>
        ) : (
          <form onSubmit={signIn} className="card animate-pop p-5">
            <div className="mb-4 flex items-center gap-3">
              <TeamBadge team={pick as Team} size={52} />
              <div>
                <div className="font-semibold">{pick.name}</div>
                <div className="text-sm text-mute">GM {pick.gm_name}</div>
              </div>
            </div>
            <label className="label">Password</label>
            <input className="input mt-1" type="password" autoFocus autoComplete="current-password" value={pw}
              onChange={(e) => setPw(e.target.value)} placeholder="Your SaK password" />
            <button className="btn-primary mt-4 w-full py-3 text-base" disabled={busy || !pw}>{busy ? <Spinner /> : 'Drop the puck'}</button>
            <button type="button" className="mt-3 w-full text-center text-sm text-mute" onClick={() => setPick(null)}>Not {pick.gm_name}? Switch team</button>
          </form>
        )}
        {err && <div className="mt-4 rounded-xl bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">{err}</div>}
        <p className="mt-8 text-center text-xs text-mute">Play fair, play hard and play to win.</p>
      </div>
    </div>
  );
}
