// Every live pool's sports games, on the Platform page (migration 224): who plays, each game with how many have picked
// and how lately, and the events a pool opens prop sheets on by itself, so a test like the World Series is watched from
// one place.
import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { ago } from '../lib/format';
import { poolLink } from '../lib/host';
import { KINDS, type GameKind } from '../lib/poolGames';
import { Section } from './ui';

interface Game { id: number; kind: string; title: string; status: 'open' | 'done'; competition: string; locked: boolean; pickers: number; last: string | null }
// `auto`: the names of the events it opens prop sheets on by itself
interface Pool { league_id: number; name: string; slug: string; color: string | null; players: number; last: string | null; auto: string[]; games: Game[] }

const emoji = (k: string) => (k in KINDS ? KINDS[k as GameKind].emoji : k === 'score' ? '🎯' : '🎲');

export function PoolGamesPlatform() {
  const [pools, setPools] = useState<Pool[] | null>(null);
  useEffect(() => { rpc<Pool[]>('platform_pool_games').then((p) => setPools(p ?? []), () => setPools([])); }, []);
  if (!pools?.length) return null;
  const games = pools.reduce((n, p) => n + p.games.filter((g) => g.status === 'open').length, 0);
  return (
    <Section title="Sports games" right={<span className="text-xs text-mute">{pools.length} {pools.length === 1 ? 'pool' : 'pools'} · {games} open</span>}>
      <div className="space-y-2">
        {pools.map((p) => (
          <div key={p.league_id} className="card overflow-hidden p-0">
            <a href={poolLink(p.slug)} className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-white/[.03]">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color ?? 'rgb(var(--gold-rgb))' }} />
              <span className="min-w-0 flex-1">
                <span className="block break-words font-semibold leading-snug text-white">{p.name}</span>
                <span className="block text-[11px] text-mute">{p.players} {p.players === 1 ? 'player' : 'players'}{p.last ? ` · last pick ${ago(p.last)}` : ' · no picks yet'}</span>
              </span>
            </a>
            {(p.games.length > 0 || p.auto.length > 0) && (
              <div className="divide-y divide-white/[.05] border-t border-white/[.06]">
                {p.games.map((g) => (
                  <div key={g.id} className={`flex items-center gap-2.5 px-3.5 py-2 ${g.status === 'done' ? 'opacity-60' : ''}`}>
                    <span className="w-5 shrink-0 text-center">{emoji(g.kind)}</span>
                    <span className="min-w-0 flex-1 break-words text-[13px] leading-snug text-slate-200">{g.title}</span>
                    <span className="num shrink-0 text-[11px] text-mute">{g.pickers}/{p.players}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${g.status === 'done' ? 'text-mute ring-white/10' : g.locked ? 'text-sky-200 ring-sky-300/30' : 'text-emerald-200 ring-emerald-300/30'}`}>
                      {g.status === 'done' ? 'Done' : g.locked ? 'Locked' : 'Open'}
                    </span>
                  </div>
                ))}
                {p.auto.length > 0 && (
                  <div className="px-3.5 py-2 text-[11px] text-mute">📋 Sheets open by themselves on {p.auto.join(', ')}</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
