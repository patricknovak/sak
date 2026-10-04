import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Player } from '../lib/types';
import { ago, daysUntil, etToday, fmtDate, inDays, INJURY_LIST } from '../lib/format';

// The injury report on a player's card and page: what it is, which list he's on, when he's expected back and how many
// of his team's games that is, the latest note and the report's full write-up. All of it comes from the injury report
// nhl-sync already reads every hour (migration 152); the write-up and the games count are read only when a card opens.
export function InjuryReport({ p, big }: { p: Player; big?: boolean }) {
  const [detail, setDetail] = useState<string | null>(null);
  const [missed, setMissed] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    setDetail(null); setMissed(null); setMore(false);
    if (!p.injury_status) return;
    let on = true;
    supabase.from('league_players').select('injury_detail').eq('id', p.id).maybeSingle()
      .then(({ data }) => on && setDetail((data as { injury_detail: string | null } | null)?.injury_detail ?? null));
    // his team's games from today up to the expected return: a count only, no rows
    if (p.injury_return && p.nhl_team && p.injury_return > etToday()) {
      supabase.from('games').select('id', { count: 'exact', head: true }).gte('date', etToday()).lt('date', p.injury_return)
        .or(`home.eq.${p.nhl_team},away.eq.${p.nhl_team}`)
        .then(({ count }) => on && setMissed(count ?? null));
    }
    return () => { on = false; };
  }, [p.id, p.injury_status, p.injury_return, p.nhl_team]);
  if (!p.injury_status) return null;
  const list = p.injury_list && INJURY_LIST[p.injury_list];
  // the list says more than the status only when it is long-term or non-roster
  const listTag = list && !/^(injured reserve|out|day to day)$/i.test(list) ? list : null;
  const days = p.injury_return ? daysUntil(p.injury_return) : null;
  const susp = /susp/i.test(p.injury_status);
  return (
    <div className={`${big ? 'card' : 'mt-3 rounded-xl border'} border-red-400/30 p-3 text-sm`} style={{ background: 'linear-gradient(135deg, rgba(239,42,79,.14), rgba(15,23,41,.8) 60%)' }}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold text-red-300">{susp ? '🚫' : '🩹'} {p.injury_status}</span>
        {listTag && <span className="chip border-red-800 bg-red-900/50 text-red-200">{listTag}</span>}
        {p.injury_date && <span className="ml-auto text-xs text-mute">updated {ago(p.injury_date)}</span>}
      </div>
      {p.injury_part && <div className="mt-0.5 font-semibold text-slate-100">{p.injury_part}</div>}
      {days != null && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-mute">Expected back</div>
            <div className="font-semibold text-slate-100">{days > 0 ? fmtDate(p.injury_return!) : 'Any day now'}</div>
            <div className="text-[11px] text-mute">{inDays(days)}</div>
          </div>
          {days > 0 && <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-mute">{susp ? 'Games to serve' : 'Games he misses'}</div>
            <div className="font-semibold text-slate-100">{missed == null ? '–' : missed === 0 ? 'None scheduled' : `about ${missed}`}</div>
            <div className="text-[11px] text-mute">{p.nhl_team ?? 'his team'} games before then</div>
          </div>}
        </div>
      )}
      {p.injury_note && <p className="mt-2 text-slate-200">{p.injury_note}</p>}
      {detail && (
        <div className="mt-1.5">
          <p className={`text-slate-300 ${more ? '' : 'line-clamp-3'}`}>{detail}</p>
          {detail.length > 180 && <button type="button" className="mt-0.5 text-xs font-semibold text-sky-300 hover:underline" onClick={() => setMore(!more)}>{more ? 'Less' : 'Read more'}</button>}
        </div>
      )}
      <div className="mt-2 text-[10px] text-mute">From the league-wide injury report, checked every hour. The return date is the report’s estimate and moves as news comes in.</div>
    </div>
  );
}
