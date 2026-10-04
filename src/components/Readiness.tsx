import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { Section } from './ui';

// A new league's checklist (league_readiness): what has to hold before the platform puts it live, and what's worth
// doing. The platform sees it on each league's card; a new league's commissioner sees it on the Commish page until
// the league is live.
export interface Check { key: string; label: string; ok: boolean; required: boolean; detail: string | null }

export function Checklist({ checks }: { checks: Check[] }) {
  return (
    <ol className="space-y-1.5">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2.5 text-sm">
          <span className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black ${c.ok ? 'bg-emerald-400 text-emerald-950' : c.required ? 'border border-amber-300/60 text-amber-200' : 'border border-white/20 text-white/40'}`}>{c.ok ? '✓' : c.required ? '!' : '·'}</span>
          <span className="min-w-0 flex-1">
            <span className={c.ok ? 'text-slate-100' : 'text-white/80'}>{c.label}</span>{!c.required && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-white/40">optional</span>}
            {c.detail && <span className="block break-words text-xs text-white/50">{c.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function CommishReadiness() {
  const { league } = useLeague();
  const [checks, setChecks] = useState<Check[] | null>(null);
  useEffect(() => {
    if (!league?.league_id) return;
    supabase.from('leagues').select('status').eq('id', league.league_id).maybeSingle().then(({ data }) => {
      if (data?.status === 'setup') rpc<Check[]>('league_readiness', { p_league: league.league_id }).then(setChecks, () => {});
    });
  }, [league?.league_id]);
  if (!checks) return null;
  const left = checks.filter((c) => c.required && !c.ok).length;
  return (
    <Section title="🚦 Getting the league ready">
      <div className="card-hero p-4">
        <p className="relative mb-3 text-sm text-white/80">{left ? `${left} thing${left === 1 ? '' : 's'} to do before Super Pools puts the league live.` : 'Everything needed is done. Super Pools puts the league live next.'}</p>
        <div className="relative"><Checklist checks={checks} /></div>
      </div>
    </Section>
  );
}
