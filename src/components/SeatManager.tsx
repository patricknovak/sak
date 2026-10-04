import { useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { TeamBadge, useAction } from './ui';
import { appLink } from '../lib/host';

// Every GM seat in the league, for its commissioners: who runs the league with you (co-commissioners have every power
// you have), and handing over a team whose GM has gone. A handover keeps the team as it is (roster, picks, coins,
// history) and gives back an invite link for the seat's next GM.
const link = (code: string) => appLink(`/join/${code}`);

export function SeatManager() {
  const { teams, me, refresh } = useLeague();
  const { busy, run } = useAction();
  const [handed, setHanded] = useState<{ team: string; code: string } | null>(null);
  const commishes = teams.filter((t) => t.is_commish).length;

  const share = async (code: string) => {
    try { if (navigator.share) { await navigator.share({ title: 'Take over a team', url: link(code) }); return; } } catch { /* fall back to copying */ }
    try { await navigator.clipboard.writeText(link(code)); } catch { /* shown below to copy by hand */ }
  };

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-mute">A co-commissioner can do everything you can on this page. A GM who has left can hand their team to someone new: the team keeps its roster, picks, coins and history, and you get an invite link for its next GM.</p>
      <div className="card divide-y divide-white/[.06]">
        {teams.map((t) => {
          const mine = t.id === me?.id;
          return (
            <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <TeamBadge team={t} size={30} />
              <div className="min-w-0 flex-1 basis-40">
                <div className="break-words text-sm font-semibold">{t.name}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-mute">
                  {t.user_id ? t.gm_name : 'Open seat'}
                  {t.is_commish && <span className="rounded-full bg-gold/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-gold">🛡️ Commissioner</span>}
                  {mine && <span className="text-[10px] uppercase tracking-wide text-white/40">you</span>}
                </div>
              </div>
              {t.user_id && (
                <div className="flex gap-1.5">
                  {t.is_commish
                    ? commishes > 1 && <button className="btn-ghost btn-sm" disabled={busy}
                        onClick={() => confirm(mine ? 'Step down as commissioner? The others keep running the league.' : `Take ${t.gm_name}'s commissioner role away?`)
                          && run(async () => { await rpc('commish_set_cocommish', { p_team: t.id, p_on: false }); await refresh(['teams']); }, mine ? 'You stepped down' : 'Commissioner role removed')}>{mine ? 'Step down' : 'Remove role'}</button>
                    : <button className="btn-ghost btn-sm" disabled={busy}
                        onClick={() => confirm(`Make ${t.gm_name} a co-commissioner? They get every power on this page.`)
                          && run(async () => { await rpc('commish_set_cocommish', { p_team: t.id, p_on: true }); await refresh(['teams']); }, `${t.gm_name} is a co-commissioner`)}>🛡️ Co-commish</button>}
                  {!t.is_commish && !mine && (
                    <button className="btn-ghost btn-sm" disabled={busy}
                      onClick={() => confirm(`Hand ${t.name} to a new GM? ${t.gm_name} comes off the team today and loses access to it. The team keeps everything, and you get an invite link for its next GM.`)
                        && run(async () => { const code = await rpc<string>('commish_vacate_seat', { p_team: t.id }); setHanded({ team: t.name, code }); await refresh(['teams']); await share(code); }, 'Seat opened; invite link copied')}>🪑 Hand over</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {handed && (
        <div className="rounded-xl border border-sky-300/20 bg-sky-400/10 p-3 text-xs text-sky-100">
          The invite for <b>{handed.team}</b>, good for 14 days:
          <div className="mt-1 break-all font-mono text-sky-200">{link(handed.code)}</div>
          <button className="btn-ghost btn-sm mt-2" onClick={() => share(handed.code)}>Copy again</button>
        </div>
      )}
    </div>
  );
}
