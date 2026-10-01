// Garry at the window: a private line at the Book where a GM says what they feel like betting on and Garry
// answers with picks. He reads the board (what's open, who's on it, what closes soon), how this GM bets, and the
// Book's own suggestions; each pick comes back as a card that places the ticket, or opens the Ask the Book sheet
// with the market already built. Nothing is placed until the GM taps. The conversation stays on this phone.
import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { useLeague } from '../lib/store';
import { useBrand } from '../lib/brand';
import { supabase } from '../lib/supabase';
import type { BookPreview, BookRequest, Market, MarketOption } from '../lib/types';
import { fmtDate } from '../lib/format';
import { Spinner } from './ui';

type Pick = { market_id: number; pick: string; why: string; title: string; kind: string; label: string; odds: number; closes_at: string; backers: number };
type Req = { request: BookRequest; why: string; preview: BookPreview };
type Turn = { role: 'user' | 'assistant'; content: string; picks?: Pick[]; requests?: Req[] };
const american = (o: number) => (o >= 2 ? `+${Math.round((o - 1) * 100)}` : `${Math.round(-100 / (o - 1))}`);
const KEY = 'sak-book-chat';

export function BookChat({ markets, onPick, onRequest }: { markets: Market[]; onPick: (m: Market, o: MarketOption) => void; onRequest: (r: BookRequest) => void }) {
  const { me } = useLeague();
  const brand = useBrand();
  const name = brand.bot.name;
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); } catch { return []; } });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(turns.length > 0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-12))); } catch { /* private window */ } }, [turns]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [turns.length, busy]);

  const STARTERS = [`What’s hot right now?`, 'Something for tonight', 'A long shot on the season', 'Something on my guys', 'A race I can ask for'];

  const ask = async (q: string) => {
    const content = q.trim();
    if (!content || busy) return;
    setOpen(true); setText('');
    const next: Turn[] = [...turns, { role: 'user', content }];
    setTurns(next); setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('garry?task=book', { method: 'POST', body: { messages: next.slice(-8).map((t) => ({ role: t.role, content: t.content })) } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? `${name} didn’t answer`);
      const r = data.result as { reply: string; picks: Pick[]; requests: Req[] };
      setTurns((t) => [...t, { role: 'assistant', content: r.reply, picks: r.picks, requests: r.requests }]);
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', content: `${name} stepped away from the window (${(e as Error).message}). Try again in a minute.` }]);
    } finally { setBusy(false); }
  };

  if (!me || me.role === 'spectator') return null;
  return (
    <div className="card overflow-hidden">
      <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(!open)}>
        <span className="text-2xl">{brand.bot.emoji ?? '🎙️'}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Ask {name} what to bet on</span>
          <span className="block text-xs text-mute">He reads the board, how you bet and what everyone else is on, and hands you picks you can place in one tap.</span>
        </span>
        <span className="text-mute">{open ? '▾' : '›'}</span>
      </button>
      {open && (
        <div className="border-t border-white/[.06]">
          <div className="max-h-[60vh] space-y-2 overflow-y-auto p-3">
            {turns.length === 0 && <div className="text-xs text-mute">Tell him what you’re in the mood for: a team, a player, tonight or the long game, safe or a flyer. Or tap a starter below.</div>}
            {turns.map((t, i) => (
              <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[92%] space-y-2 rounded-2xl px-3 py-2 text-sm ${t.role === 'user' ? 'bg-sky-500/20' : 'bg-white/[.05]'}`}>
                  {t.role === 'assistant' && <div className="text-[11px] font-semibold text-emerald-300">{name}</div>}
                  <div className="whitespace-pre-wrap">{t.content}</div>
                  {t.picks && t.picks.length > 0 && (
                    <div className="space-y-1.5">
                      {t.picks.map((p) => {
                        const m = markets.find((x) => x.id === p.market_id);
                        const o = m?.options.find((x) => x.key === p.pick);
                        const gone = !m || m.status !== 'open' || new Date(m.closes_at).getTime() <= Date.now();
                        return (
                          <div key={`${p.market_id}-${p.pick}`} className="rounded-xl border border-white/[.08] bg-black/20 p-2">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs text-mute">{p.title}</div>
                                <div className="text-sm font-semibold">{p.label} <span className="num text-gold">{p.odds.toFixed(2)}</span> <span className="text-[10px] text-mute">{american(p.odds)}{p.backers ? ` · ${p.backers} on it` : ''}</span></div>
                              </div>
                              <button className="btn-blue btn-sm shrink-0" disabled={gone} onClick={() => m && o && onPick(m, o)}>{gone ? 'Closed' : 'Place it'}</button>
                            </div>
                            {p.why && <div className="mt-1 text-[11px] text-slate-300">{p.why}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {t.requests && t.requests.length > 0 && (
                    <div className="space-y-1.5">
                      {t.requests.map((r, j) => (
                        <div key={j} className="rounded-xl border border-amber-400/20 bg-amber-500/[.06] p-2">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] uppercase tracking-wider text-amber-200">Not on the board yet</div>
                              <div className="truncate text-sm font-semibold">{r.preview.title}</div>
                              <div className="truncate text-[11px] text-mute">{r.preview.options.map((o) => `${o.label} ${Number(o.odds).toFixed(2)}`).join(' · ')} · tickets until {fmtDate(r.preview.closes_at.slice(0, 10))}</div>
                            </div>
                            <button className="btn-primary btn-sm shrink-0" onClick={() => onRequest(r.request)}>Ask for it</button>
                          </div>
                          {r.why && <div className="mt-1 text-[11px] text-slate-300">{r.why}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-xs text-emerald-300"><Spinner /> {name} is reading the board…</div>}
            <div ref={end} />
          </div>
          {!busy && (
            <div className="scroll-x flex gap-1 px-3 pb-2">
              {STARTERS.map((s) => <button key={s} className="chip shrink-0 py-1" onClick={() => ask(s)}>{s}</button>)}
              {turns.length > 0 && <button className="chip shrink-0 py-1 text-mute" onClick={() => setTurns([])}>Clear</button>}
            </div>
          )}
          <form className="flex items-center gap-2 border-t border-white/[.06] p-2" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
            <input className="input flex-1" placeholder={`Ask ${name}: “something on McDavid tonight”, “a safe 50”, “who’s everyone on?”`} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} disabled={busy} />
            <button type="submit" className="btn-blue h-10 w-10 shrink-0 p-0" disabled={busy || !text.trim()} aria-label="Ask"><Send size={16} /></button>
          </form>
          <p className="px-3 pb-2 text-[10px] text-mute">Picks are {name}’s opinion on coins, not advice on anything real. Nothing is placed until you tap. This chat stays on your phone.</p>
        </div>
      )}
    </div>
  );
}
