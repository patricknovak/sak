import { useLeague } from '../lib/store';
import { STATUS_LABEL } from '../../supabase/functions/_shared/gameday';
import type { PlayerStatus } from '../lib/types';

// will he play? a compact chip for lineups and player lists, and a full box for the player card
const CHIP: Record<PlayerStatus['status'], { short: string; cls: string }> = {
  confirmed: { short: '✓ Starting', cls: 'border-emerald-700 bg-emerald-900/50 text-emerald-200' },
  expected: { short: 'Prob. start', cls: 'border-sky-700 bg-sky-900/40 text-sky-200' },
  backup: { short: 'Backup', cls: 'border-amber-700 bg-amber-900/40 text-amber-200' },
  gtd: { short: 'GTD', cls: 'border-amber-700 bg-amber-900/40 text-amber-200' },
  out: { short: 'Out tonight', cls: 'border-red-800 bg-red-900/50 text-red-300' },
  scratched: { short: 'Scratched', cls: 'border-red-800 bg-red-900/50 text-red-300' },
};

export function GameStatusChip({ id, date }: { id: number; date?: string }) {
  const { gameStatus } = useLeague();
  const s = gameStatus(id, date);
  if (!s) return null;
  const c = CHIP[s.status];
  return <span className={`chip shrink-0 ${c.cls}`} title={`${STATUS_LABEL[s.status]}${s.opponent ? ` ${s.opponent}` : ''}${s.note ? `: ${s.note}` : ''}`}>{c.short}</span>;
}

export function NewsDot({ id, onClick }: { id: number; onClick?: () => void }) {
  const { freshNews } = useLeague();
  const n = freshNews.get(id);
  if (!n) return null;
  return (
    <button type="button" aria-label="Recent news" title={`${n} news update${n > 1 ? 's' : ''} in the last 48 hours`}
      onClick={(e) => { if (onClick) { e.stopPropagation(); onClick(); } }}
      className="relative shrink-0 text-[11px] leading-none">📰<span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-sky-400" /></button>
  );
}

// the card version: status, opponent, the note, and when it was last checked
export function GameStatusBox({ id }: { id: number }) {
  const { gameStatus } = useLeague();
  const today = gameStatus(id);
  const rows = [today].filter(Boolean) as PlayerStatus[];
  if (!rows.length) return null;
  return (
    <>
      {rows.map((s) => {
        const c = CHIP[s.status];
        return (
          <div key={s.date} className={`mt-3 rounded-xl border p-3 text-sm ${c.cls}`}>
            <div className="font-semibold">📋 Tonight: {STATUS_LABEL[s.status]}{s.opponent ? ` ${s.opponent}` : ''}</div>
            {s.note && <p className="mt-0.5 text-slate-200">{s.note}</p>}
            <div className="mt-1 text-[11px] opacity-70">Checked {new Date(s.updated_at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })} · starting goalies from ESPN, updated every 15 minutes</div>
          </div>
        );
      })}
    </>
  );
}
