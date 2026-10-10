// A fantasy league of your own, from the start page (#/new, migration 242: fantasy_start). Every choice that shapes the
// league is made up front, in plain words: how many teams, season total or head-to-head (and its playoffs), points or
// categories, keepers and the draft. The rest (the roster, the points per stat, the NHL calendar) starts from the SaK
// Superleague's and is changed on the Commish page. The league opens in setup with its starter in the commissioner's
// seat and lands on the Commish page, where the invites and the checklist are.
import { useState } from 'react';
import { Check } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { openPool } from '../lib/host';
import { track } from '../lib/analytics';
import { CATEGORIES, STANDARD_CATEGORIES } from '../lib/categories';
import { Spinner } from './ui';

const rgb = (c: string) => `${parseInt(c.slice(1, 3), 16)} ${parseInt(c.slice(3, 5), 16)} ${parseInt(c.slice(5, 7), 16)}`;

function Field({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="[counter-increment:step]">
      <div className="mb-2 flex items-center gap-2"><span className="num grid h-6 w-6 place-items-center rounded-full bg-white/10 text-xs font-black text-white before:content-[counter(step)]" /><span className="label text-white/80">{title}</span></div>
      {children}
      {note && <p className="mt-2 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">{note}</p>}
    </div>
  );
}
function Seg<T extends string | number>({ value, set, options }: { value: T; set: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="grid gap-1.5 rounded-2xl bg-black/25 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([k, l]) => <button key={String(k)} type="button" onClick={() => set(k)} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${value === k ? 'bg-white text-[#0b1220]' : 'text-white/70 hover:text-white'}`}>{l}</button>)}
    </div>
  );
}

export function FantasyStart({ color, setColor, swatches, member, signedIn }: { color: string; setColor: (c: string) => void; swatches: string[]; member: boolean; signedIn: boolean }) {
  const [name, setName] = useState('');
  const [teams, setTeams] = useState(8);
  const [format, setFormat] = useState<'season' | 'h2h'>('season');
  const [scoring, setScoring] = useState<'points' | 'cats'>('points');
  const [cats, setCats] = useState<string[]>(STANDARD_CATEGORIES);
  const [playoffs, setPlayoffs] = useState(4);
  const [keepers, setKeepers] = useState(0);
  const [snake, setSnake] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const po = format === 'h2h' ? Math.min(playoffs, teams) : 0;
  const okCats = scoring === 'points' || (cats.length >= 3 && cats.length <= 12);
  const ready = member && name.trim().length >= 3 && okCats;
  const start = async () => {
    setBusy(true); setErr('');
    try {
      const r = await rpc<{ id: number; slug: string }>('fantasy_start', { p_name: name.trim(), p_color: color, p_seats: teams, p_format: format,
        p_categories: scoring === 'cats' ? cats : null, p_keepers: keepers, p_playoffs: po, p_snake: snake });
      track('pool_start', { kind: 'fantasy' });
      await openPool({ league_id: r.id, slug: r.slug }, '/commish');
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  const toggleCat = (k: string) => setCats((cs) => (cs.includes(k) ? cs.filter((x) => x !== k) : [...cs, k]));
  const summary = [`${teams} teams`, format === 'h2h' ? `head-to-head${po ? `, ${po}-team playoffs` : ', no playoffs'}` : 'season total',
    scoring === 'points' ? 'fantasy points' : `${cats.length} categories`, keepers ? `${keepers} keeper${keepers === 1 ? '' : 's'} a team` : 'no keepers', snake ? 'snake draft' : 'same order every round'];

  if (!member) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4 text-sm text-white/80">
        <div className="font-semibold text-white">{signedIn ? 'Join a pool first' : 'Sign in to start a league'}</div>
        <p className="mt-1 text-white/70">{signedIn ? 'A fantasy league is started by someone already playing in a pool on Super Pools.' : 'Fantasy leagues are started from your account: sign in, then come back here from My pools.'} Or tell us about your league and we set it up with you.</p>
        <div className="mt-3 flex flex-wrap gap-2">{!signedIn && <a href="#/" className="btn-gold px-4 py-2 text-sm">Sign in</a>}<a href="#/start" className="btn-ghost px-4 py-2 text-sm">Ask us to set it up</a></div>
      </div>
    );
  }
  return (
    <>
      <Field title="How many teams?" note="Seat 1 is yours as commissioner; the rest wait for the GMs you invite from the Commish page.">
        <Seg value={teams} set={setTeams} options={[[6, '6'], [8, '8'], [10, '10'], [12, '12'], [14, '14']]} />
      </Field>
      <Field title="How it’s won" note={format === 'season' ? 'Every team plays the whole season against everyone: the best total at the end wins.' : 'Each week you play one other team; the best record makes the playoffs, and the bracket decides the champion.'}>
        <Seg value={format} set={setFormat} options={[['season', '📈 Season total'], ['h2h', '⚔️ Head-to-head']]} />
        {format === 'h2h' && <div className="mt-1.5"><Seg value={playoffs} set={setPlayoffs} options={[[0, 'No playoffs'], [4, '4 teams'], [6, '6 teams'], [8, '8 teams']]} /></div>}
      </Field>
      <Field title="How it scores" note={scoring === 'points' ? 'Every stat a player starts for you is worth points: goals, assists, shots, hits, a goalie’s wins and saves. The values start from the SaK Superleague’s; change them on the Commish page.'
        : `${format === 'h2h' ? 'Each week, win more categories than your opponent to win the week.' : 'Rotisserie: teams are ranked in each category on the season; first earns as many points as there are teams.'} Pick 3 to 12.`}>
        <Seg value={scoring} set={setScoring} options={[['points', '🏒 Fantasy points'], ['cats', format === 'h2h' ? '📊 Categories' : '📊 Rotisserie']]} />
        {scoring === 'cats' && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => {
              const on = cats.includes(c.key);
              return <button key={c.key} type="button" onClick={() => toggleCat(c.key)} title={c.label}
                className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 transition ${on ? 'text-[#0b1220]' : 'bg-white/[.04] text-white/70 ring-white/15'}`}
                style={on ? { background: color, borderColor: color, ['--tw-ring-color' as string]: color } : undefined}>{c.short}</button>;
            })}
          </div>
        )}
        {!okCats && <p className="mt-1.5 text-xs text-amber-200">Pick 3 to 12 categories.</p>}
      </Field>
      <Field title="Keepers and the draft" note={keepers ? `Each team keeps ${keepers} player${keepers === 1 ? '' : 's'} from one season to the next; the draft fills the rest.` : 'A fresh draft every season: nobody is kept.'}>
        <Seg value={keepers} set={setKeepers} options={[[0, 'None'], [1, '1'], [3, '3'], [5, '5'], [8, '8']]} />
        <div className="mt-1.5"><Seg value={snake ? 'snake' : 'straight'} set={(v) => setSnake(v === 'snake')} options={[['snake', '🐍 Snake draft'], ['straight', 'Same order each round']]} /></div>
      </Field>
      <Field title="Name it">
        <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="The Beer League" />
        <div className="mt-3 flex flex-wrap gap-2.5">
          {swatches.map((s) => (
            <button key={s} type="button" aria-label={`Colour ${s}`} onClick={() => setColor(s)} className="grid h-10 w-10 place-items-center rounded-full ring-2 transition"
              style={{ background: s, boxShadow: color === s ? `0 0 18px ${s}` : undefined, ['--tw-ring-color' as string]: color === s ? '#fff' : 'transparent' }}>
              {color === s && <Check size={18} className="text-[#0b1220]" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </Field>
      <div className="rounded-2xl p-3 text-sm" style={{ background: `rgb(${rgb(color)} / .1)`, boxShadow: `inset 0 0 0 1px rgb(${rgb(color)} / .35)` }}>
        <div className="text-[10px] font-black uppercase tracking-[.16em]" style={{ color }}>Your league</div>
        <div className="mt-1 font-semibold text-white">{name.trim() || 'Your league'}: {summary.join(' · ')}</div>
        <div className="mt-1 text-xs text-white/60">NHL players, SaK’s roster and calendar. It opens in setup: invite the GMs, set the draft, and take it live from the Commish page when the checklist is ticked.</div>
      </div>
      <button type="button" className="btn-gold w-full py-3 text-base" disabled={busy || !ready} onClick={start}>{busy ? <Spinner /> : '🏒 Start my league'}</button>
      {err && <div className="rounded-xl border border-red-400/30 bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">{err}</div>}
    </>
  );
}
