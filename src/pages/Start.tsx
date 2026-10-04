import { useState } from 'react';
import { rpc } from '../lib/supabase';
import { PRODUCT } from '../lib/brand';
import { Spinner } from '../components/ui';
import { themed } from '../components/LeagueIdentity';

// "Start your league" (#/start), open to anyone, signed in or not: the way a commissioner asks Super Pools for a league
// until sign-up is self-serve. The request lands in the Platform page's inbox (request_league), and the league comes
// back as an invite link by email. Drawn in the product's own colours (docs/BRAND.md), not any league's.

const PLAYS = [['yahoo', 'Yahoo'], ['espn', 'ESPN'], ['fantrax', 'Fantrax'], ['cbs', 'CBS'], ['sheet', 'A spreadsheet'], ['new', 'Starting fresh']] as const;
const POINTS = [
  ['🏒', 'It runs itself', 'Points from the box scores as the games happen, lineups set weeks ahead or by the auto-pilot, bets settled with nobody keeping score.'],
  ['🎙️', 'It talks back', 'A league voice you name that posts the recap, grades the trades and answers “who should I start?” in the chat.'],
  ['🔒', 'Built by a keeper league', 'Keepers, a draft room with a clock and a TV board, trade reviews, the money between friends. Thirteen seasons of rules, baked in.'],
];

export function ProductMark({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className="text-gold">
      <rect width="64" height="64" rx="14" fill="#111b30" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle cx="32" cy="32" r="4.5" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="25" y1="8" x2="25" y2="12.5" /><line x1="39" y1="8" x2="39" y2="12.5" /><line x1="25" y1="51.5" x2="25" y2="56" /><line x1="39" y1="51.5" x2="39" y2="56" /></g>
    </svg>
  );
}

export default function Start() {
  const [f, setF] = useState({ name: '', email: '', league: '', teams: 10, plays: '' as string, note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());
  const ok = f.name.trim().length >= 2 && okEmail && f.league.trim().length >= 2;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await rpc('request_league', { p_name: f.name, p_email: f.email, p_league_name: f.league, p_team_count: f.teams, p_plays_on: f.plays || null, p_note: f.note || null });
      setSent(true);
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  return (
    <div className="pt-safe min-h-dvh px-4 py-10" style={themed('#f7c548')}>
      <div className="mx-auto w-full max-w-md pt-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 inline-block drop-shadow-[0_10px_30px_rgb(var(--gold-rgb)/.35)]"><ProductMark size={64} /></div>
          <div className="h-display text-4xl leading-none"><span className="text-gold-shine italic">SUPER</span><span className="text-shine ml-2 font-black">POOLS</span></div>
          <p className="mt-2 text-sm text-mute">{PRODUCT.tagline}</p>
        </div>

        {sent ? (
          <div className="card-hero p-6 text-center">
            <div className="relative">
              <div className="text-5xl">🏒</div>
              <h1 className="h-display text-shine mt-3 text-3xl leading-none">You’re on the list</h1>
              <p className="mt-3 text-sm text-white/80">We’ll set up <b>{f.league.trim()}</b> and email <b>{f.email.trim().toLowerCase()}</b> a link to take your commissioner’s seat, usually within a day. From there you name it, invite your GMs and set your draft.</p>
            </div>
          </div>
        ) : (
          <>
            <h1 className="h-display text-shine text-center text-3xl leading-none">Start your league</h1>
            <p className="mt-2 text-center text-sm text-slate-300">Free to start. Tell us about your pool and we’ll open it for you.</p>
            <form onSubmit={send} className="card-hero mt-5 p-5">
              <div className="relative space-y-3">
                <label className="block"><span className="label text-white/70">Your name</span>
                  <input className="input mt-1" autoComplete="name" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="The commissioner" /></label>
                <label className="block"><span className="label text-white/70">Email</span>
                  <input className="input mt-1" type="email" inputMode="email" autoComplete="email" maxLength={120} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@example.com" /></label>
                <label className="block"><span className="label text-white/70">League name</span>
                  <input className="input mt-1" maxLength={60} value={f.league} onChange={(e) => setF({ ...f, league: e.target.value })} placeholder="Pond Hockey Pool" /></label>
                <div className="flex items-center justify-between gap-3">
                  <div><div className="label text-white/70">Teams</div><div className="text-xs text-white/50">Including yours</div></div>
                  <div className="flex shrink-0 items-center gap-1 rounded-full bg-black/30 p-1">
                    <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg font-bold disabled:opacity-30" disabled={f.teams <= 2} onClick={() => setF({ ...f, teams: f.teams - 1 })} aria-label="One team fewer">−</button>
                    <span className="num w-8 text-center font-display text-2xl font-extrabold">{f.teams}</span>
                    <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg font-bold disabled:opacity-30" disabled={f.teams >= 20} onClick={() => setF({ ...f, teams: f.teams + 1 })} aria-label="One team more">+</button>
                  </div>
                </div>
                <div>
                  <div className="label text-white/70">Where you play now</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {PLAYS.map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setF({ ...f, plays: f.plays === k ? '' : k })}
                        className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${f.plays === k ? 'border-gold bg-gold/15 text-gold' : 'border-white/10 bg-white/[.05] text-slate-200 hover:bg-white/[.09]'}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <label className="block"><span className="label text-white/70">Anything we should know</span>
                  <textarea className="input mt-1 min-h-20 text-sm" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Keepers, how many seasons you’ve run, when you draft…" /></label>
                <button className="btn-gold w-full py-3 text-base" disabled={busy || !ok}>{busy ? <Spinner /> : '✨ Ask for my league'}</button>
              </div>
            </form>
            {err && <div className="mt-4 rounded-xl border border-red-400/30 bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">{err}</div>}
          </>
        )}

        <div className="mt-8 space-y-2">
          {POINTS.map(([e, t, d]) => (
            <div key={t} className="card flex items-start gap-3 p-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[.06] text-xl">{e}</span>
              <span className="min-w-0"><span className="block font-semibold text-slate-100">{t}</span><span className="block text-xs text-mute">{d}</span></span>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-mute">The SaK Superleague (est. 2013) has run its 2026-27 season on {PRODUCT.name} every night since its keeper deadline.</p>
      </div>
    </div>
  );
}
