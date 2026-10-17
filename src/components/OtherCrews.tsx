// "Run a pool for your other crew" (17 October 2026). The week's numbers said it plainly: the league's GMs open the app
// every day and no one else does, and none of them had ever been shown that the same app runs a pool for their family,
// their office or the group chat. This card, on a fantasy league's home, is that door: the pools you're already in (one
// tap into each), and the best few events starting soon, each a tap into the start page with the event and its pool
// already chosen (#/new?comp=…, the way the landing page's board does it). "Not now" puts it away for two weeks. And the
// pools the league's GMs posted in its chat (migration 311) that you're not in yet, each a tap from joining.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import { rpc, supabase } from '../lib/supabase';
import { poolCardOf, type PoolCardMeta } from './PoolInviteCard';
import { TeamBadge } from './ui';
import { openPool } from '../lib/host';
import { KINDS, type GameKind, type PoolEvent } from '../lib/poolGames';
import { useLeague } from '../lib/store';

type Mine = { league_id: number; slug: string; name: string; short: string | null; kind: 'fantasy' | 'predict'; here: boolean; role: string; brand: { colors?: { gold?: string } }; summary?: { rank?: number; of?: number; open?: number; closing?: number } };

const SPORT_EMOJI: Record<string, string> = { nfl: '🏈', nba: '🏀', mlb: '⚾', nhl: '🏒', soccer: '⚽', ncaab: '🏀' };
// for each sport, the pool to lead with: a hockey crowd's box pool, a postseason's series, a season's win totals, else the first
const LEAD: GameKind[] = ['players', 'series', 'pickem', 'wins', 'survivor'];
const short = (e: PoolEvent) => e.name.replace(/\s+\d{4}(-\d{2})?(\s+games)?$/i, '').replace(/^MLB Postseason.*/, 'MLB postseason');
const when = (iso: string | null) => {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (ms < 0) return '';
  const h = ms / 3_600_000;
  if (h < 20) return `first lock ${new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  return `first lock ${new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })}`;
};
const KEY = (league: number) => `sak-crews-hide:${league}`;

export function OtherCrews() {
  const { league, me, team } = useLeague();
  const lid = league?.league_id ?? 0;
  const [hidden, setHidden] = useState(() => { try { return Number(localStorage.getItem(KEY(lid)) ?? 0) > Date.now(); } catch { return false; } });
  const [events, setEvents] = useState<PoolEvent[] | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [inPools, setInPools] = useState<Set<number> | null>(null);
  // pools the league's own GMs posted in this chat in the last month (migration 311): only what they chose to share here
  const [shared, setShared] = useState<{ card: PoolCardMeta; by: number | null; msg: number }[]>([]);
  useEffect(() => {
    if (hidden || !me) return;
    rpc<PoolEvent[]>('pool_event_list').then((e) => setEvents(e ?? []), () => setEvents([]));
    rpc<Mine[]>('my_pools').then((d) => { setMine((d ?? []).filter((p) => !p.here && p.league_id !== lid)); setInPools(new Set((d ?? []).map((p) => p.league_id))); }, () => { setMine([]); setInPools(new Set()); });
    supabase.from('messages').select('id,team_id,meta').eq('deleted', false).not('meta->pool_card', 'is', null).gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order('id', { ascending: false }).limit(30)
      .then(({ data }) => {
        const seen = new Set<number>();
        setShared((data ?? []).map((m) => ({ card: poolCardOf(m.meta as Record<string, unknown>), by: m.team_id as number | null, msg: m.id as number }))
          .filter((x): x is { card: PoolCardMeta; by: number | null; msg: number } => !!x.card && !seen.has(x.card.league_id) && !!seen.add(x.card.league_id)));
      }, () => setShared([]));
  }, [hidden, me?.id, lid]);
  const toJoin = inPools ? shared.filter((x) => !inPools.has(x.card.league_id)).slice(0, 3) : [];

  // the best few: one per sport, those locking within ten days first, soonest first
  const tiles = useMemo(() => {
    const soon = (events ?? []).filter((e) => e.next_lock && Date.parse(e.next_lock) > Date.now() && Date.parse(e.next_lock) - Date.now() < 10 * 86_400_000);
    const best = new Map<string, { e: PoolEvent; k: GameKind }>();
    for (const e of soon) {
      const k = LEAD.find((x) => e.kinds.includes(x)) ?? e.kinds[0];
      if (!k) continue;
      const have = best.get(e.sport);
      // in one sport, the event whose lead pool ranks higher wins (the NHL box pool over its weekly pick'em)
      if (!have || LEAD.indexOf(k) < LEAD.indexOf(have.k)) best.set(e.sport, { e, k });
    }
    return [...best.values()].sort((a, b) => Date.parse(a.e.next_lock!) - Date.parse(b.e.next_lock!)).slice(0, 4);
  }, [events]);

  if (hidden || !me || (events !== null && !tiles.length && !mine.length && !toJoin.length)) return null;
  const hide = () => { try { localStorage.setItem(KEY(lid), String(Date.now() + 14 * 86_400_000)); } catch { /* private mode */ } setHidden(true); };

  return (
    <section className="card relative overflow-hidden p-0">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgb(var(--gold-rgb)/.22),transparent_70%)]" />
      <div className="relative flex items-start gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[.18em] text-gold">Your other crews</div>
          <h3 className="mt-0.5 font-display text-lg font-extrabold leading-tight">Run a pool for family, work or the group chat</h3>
          <p className="mt-0.5 text-xs text-mute">Free, a minute to set up, on this same app. You run it; they join from a link, no app to download.</p>
        </div>
        <button type="button" onClick={hide} aria-label="Not now" title="Not now" className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-mute hover:bg-white/10"><X size={16} /></button>
      </div>

      {toJoin.length > 0 && (
        <div className="relative px-4 pb-2">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-mute">Pools from your league</div>
          <div className="space-y-2">
            {toJoin.map(({ card, by }) => {
              const c = card.color && /^#[0-9a-f]{6}$/i.test(card.color) ? card.color : '#f7c548';
              const who = team(by);
              return (
                <Link key={card.league_id} to={`/join/${card.code}`} className="flex items-center gap-2.5 rounded-2xl border p-2.5 transition active:scale-[.99]"
                  style={{ borderColor: `${c}55`, background: `linear-gradient(135deg, ${c}22, transparent 70%)` }}>
                  {who ? <TeamBadge team={who} size={32} /> : <span className="h-8 w-8" />}
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-bold leading-tight">{card.name}</span>
                    <span className="block text-[11px] leading-snug text-mute">{who ? `${who.gm_name}'s pool` : 'A pool'}{card.what ? ` · ${card.what}` : ''} · {card.members} in</span>
                  </span>
                  <span className="shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold text-ice" style={{ background: c }}>Join</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <div className="relative px-4 pb-2">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-mute">Your pools</div>
          <div className="scroll-x -mx-4 flex gap-2 px-4">
            {mine.map((p) => {
              const c = p.brand.colors?.gold && /^#[0-9a-f]{6}$/i.test(p.brand.colors.gold) ? p.brand.colors.gold : '#f7c548';
              const s = p.summary;
              return (
                <button key={p.league_id} type="button" onClick={() => openPool(p)} className="flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[.04] py-1.5 pl-1.5 pr-3 text-left transition active:scale-[.98]">
                  <span className="grid h-8 w-8 place-items-center rounded-xl text-[11px] font-black" style={{ background: `${c}26`, color: c, boxShadow: `inset 0 0 0 1.5px ${c}` }}>{(p.short ?? p.name).slice(0, 3).toUpperCase()}</span>
                  <span className="min-w-0">
                    <span className="block max-w-[10rem] break-words text-sm font-bold leading-tight">{p.name}</span>
                    <span className="block text-[11px] text-mute">{s?.closing ? `${s.closing} to call` : s?.rank && s.of ? `${s.rank} of ${s.of}` : p.role === 'commish' ? 'You host' : 'Open it'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tiles.length > 0 && (
        <div className="relative grid grid-cols-2 gap-2 px-4 pb-3 pt-1">
          {tiles.map(({ e, k }) => (
            <Link key={e.competition} to={`/new?comp=${encodeURIComponent(e.competition)}&kind=${k}&src=league_home`}
              className="group flex min-w-0 flex-col rounded-2xl border border-white/10 bg-gradient-to-br from-white/[.07] to-white/[.02] p-3 transition hover:border-gold/40 active:scale-[.98]">
              <span className="flex items-center gap-1.5">
                <span className="text-xl leading-none">{SPORT_EMOJI[e.sport] ?? '🏆'}</span>
                <span className="min-w-0 break-words text-sm font-extrabold leading-tight">{short(e)}</span>
              </span>
              <span className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-100">{KINDS[k]?.title ?? 'A pool'}</span>
              <span className="mt-0.5 text-[11px] leading-snug text-mute">{[e.stage, when(e.next_lock)].filter(Boolean).join(' · ')}</span>
            </Link>
          ))}
        </div>
      )}
      <Link to="/new?type=questions&src=league_home" className="relative flex items-center gap-2.5 border-t border-white/[.06] px-4 py-3 text-sm transition hover:bg-white/[.03]">
        <span className="text-lg">🔮</span>
        <span className="min-w-0 flex-1"><span className="font-semibold">Anything else</span><span className="block text-xs text-mute">A show, an awards night, the office bake-off: ask your own questions.</span></span>
        <ArrowRight size={16} className="shrink-0 text-mute" />
      </Link>
    </section>
  );
}
