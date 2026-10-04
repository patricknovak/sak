import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { brandOf, brandShades, SAK_BRAND, type Brand } from '../lib/brand';
import { hasFeature } from '../lib/features';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { Wordmark } from './Brand';
import { useAction } from './ui';

// A league's identity: its name, its wordmark, its colour and the words it uses for its prizes, its coins and its
// voice. The commissioner sets it on the Commish page; the platform sets the first one when it opens the league.
// Whatever is left empty falls back to the default (brandOf), and the preview shows it the way GMs will see it.

// the colours a league can pick from, each bright enough to read on the rink; any other hex works through the picker
export const LEAGUE_COLOURS = [
  { hex: '#f7c548', name: 'Gold' }, { hex: '#4cc3ff', name: 'Ice' }, { hex: '#ff5a6e', name: 'Goal red' }, { hex: '#34d399', name: 'Clover' },
  { hex: '#a78bfa', name: 'Violet' }, { hex: '#fb923c', name: 'Orange' }, { hex: '#f472b6', name: 'Pink' }, { hex: '#e2e8f0', name: 'Silver' },
];

// the shades of a colour, set on an element so everything inside it draws in that colour (the page itself is themed
// the same way, on the root, by the store)
export const themed = (gold: string): CSSProperties => ({ ...brandShades(gold), '--tc': gold } as CSSProperties);

// what a brand row holds that the site reads; also what a new league starts with (neutral words, never SaK's)
export interface BrandRow {
  wordmark?: { a?: string; b?: string }; tagline?: string; trophy?: string; regular?: string; playoff?: string; booby?: string;
  fund?: string; bank?: string; bot?: { name?: string; emoji?: string }; coin?: { name?: string; emoji?: string }; colors?: { gold?: string };
  [k: string]: unknown;
}
export const starterBrand = (name: string, short: string, gold: string): BrandRow => {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  return {
    wordmark: { a: (words[0] ?? short.toUpperCase()).slice(0, 16), b: (words.slice(1).join(' ') || 'POOL').slice(0, 16) },
    tagline: '', trophy: `The ${short || 'League'} Cup`, regular: 'The Regular Season Crown', playoff: 'The Playoff Cup', booby: 'The Wooden Spoon',
    coin: { name: 'Coins', emoji: '🪙' }, bot: { name: 'Garry', emoji: '🎙️' }, colors: { gold },
  };
};

export function ColourPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const custom = !LEAGUE_COLOURS.some((c) => c.hex === value.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-2">
      {LEAGUE_COLOURS.map((c) => {
        const on = c.hex === value.toLowerCase();
        return (
          <button key={c.hex} type="button" title={c.name} aria-label={c.name} aria-pressed={on} onClick={() => onChange(c.hex)}
            className={`grid h-9 w-9 place-items-center rounded-full transition active:scale-90 ${on ? 'ring-2 ring-white ring-offset-2 ring-offset-rink' : 'ring-1 ring-white/15 hover:ring-white/40'}`}
            style={{ background: `radial-gradient(circle at 35% 30%, ${brandShades(c.hex)['--gold-hi']}, ${c.hex} 55%, ${brandShades(c.hex)['--gold-lo']})` }}>
            {on && <span className="text-sm font-black text-black/70">✓</span>}
          </button>
        );
      })}
      <label title="Any colour" className={`relative grid h-9 w-9 cursor-pointer place-items-center overflow-hidden rounded-full ${custom ? 'ring-2 ring-white ring-offset-2 ring-offset-rink' : 'ring-1 ring-white/15'}`}
        style={{ background: custom ? value : 'conic-gradient(#ff5a6e, #fb923c, #f7c548, #34d399, #4cc3ff, #a78bfa, #f472b6, #ff5a6e)' }}>
        <span className="text-sm font-black text-black/60">{custom ? '✓' : '+'}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Pick any colour" />
      </label>
    </div>
  );
}

// the league as its GMs will see it: the wordmark in its colour, a lit tab and button, the prizes, the coins, the voice
export function BrandPreview({ name, brand, compact }: { name: string; brand: Brand; compact?: boolean }) {
  const chip = 'inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-semibold text-slate-200';
  return (
    <div className="card-hero p-4" style={themed(brand.colors.gold)}>
      <div className="relative">
        <div className="label text-white/50">{name || 'Your league'}</div>
        <Wordmark size="lg" mark={brand.wordmark} tagline={brand.tagline || undefined} className="mt-1.5 max-w-full" />
        <div className="gold-rule mt-3" />
        {!compact && (
          <>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className={chip}>🏆 {brand.trophy}</span>
              <span className={chip}>🥇 {brand.regular}</span>
              <span className={chip}>🏒 {brand.playoff}</span>
              <span className={chip}>🥄 {brand.booby}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="tab tab-on">Standings</span>
              <span className="btn-gold btn-sm">Set lineup</span>
              <span className={chip}>{brand.coin.emoji} 1,000 {brand.coin.name}</span>
            </div>
            <div className="mt-3 flex items-start gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-base">{brand.bot.emoji}</span>
              <div className="min-w-0 rounded-2xl rounded-tl-sm border border-white/10 bg-black/25 px-3 py-2 text-xs text-slate-200">
                <span className="font-bold text-gold">{brand.bot.name}</span> Puck drops at seven. Lineups lock with the first game, so get yours in.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const Field = ({ label, value, onChange, placeholder, max, className = '' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; max: number; className?: string }) => (
  <label className={`block min-w-0 ${className}`}>
    <span className="label">{label}</span>
    <input className="input mt-1" value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  </label>
);

// the commissioner's editor, on the Commish page
export function LeagueIdentity() {
  const { league, refresh } = useLeague();
  const { busy, run } = useAction();
  const [row, setRow] = useState<{ name: string; short: string; brand: BrandRow } | null>(null);
  const load = () => supabase.from('leagues').select('name,short_name,brand').eq('id', league?.league_id ?? 1).maybeSingle().then(({ data: x }) => {
    if (x) setRow({ name: x.name as string, short: x.short_name as string, brand: (x.brand ?? {}) as BrandRow });
  });
  useEffect(() => { load(); }, [league?.league_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const b = row?.brand ?? {};
  const set = (patch: BrandRow) => setRow((r) => (r ? { ...r, brand: { ...r.brand, ...patch } } : r));
  const pair = (k: 'wordmark' | 'bot' | 'coin', f: string, v: string) => set({ [k]: { ...(b[k] as Record<string, string> | undefined), [f]: v } });
  const shown = useMemo(() => brandOf(b as Partial<Brand>, row?.short), [b, row?.short]);
  if (!row) return <div className="card h-40 animate-pulse" />;
  const fund = hasFeature(league, 'fund');
  const gold = b.colors?.gold || SAK_BRAND.colors.gold;

  const save = () => run(async () => {
    await rpc('commish_set_brand', { p_name: row.name, p_short: row.short, p_brand: {
      wordmark: { a: b.wordmark?.a ?? '', b: b.wordmark?.b ?? '' }, tagline: b.tagline ?? '', trophy: b.trophy ?? '', regular: b.regular ?? '',
      playoff: b.playoff ?? '', booby: b.booby ?? '', bank: b.bank ?? '', ...(fund ? { fund: b.fund ?? '' } : {}),
      coin: { name: b.coin?.name ?? '', emoji: b.coin?.emoji ?? '' }, bot: { name: b.bot?.name ?? '', emoji: b.bot?.emoji ?? '' }, colors: { gold },
    } });
    await load(); await refresh(['league']);
  }, 'League identity saved');

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-mute">How the league looks and talks to its GMs: the name on every page, the wordmark, the colour, the prizes and the coins. Leave a box empty for the default shown in it.</p>
      <div className="lg:grid lg:grid-cols-[1fr_minmax(0,22rem)] lg:items-start lg:gap-4">
        <div className="lg:sticky lg:top-4 lg:order-2"><BrandPreview name={row.name} brand={shown} /></div>
        <div className="card mt-3 space-y-4 p-3 lg:order-1 lg:mt-0">
          <div className="grid grid-cols-[1fr_6.5rem] gap-2">
            <Field label="League name" value={row.name} max={60} onChange={(v) => setRow({ ...row, name: v })} />
            <Field label="Short name" value={row.short} max={12} onChange={(v) => setRow({ ...row, short: v })} />
          </div>
          <div>
            <div className="label mb-1">Wordmark</div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input font-display text-lg font-extrabold uppercase italic text-gold" maxLength={16} value={b.wordmark?.a ?? ''} placeholder={shown.wordmark.a} onChange={(e) => pair('wordmark', 'a', e.target.value.toUpperCase())} />
              <input className="input font-display text-lg font-black uppercase" maxLength={16} value={b.wordmark?.b ?? ''} placeholder={shown.wordmark.b} onChange={(e) => pair('wordmark', 'b', e.target.value.toUpperCase())} />
            </div>
          </div>
          <Field label="Tagline" value={b.tagline ?? ''} max={40} placeholder="A line under the wordmark (optional)" onChange={(v) => set({ tagline: v })} />
          <div>
            <div className="label mb-1.5">Colour</div>
            <ColourPicker value={gold} onChange={(hex) => set({ colors: { gold: hex } })} />
          </div>
          <div>
            <div className="label mb-1">Prizes</div>
            <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
              <Field label="🏆 The season" value={b.trophy ?? ''} max={40} placeholder={shown.trophy} onChange={(v) => set({ trophy: v })} />
              <Field label="🥇 Regular season" value={b.regular ?? ''} max={40} placeholder={shown.regular} onChange={(v) => set({ regular: v })} />
              <Field label="🏒 Playoffs" value={b.playoff ?? ''} max={40} placeholder={shown.playoff} onChange={(v) => set({ playoff: v })} />
              <Field label="🥄 Last place" value={b.booby ?? ''} max={40} placeholder={shown.booby} onChange={(v) => set({ booby: v })} />
            </div>
          </div>
          <div>
            <div className="label mb-1">Coins and the league's voice</div>
            <div className="grid grid-cols-[4.25rem_1fr] gap-2">
              <input className="input text-center text-xl" maxLength={8} value={b.coin?.emoji ?? ''} placeholder={shown.coin.emoji} aria-label="Coin emoji" onChange={(e) => pair('coin', 'emoji', e.target.value)} />
              <input className="input" maxLength={30} value={b.coin?.name ?? ''} placeholder={shown.coin.name} aria-label="Coin name" onChange={(e) => pair('coin', 'name', e.target.value)} />
              <input className="input text-center text-xl" maxLength={8} value={b.bot?.emoji ?? ''} placeholder={shown.bot.emoji} aria-label="Voice emoji" onChange={(e) => pair('bot', 'emoji', e.target.value)} />
              <input className="input" maxLength={30} value={b.bot?.name ?? ''} placeholder={shown.bot.name} aria-label="Voice name" onChange={(e) => pair('bot', 'name', e.target.value)} />
            </div>
            <div className={`mt-2 grid gap-2 ${fund ? 'min-[400px]:grid-cols-2' : ''}`}>
              <Field label="Where the coins are kept" value={b.bank ?? ''} max={40} placeholder={shown.bank} onChange={(v) => set({ bank: v })} />
              {fund && <Field label="The league fund" value={b.fund ?? ''} max={40} placeholder={shown.fund} onChange={(v) => set({ fund: v })} />}
            </div>
          </div>
          <button className="btn-gold w-full py-3 text-base" style={themed(gold)} disabled={busy || row.name.trim().length < 2 || !row.short.trim()} onClick={save}>Save the league's identity</button>
        </div>
      </div>
    </div>
  );
}
