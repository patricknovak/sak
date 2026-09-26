// The NHL page's News, Leaders and Teams tabs.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { hub, type ClubGoalie, type ClubPerson, type ClubSkater, type Leaders, type NewsStory } from '../lib/nhlhub';
import { ago, fmtPts, fmtTime, NHL_COLORS, NHL_TEAMS } from '../lib/format';
import { Section, Sheet, TeamBadge } from './ui';
import { ExternalLink, Flame } from 'lucide-react';

const LOGO = (ab: string) => `https://assets.nhle.com/logos/nhl/svg/${ab}_light.svg`;
const SKATER_CATS: [string, string][] = [['points', 'Points'], ['goals', 'Goals'], ['assists', 'Assists'], ['plusMinus', '+/-'], ['goalsPp', 'PP goals'], ['goalsSh', 'SH goals'], ['penaltyMins', 'PIM'], ['faceoffLeaders', 'Faceoff %']];
const GOALIE_CATS: [string, string][] = [['wins', 'Wins'], ['savePctg', 'Save %'], ['goalsAgainstAverage', 'GAA'], ['shutouts', 'Shutouts']];

function useOwner() {
  const { owner, team, players } = useLeague();
  const Owner = ({ id }: { id: number }) => { const o = owner.get(id); const t = o ? team(o.team_id) : undefined; return t ? <span title={`${t.gm_name}'s player`} className="ml-1 inline-flex align-middle"><TeamBadge team={t} size={13} /></span> : null; };
  const Name = ({ id, name, className = '' }: { id: number; name: string; className?: string }) => players.has(id) ? <Link to={`/player/${id}`} className={`hover:underline ${className}`}>{name}</Link> : <span className={className}>{name}</span>;
  return { Owner, Name };
}

// ── News
export function NewsTab() {
  const { players, owner, me, team } = useLeague();
  const now = useNow(60_000);
  const [items, setItems] = useState<NewsStory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine' | 'trades' | 'NHL.com' | 'Sportsnet' | 'ESPN'>('all');
  useEffect(() => { hub<{ items: NewsStory[] }>('news').then((r) => setItems(r.items), (e) => setErr(e.message)); }, []);
  // which league players a story mentions (full names only, so "Miller" alone doesn't tag six guys)
  const names = useMemo(() => [...players.values()].filter((p) => p.name.length > 6).map((p) => ({ id: p.id, n: p.name.toLowerCase() })), [players]);
  const mentions = (s: NewsStory) => { const t = `${s.headline} ${s.summary}`.toLowerCase(); return names.filter((x) => t.includes(x.n)).map((x) => x.id); };
  const list = useMemo(() => (items ?? []).map((s) => ({ s, ids: mentions(s) })).filter(({ s, ids }) =>
    filter === 'all' ? true : filter === 'mine' ? ids.some((id) => owner.get(id)?.team_id === me?.id) : filter === 'trades' ? /trade|acquire|sign|waiv|recall|assign|extension|claim/i.test(s.headline) || s.tags.includes('trade') : s.source === filter), [items, filter, names, owner, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const chip = (on: boolean) => `shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${on ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`;
  return (
    <div className="space-y-3">
      <div className="scroll-x flex items-center gap-1">
        {([['all', 'All'], ['mine', '⭐ My players'], ['trades', '🔄 Moves & signings'], ['NHL.com', 'NHL.com'], ['Sportsnet', 'Sportsnet'], ['ESPN', 'ESPN']] as const).map(([k, l]) => <button key={k} className={chip(filter === k)} onClick={() => setFilter(k)}>{l}</button>)}
        <Link to="/news" className="ml-auto shrink-0 text-xs text-sky-300">Injury report ›</Link>
      </div>
      {err && <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">News didn’t load: {err}</div>}
      {!items && !err && <div className="p-6 text-center text-sm text-mute">Loading…</div>}
      {items && list.length === 0 && <div className="card p-6 text-center text-sm text-mute">Nothing in this filter right now.</div>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {list.map(({ s, ids }) => (
          <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="card flex flex-col overflow-hidden transition active:scale-[.99]">
            {s.image && <img src={s.image} alt="" className="aspect-video w-full object-cover" loading="lazy" />}
            <div className="flex flex-1 flex-col gap-1 p-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-mute"><span className={`font-bold ${s.source === 'NHL.com' ? 'text-slate-200' : s.source === 'Sportsnet' ? 'text-sky-300' : 'text-red-300'}`}>{s.source}</span><span>{ago(s.date, now)}</span></div>
              <div className="font-semibold leading-snug">{s.headline}</div>
              {s.summary && <div className="line-clamp-3 text-xs text-slate-400">{s.summary}</div>}
              {ids.length > 0 && (
                <div className="mt-auto flex flex-wrap gap-1 pt-1">
                  {ids.slice(0, 4).map((id) => { const p = players.get(id)!; const o = owner.get(id); return <span key={id} className="flex items-center gap-1 rounded-full bg-white/[.06] px-2 py-0.5 text-[11px]">{p.last_name ?? p.name}{o && <TeamBadge team={team(o.team_id)} size={12} />}</span>; })}
                </div>
              )}
            </div>
          </a>
        ))}
      </div>
      <p className="px-1 text-[11px] text-mute">Headlines from NHL.com, Sportsnet and ESPN, refreshed every ten minutes. Badges mark the SaK GM who owns a player mentioned. <ExternalLink size={10} className="inline" /> opens the story on the source’s site.</p>
    </div>
  );
}

// ── Leaders
export function LeadersTab() {
  const { players, windows, owner, team, league } = useLeague();
  const { Owner, Name } = useOwner();
  const [data, setData] = useState<Leaders | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState('points');
  const [gcat, setGcat] = useState('wins');
  useEffect(() => { hub<Leaders>('leaders').then(setData, (e) => setErr(e.message)); }, []);
  // hottest players in the SaK pool over the last 7 days, from our own scoring
  const hot = useMemo(() => [...windows.entries()].map(([id, w]) => ({ p: players.get(id), w: w['7'] })).filter((x) => x.p && x.w && x.w.gp >= 2)
    .sort((a, b) => b.w!.fpts / b.w!.gp - a.w!.fpts / a.w!.gp).slice(0, 10), [windows, players]);
  const fmtVal = (k: string, v: number) => (k === 'savePctg' ? v.toFixed(3).replace(/^0/, '') : k === 'goalsAgainstAverage' ? v.toFixed(2) : k === 'faceoffLeaders' ? `${(v * 100).toFixed(1)}%` : k === 'plusMinus' && v > 0 ? `+${v}` : String(v));
  const chip = (on: boolean) => `shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${on ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`;
  const List = ({ rows, k }: { rows: { id: number; name: string; pos: string; team: string; headshot: string | null; value: number }[]; k: string }) => (
    <div className="card divide-y divide-white/[.05]">
      {rows.map((r, i) => (
        <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
          <span className="num w-5 text-right text-xs text-mute">{i + 1}</span>
          {r.headshot ? <img src={r.headshot} alt="" className="h-8 w-8 rounded-full object-cover" style={{ background: NHL_COLORS[r.team] ?? '#334' }} loading="lazy" /> : <span className="h-8 w-8 rounded-full bg-white/10" />}
          <div className="min-w-0 flex-1 truncate"><Name id={r.id} name={r.name} className="font-semibold" /><Owner id={r.id} /> <span className="text-xs text-mute">{r.pos} · {r.team}</span></div>
          <span className="num font-bold">{fmtVal(k, r.value)}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      {err && <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">Leaders didn’t load: {err}</div>}
      {league?.phase === 'season' && hot.length > 0 && (
        <Section icon={<Flame size={16} className="text-goal" />} title="Hottest in the SaK pool · last 7 days">
          <div className="card divide-y divide-white/[.05]">
            {hot.map(({ p, w }, i) => (
              <div key={p!.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="num w-5 text-right text-xs text-mute">{i + 1}</span>
                <div className="min-w-0 flex-1 truncate"><Link to={`/player/${p!.id}`} className="font-semibold hover:underline">{p!.name}</Link><Owner id={p!.id} /> <span className="text-xs text-mute">{p!.pos} · {p!.nhl_team}{!owner.has(p!.id) && ' · free agent'}</span></div>
                <span className="num text-xs text-mute">{w!.gp} GP</span><span className="num w-14 text-right font-bold">{fmtPts(w!.fpts / w!.gp, 2)}<span className="text-[10px] font-normal text-mute">/g</span></span>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title="Skaters" right={<span className="text-xs text-mute">NHL leaders{data ? '' : ' · loading…'}</span>}>
        <div className="scroll-x mb-2 flex gap-1">{SKATER_CATS.map(([k, l]) => <button key={k} className={chip(cat === k)} onClick={() => setCat(k)}>{l}</button>)}</div>
        {data?.skaters[cat] && <List rows={data.skaters[cat]} k={cat} />}
      </Section>
      <Section title="Goalies">
        <div className="scroll-x mb-2 flex gap-1">{GOALIE_CATS.map(([k, l]) => <button key={k} className={chip(gcat === k)} onClick={() => setGcat(k)}>{l}</button>)}</div>
        {data?.goalies[gcat] && <List rows={data.goalies[gcat]} k={gcat} />}
      </Section>
      <p className="px-1 text-[11px] text-mute">Every stat for every player, sortable by any timeframe, is on the <Link to="/players" className="text-sky-300">Players page</Link>. Badges mark SaK owners; names link to player pages. {team(0) ? '' : ''}</p>
    </div>
  );
}

// ── Teams
type Club = { abbrev: string; roster: { forwards: ClubPerson[]; defense: ClubPerson[]; goalies: ClubPerson[] }; stats: { season: string; type: number; skaters: ClubSkater[]; goalies: ClubGoalie[] } | null; week: { games: { id: number; date: string; state: string; start: string; home: { abbrev: string; score: number | null }; away: { abbrev: string; score: number | null }; tv: { network: string }[] }[] } | null };
export function TeamsTab({ onGame }: { onGame: (g: any) => void }) {
  const { teams, players, owner, team } = useLeague();
  const { Owner, Name } = useOwner();
  const [open, setOpen] = useState<string | null>(null);
  const [club, setClub] = useState<Club | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setClub(null); setErr(null); if (open) hub<Club>('team', { abbrev: open }).then(setClub, (e) => setErr(e.message)); }, [open]);
  const sakCount = (ab: string) => [...players.values()].filter((p) => p.nhl_team === ab && owner.has(p.id)).length;
  const age = (born: string) => Math.floor((Date.now() - new Date(born).getTime()) / (365.25 * 86400000));
  const ht = (n: number) => `${Math.floor(n / 12)}'${n % 12}"`;
  const Person = ({ p }: { p: ClubPerson }) => (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
      {p.headshot ? <img src={p.headshot} alt="" className="h-8 w-8 rounded-full object-cover" style={{ background: NHL_COLORS[open ?? ''] ?? '#334' }} loading="lazy" /> : <span className="h-8 w-8 rounded-full bg-white/10" />}
      <span className="num w-6 text-xs text-mute">{p.num}</span>
      <div className="min-w-0 flex-1 truncate"><Name id={p.id} name={p.name} className="font-semibold" /><Owner id={p.id} /> <span className="text-xs text-mute">{p.pos} · {p.shoots}</span></div>
      <span className="hidden text-xs text-mute sm:block">{ht(p.ht)} · {p.wt} lb · {age(p.born)} · {p.country}</span>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        {Object.keys(NHL_TEAMS).sort().map((ab) => {
          const favs = teams.filter((t) => t.fav_nhl === ab);
          const n = sakCount(ab);
          return (
            <button key={ab} onClick={() => setOpen(ab)} className="card flex flex-col items-center gap-1 p-2 transition active:scale-[.97]">
              <img src={LOGO(ab)} alt="" className="h-10 w-10" loading="lazy" />
              <span className="text-xs font-bold">{ab}</span>
              <span className="flex items-center gap-1 text-[10px] text-mute">{n} SaK{favs.map((t) => <TeamBadge key={t.id} team={t} size={11} />)}</span>
            </button>
          );
        })}
      </div>
      <p className="px-1 text-[11px] text-mute">Tap a club for its roster, this week’s games and every player’s season stats. “SaK” counts the club’s players on league rosters; badges are GMs’ favourite teams.</p>

      <Sheet open={!!open} onClose={() => setOpen(null)} wide title={open ? <span className="flex items-center gap-2"><img src={LOGO(open)} alt="" className="h-7 w-7" />{NHL_TEAMS[open]} <span className="text-xs font-normal text-mute">{open}</span></span> : ''}>
        {err && <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">{err}</div>}
        {!club && !err && <div className="p-6 text-center text-sm text-mute">Loading…</div>}
        {club && (
          <div className="space-y-4">
            {club.week && (
              <Section title="This week">
                <div className="card divide-y divide-white/[.05]">
                  {club.week.games.map((g) => (
                    <button key={g.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[.03]" onClick={() => onGame(g)}>
                      <span className="num w-20 shrink-0 text-xs text-mute">{new Date(g.date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
                      <span className="font-semibold">{g.away.abbrev === open ? `@ ${g.home.abbrev}` : `vs ${g.away.abbrev}`}</span>
                      <span className="ml-auto text-xs text-mute">{['OFF', 'FINAL'].includes(g.state) ? `Final ${g.away.score}-${g.home.score}` : ['LIVE', 'CRIT'].includes(g.state) ? `Live ${g.away.score}-${g.home.score}` : fmtTime(g.start)}{g.tv?.length ? ` · ${g.tv.map((t) => t.network).slice(0, 2).join(', ')}` : ''}</span>
                    </button>
                  ))}
                  {club.week.games.length === 0 && <div className="p-3 text-sm text-mute">No games this week.</div>}
                </div>
              </Section>
            )}
            <Section title={`Roster (${club.roster.forwards.length + club.roster.defense.length + club.roster.goalies.length})`} right={<span className="text-xs text-mute">{[...club.roster.forwards, ...club.roster.defense, ...club.roster.goalies].filter((p) => owner.has(p.id)).length} on SaK rosters</span>}>
              {([['Forwards', club.roster.forwards], ['Defense', club.roster.defense], ['Goalies', club.roster.goalies]] as const).map(([label, list]) => (
                <div key={label} className="mb-2">
                  <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wider text-mute">{label}</div>
                  <div className="card divide-y divide-white/[.05]">{[...list].sort((a, b) => a.num - b.num).map((p) => <Person key={p.id} p={p} />)}</div>
                </div>
              ))}
            </Section>
            {club.stats && (
              <Section title={`Season stats · ${club.stats.season.slice(0, 4)}-${club.stats.season.slice(6)}${club.stats.type === 1 ? ' preseason' : club.stats.type === 3 ? ' playoffs' : ''}`}>
                <div className="card overflow-x-auto">
                  <table className="w-full min-w-[560px] text-xs">
                    <thead className="text-mute"><tr>{['Skater', 'GP', 'G', 'A', 'P', '+/-', 'PIM', 'PPG', 'SOG', 'S%', 'TOI'].map((h, i) => <th key={h} className={`px-2 py-1.5 font-semibold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-white/[.05]">
                      {club.stats.skaters.map((p) => (
                        <tr key={p.id}><td className="whitespace-nowrap px-2 py-1"><span className="text-mute">{p.pos}</span> <Name id={p.id} name={p.name} /><Owner id={p.id} /></td>
                          {[p.gp, p.g, p.a, p.pts, p.pm > 0 ? `+${p.pm}` : p.pm, p.pim, p.ppg, p.sog, (p.pct * 100).toFixed(1), p.toi].map((v, k) => <td key={k} className="num px-2 py-1 text-right">{v}</td>)}</tr>
                      ))}
                    </tbody>
                    <thead className="text-mute"><tr>{['Goalie', 'GP', 'GS', 'W', 'L', 'OTL', 'GAA', 'SV%', 'SO', '', ''].map((h, i) => <th key={i} className={`px-2 py-1.5 font-semibold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-white/[.05]">
                      {club.stats.goalies.map((p) => (
                        <tr key={p.id}><td className="whitespace-nowrap px-2 py-1"><span className="text-mute">G</span> <Name id={p.id} name={p.name} /><Owner id={p.id} /></td>
                          {[p.gp, p.gs, p.w, p.l, p.otl, p.gaa?.toFixed(2), p.svp?.toFixed(3).replace(/^0/, ''), p.so, '', ''].map((v, k) => <td key={k} className="num px-2 py-1 text-right">{v}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
            <div className="text-center text-xs text-mute">{team(0) ? '' : ''}<a href={`https://www.nhl.com/${NHL_TEAMS[open ?? ''].toLowerCase().replace(/[^a-z]/g, '')}`} target="_blank" rel="noreferrer" className="text-sky-300">Team site on NHL.com <ExternalLink size={10} className="inline" /></a></div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
