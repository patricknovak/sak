// A Rink Duel challenge reaches a member wherever they are in the app: a card drops in at the top, "Terry challenges
// you", take them on or not now. Only in a hockey league or pool (useRinkOn); nothing is stored.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from '../../lib/store';
import { joinLobby, leaveLobby, onLobby, sendLobby, useRinkOn } from '../../lib/rink/net';
import { TeamBadge } from '../ui';

interface Invite { id: string; from: number; at: number }
const LASTS = 45_000;

export function RinkInvites() {
  const { me, league, teams, spectators } = useLeague();
  const on = useRinkOn();
  const lid = league?.league_id ?? null;
  const nav = useNavigate();
  const [invites, setInvites] = useState<Invite[]>([]);

  useEffect(() => {
    if (!on || lid == null || !me) return;
    joinLobby(lid);
    const off = onLobby((m) => {
      if (m.to !== me.id) return;
      if (m.type === 'invite') {
        setInvites((l) => [...l.filter((x) => x.from !== m.from), { id: m.id, from: m.from, at: Date.now() }]);
        try { navigator.vibrate?.([60, 40, 60]); } catch { /* no vibration */ }
      } else if (m.type === 'cancel') setInvites((l) => l.filter((x) => x.id !== m.id));
    });
    const tick = setInterval(() => setInvites((l) => { const n = l.filter((x) => Date.now() - x.at < LASTS); return n.length === l.length ? l : n; }), 2000);
    return () => { off(); clearInterval(tick); leaveLobby(); };
  }, [on, lid, me?.id]);

  if (!me || !invites.length) return null;
  const inv = invites[invites.length - 1];
  const from = [...teams, ...spectators].find((t) => t.id === inv.from);
  const answer = (ok: boolean) => {
    sendLobby({ type: 'reply', id: inv.id, from: me.id, to: inv.from, ok });
    setInvites((l) => l.filter((x) => x.id !== inv.id));
    if (ok) nav(`/rink?m=${inv.id}&vs=${inv.from}`);
  };
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[58] flex justify-center px-3" style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)' }}>
      <div className="animate-slideup pointer-events-auto w-full max-w-md overflow-hidden rounded-3xl border border-gold/40 bg-gradient-to-br from-[#1a2742]/95 to-[#0b1222]/95 shadow-[0_20px_50px_-12px_rgba(0,0,0,.9),0_0_30px_-10px_rgb(var(--gold-rgb)/.6)] backdrop-blur-xl">
        <div className="flex items-center gap-3 p-3">
          <div className="relative">
            <TeamBadge team={from} size={44} />
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-[#0b1222] text-sm ring-2 ring-gold/60">🏒</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-[.18em] text-gold">Rink Duel</div>
            <div className="text-sm font-bold leading-snug text-white">{from?.name ?? 'A member'} challenges you</div>
            <div className="text-xs text-white/60">Thumb air hockey, first to 7. Right now.</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 px-3 pb-3">
          <button className="btn-ghost" onClick={() => answer(false)}>Not now</button>
          <button className="btn-gold" onClick={() => answer(true)}>Take them on</button>
        </div>
      </div>
    </div>
  );
}
