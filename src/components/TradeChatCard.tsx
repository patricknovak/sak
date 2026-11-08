// A trade in the chat, drawn as a card to talk about (7 November 2026, Patrick: "show all trades made in the chat ...
// make it such that you can comment on trades and the trade and comments show up in the chat, basically to increase
// the trash talk"). The league's own line about a trade (the offer, the "agreed" line and the "TRADE!" line,
// all carrying meta.trade) becomes this card: what each team gets, the latest comments, quick reactions and a Comment button. A
// comment is a chat reply to the line, so it shows in the feed too, with the trade quoted above it. The "Who won the
// trade?" poll (migration 351) is drawn under it by the chat.
import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { useBrand } from '../lib/brand';
import type { Message, Reaction, Trade, TradeItem } from '../lib/types';
import { PlayerTag } from './PlayerCard';
import { TeamBadge } from './ui';
import { IMAGE_BODY } from '../lib/chatMedia';

// the reactions a trade gets: fleeced first
export const TRADE_REACTIONS = ['🐑', '🔥', '🤡', '😂', '💀'];

// a trade is read once and kept for a minute: an offer's card shows where the offer stands (taken, turned down,
// countered), and scrolling the chat shouldn't read it again for every card
const cache = new Map<number, { at: number; p: Promise<Trade | null> }>();
function loadTrade(id: number): Promise<Trade | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = Promise.resolve(supabase.from('trades').select('*, trade_items(*)').eq('id', id).maybeSingle())
    .then(({ data }) => (data as Trade | null) ?? null, () => null);
  cache.set(id, { at: Date.now(), p });
  return p;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  proposed: { label: 'On the table', cls: 'border-sky-400/40 bg-sky-500/15 text-sky-100' },
  declined: { label: 'Turned down', cls: 'border-red-400/40 bg-red-500/15 text-red-200' },
  cancelled: { label: 'Withdrawn', cls: 'border-white/20 bg-white/[.06] text-slate-300' },
  countered: { label: 'Countered', cls: 'border-violet-400/40 bg-violet-500/15 text-violet-100' },
  approved: { label: 'Done deal', cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' },
  accepted: { label: 'Awaiting the commish', cls: 'border-amber-300/40 bg-amber-400/15 text-amber-100' },
  vetoed: { label: 'Vetoed', cls: 'border-red-400/40 bg-red-500/15 text-red-200' },
  failed: { label: 'Fell through', cls: 'border-red-400/40 bg-red-500/15 text-red-200' },
};

export function TradeChatCard({ id, m, comments, reactions, onReact, onComment, onJump, muted }: {
  id: number; m: Message; comments: Message[]; reactions: Reaction[];
  onReact: (emoji: string) => void; onComment: () => void; onJump: (id: number) => void; muted: boolean;
}) {
  const { team, players, picks, me } = useLeague();
  const brand = useBrand();
  const [trade, setTrade] = useState<Trade | null | undefined>(undefined);
  useEffect(() => { let on = true; loadTrade(id).then((t) => { if (on) setTrade(t); }); return () => { on = false; }; }, [id]);

  // the trade can't be read (another league's, or gone): the league's line on its own
  if (trade === null) return <div className="max-w-[92%] whitespace-pre-line rounded-full border border-white/10 bg-white/[.05] px-3.5 py-1.5 text-center text-xs font-medium text-slate-300">{m.body}</div>;

  const parts = trade ? trade.parties ?? [trade.from_team, trade.to_team] : [];
  const items = trade?.trade_items ?? [];
  const dest = (i: TradeItem) => i.to_team ?? parts.find((x) => x !== i.from_team) ?? i.from_team;
  const label = (i: TradeItem) => {
    if (i.player_id) { const p = players.get(i.player_id); return p ? <PlayerTag p={p} /> : <span>A player</span>; }
    if (i.pickups) return <span>🎟️ {i.pickups} pickup{i.pickups > 1 ? 's' : ''}</span>;
    if (i.coins) return <span>{brand.coin.emoji} {i.coins} {brand.coin.name}</span>;
    const k = picks.find((x) => x.id === i.pick_id);
    return <span>{k ? `${k.season} round ${k.round} pick${k.original_team !== i.from_team ? ` (via ${team(k.original_team)?.abbrev ?? '?'})` : ''}` : 'A draft pick'}</span>;
  };
  // three lines can name one trade: the offer (migration 353), the other side agreeing and the trade going through. The
  // done line is always a done deal; the offer and the agreed line show where the trade stands now
  const done = /^🔄/u.test(m.body);
  const offer = m.meta?.offer === true;
  const counter = offer && /^📨 Counter/u.test(m.body);
  const st = STATUS[done ? 'approved' : trade?.status ?? ''] ?? null;
  const waitingOnMe = !!me && trade?.status === 'proposed' && (trade.parties ? trade.parties.includes(me.id) && trade.from_team !== me.id && !(trade.accepted_by ?? []).includes(me.id) : trade.to_team === me.id);
  const counts = new Map<string, { n: number; me: boolean; who: string[] }>();
  for (const r of reactions) {
    const c = counts.get(r.emoji) ?? { n: 0, me: false, who: [] };
    c.n++; if (r.team_id === me?.id) c.me = true;
    const g = team(r.team_id)?.gm_name; if (g) c.who.push(g);
    counts.set(r.emoji, c);
  }
  const quick = [...TRADE_REACTIONS, ...[...counts.keys()].filter((e) => !TRADE_REACTIONS.includes(e))];
  const last = comments.filter((c) => !c.deleted).slice(-2);

  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/[.13] via-[#131d35] to-[#0e1629] text-left shadow-[0_10px_30px_-16px_rgb(var(--gold-rgb)/.9)]">
      <div className="flex items-center gap-2 border-b border-white/[.07] px-3 py-2">
        <span className="text-lg leading-none">{done ? '🔄' : offer ? '📨' : '🤝'}</span>
        <span className="h-display text-sm font-black uppercase tracking-[.14em] text-gold">{done ? 'Trade!' : counter ? 'Counter-offer' : offer ? 'Trade offer' : 'Trade agreed'}</span>
        {parts.length > 2 && <span className="text-[11px] text-mute">{parts.length}-team deal</span>}
        {st && <span className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.cls}`}>{st.label}</span>}
      </div>

      {trade === undefined ? (
        <div className="px-3 py-3 text-sm text-slate-300">{m.body}</div>
      ) : (
        <div className={`grid gap-px bg-white/[.06] ${parts.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {parts.map((side) => {
            const t = team(side);
            const gets = items.filter((i) => !i.release && dest(i) === side && i.from_team !== side);
            const drops = items.filter((i) => i.release && i.from_team === side);
            return (
              <div key={side} className="min-w-0 bg-[#111a2f] px-3 py-2.5">
                <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
                  <TeamBadge team={t} size={22} />
                  <span className="min-w-0 text-sm font-bold leading-tight">{t?.name ?? 'A team'}</span>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[.14em] text-mute">gets</div>
                <ul className="mt-0.5 space-y-0.5 text-sm leading-snug">
                  {gets.map((i) => <li key={i.id} className="flex gap-1"><span className="text-gold">+</span><span className="min-w-0">{label(i)}{parts.length > 2 && <span className="text-mute"> from {team(i.from_team)?.abbrev}</span>}</span></li>)}
                  {gets.length === 0 && <li className="text-mute">nothing</li>}
                </ul>
                {drops.map((i) => <div key={i.id} className="mt-1 text-xs text-amber-200">✂️ drops {players.get(i.player_id!)?.name ?? 'a player'}</div>)}
              </div>
            );
          })}
        </div>
      )}
      {waitingOnMe && (
        <Link to="/trades" className="flex items-center gap-2 border-t border-sky-400/20 bg-sky-500/10 px-3 py-2 text-sm font-bold text-sky-100">
          📬 This offer is to you<span className="ml-auto text-xs font-semibold">Answer it →</span>
        </Link>
      )}
      {trade?.note && <p className="border-t border-white/[.07] px-3 py-1.5 text-xs italic text-slate-300">“{trade.note}” <span className="not-italic text-mute">· {team(trade.from_team)?.gm_name}</span></p>}

      {last.length > 0 && (
        <div className="space-y-1 border-t border-white/[.07] px-3 py-2">
          {comments.length > last.length && <button type="button" className="text-[11px] font-semibold text-sky-300 hover:underline" onClick={() => onJump(comments[0].id)}>See all {comments.length} comments</button>}
          {last.map((c) => {
            const t = team(c.team_id);
            return (
              <button key={c.id} type="button" onClick={() => onJump(c.id)} className="flex w-full items-start gap-1.5 text-left text-[13px] leading-snug">
                <span className="mt-px shrink-0"><TeamBadge team={t} size={16} /></span>
                <span className="min-w-0 break-words"><b className="font-semibold">{t?.gm_name}</b> {c.body === IMAGE_BODY ? '📷 Photo' : c.body}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 border-t border-white/[.07] px-2 py-1.5">
        {quick.map((e) => {
          const c = counts.get(e);
          return (
            <button key={e} type="button" disabled={muted} title={c ? c.who.join(', ') : e === '🐑' ? 'Fleeced' : undefined} onClick={() => onReact(e)}
              className={`flex h-7 items-center gap-0.5 rounded-full border px-1.5 text-sm transition active:scale-95 disabled:opacity-60 ${c?.me ? 'border-sky-400/70 bg-sky-500/20' : c ? 'border-white/15 bg-white/[.06]' : 'border-transparent opacity-70 hover:opacity-100'}`}>
              {e}{c && <span className="num text-[11px] font-bold">{c.n}</span>}
            </button>
          );
        })}
        {!muted && (
          <button type="button" onClick={onComment} className="ml-auto flex h-7 items-center gap-1 rounded-full bg-gold/90 px-2.5 text-xs font-bold text-[#1a1203] shadow transition active:scale-95">
            <MessageCircle size={13} />{comments.length ? `Comment · ${comments.length}` : 'Comment'}
          </button>
        )}
      </div>
    </div>
  );
}
