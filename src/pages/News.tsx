import { useEffect, useMemo, useState } from 'react';
import { useLeague, useNow } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { NewsItem } from '../lib/types';
import { ago, injuryBadge } from '../lib/format';
import { PlayerRow, PlayerSheet } from '../components/PlayerCard';
import { Section, TeamBadge, TeamName } from '../components/ui';

export default function News() {
  const { players, owner, teams, me } = useLeague();
  const now = useNow(60_000);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [detail, setDetail] = useState<number | null>(null);
  const [scope, setScope] = useState<'rostered' | 'all'>('rostered');

  useEffect(() => {
    supabase.from('news').select('*').order('published', { ascending: false }).limit(40).then(({ data }) => setNews((data ?? []) as NewsItem[]));
  }, []);

  const injured = useMemo(() => [...players.values()].filter((p) => p.injury_status)
    .sort((a, b) => (b.injury_date ?? '').localeCompare(a.injury_date ?? '')), [players]);
  const mine = injured.filter((p) => owner.get(p.id)?.team_id === me?.id);
  const byTeam = teams.map((t) => ({ t, list: injured.filter((p) => owner.get(p.id)?.team_id === t.id) })).filter((x) => x.list.length);
  const fa = injured.filter((p) => !owner.has(p.id) && p.proj > 60);

  const Hurt = ({ id }: { id: number }) => {
    const p = players.get(id)!;
    const b = injuryBadge(p.injury_status);
    return (
      <div className="px-3 py-2" onClick={() => setDetail(p.id)}>
        <PlayerRow p={p} right={<span className={`chip ${b?.cls}`}>{p.injury_status}</span>} />
        {p.injury_note && <p className="mt-1 line-clamp-2 pl-12 text-xs text-slate-400">{p.injury_note}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h-display text-2xl">News & Injuries</h1>
        <p className="text-sm text-mute">Injury and suspension statuses refresh hourly; headlines every two hours.</p>
      </div>

      <Section title="🩹 Your team">
        <div className="card divide-y divide-line">
          {mine.length === 0 ? <div className="p-4 text-sm text-mute">Nobody on your roster is hurt or suspended. Knock on wood.</div>
            : mine.map((p) => <Hurt key={p.id} id={p.id} />)}
        </div>
      </Section>

      <Section title="League injury report" right={
        <div className="flex gap-1">
          <button className={`tab px-2.5 py-1 text-xs ${scope === 'rostered' ? 'tab-on' : 'bg-boards'}`} onClick={() => setScope('rostered')}>SaK rosters</button>
          <button className={`tab px-2.5 py-1 text-xs ${scope === 'all' ? 'tab-on' : 'bg-boards'}`} onClick={() => setScope('all')}>Free agents</button>
        </div>}>
        {scope === 'rostered' ? (
          <div className="space-y-3">
            {byTeam.length === 0 && <div className="card p-4 text-sm text-mute">No injured players on any SaK roster.</div>}
            {byTeam.map(({ t, list }) => (
              <div key={t.id} className="card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2"><TeamBadge team={t} size={22} /><TeamName team={t} /><span className="ml-auto text-xs text-mute">{list.length}</span></div>
                <div className="divide-y divide-line">{list.map((p) => <Hurt key={p.id} id={p.id} />)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card divide-y divide-line">
            {fa.length === 0 ? <div className="p-4 text-sm text-mute">No notable injured free agents.</div> : fa.map((p) => <Hurt key={p.id} id={p.id} />)}
          </div>
        )}
      </Section>

      <Section title="📰 Headlines">
        <div className="space-y-2">
          {news.map((n) => (
            <div key={n.id} className="card overflow-hidden">
              <a href={n.url ?? '#'} target="_blank" rel="noreferrer" className="flex gap-3 p-3">
                {n.image && <img src={n.image} alt="" loading="lazy" className="h-16 w-24 shrink-0 rounded-lg object-cover" />}
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-snug">{n.headline}</div>
                  {n.description && <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">{n.description}</div>}
                  <div className="mt-1 text-[11px] text-mute">{n.published ? ago(n.published, now) : ''} · ESPN</div>
                </div>
              </a>
              {n.player_ids.length > 0 && (
                <div className="scroll-x flex gap-1.5 border-t border-line px-3 py-2">
                  {n.player_ids.map((id) => players.get(id)).filter(Boolean).map((p) => (
                    <button key={p!.id} className="chip shrink-0" onClick={() => setDetail(p!.id)}>
                      {p!.name}{owner.get(p!.id) ? ` · ${teams.find((t) => t.id === owner.get(p!.id)!.team_id)?.abbrev}` : ' · FA'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {news.length === 0 && <div className="card p-4 text-sm text-mute">No headlines yet.</div>}
        </div>
      </Section>
      <PlayerSheet id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
