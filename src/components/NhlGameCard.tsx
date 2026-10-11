// An NHL game as a card (NHL centre's scores, with what Watch live used to show, 11 October 2026): the score and the
// clock (the league's, lib/nhlGame), the channels where the GM watches from and whether they can watch it on what they
// have, how many of their players are in it with their points tonight, the other GMs' starters, and one tap to watch,
// to listen or to see the recap. The card opens the game sheet (GameSheet) for everything else.
import { ExternalLink, Headphones, MessageCircle, Play, Tv } from 'lucide-react';
import { useLeague } from '../lib/store';
import { fmtPts } from '../lib/format';
import { countryOf, type Verdict } from '../lib/watch';
import { DONE, LIVE, status, type HubGame } from '../lib/nhlGame';
import { GameFeeds, NET, goesStraight, openTab } from './LiveWatch';
import { TeamBadge } from './ui';
import { useGameSheet } from './GameSheet';
import type { Player } from '../lib/types';

export const TONE: Record<Verdict['state'], string> = {
  yes: 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/40', free: 'bg-sky-400/15 text-sky-200 ring-sky-400/40',
  maybe: 'bg-amber-400/15 text-amber-200 ring-amber-400/40', no: 'bg-white/[.05] text-slate-300 ring-white/15', none: 'bg-white/[.04] text-mute ring-white/10',
};
export const MARK: Record<Verdict['state'], string> = { yes: '✓', free: '★', maybe: '~', no: '🔒', none: '·' };

// can I watch it: Sportsnet+ straight to the game for a viewer who has it, else the verdict on what they have
export function VerdictPill({ g, v }: { g: Pick<HubGame, 'sn'>; v: Verdict }) {
  const { me } = useLeague();
  const sn = goesStraight(g.sn, me?.tv, v.best?.name);
  const k = sn ? 'yes' : v.state;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${TONE[k]}`}><span>{MARK[k]}</span>{sn ? `${g.sn![0].label} on Sportsnet+` : v.line}</span>;
}

// a game's stake for the league: the GM's own players in it (starters first) and each other GM's starters
export type Stake = { mine: { p: Player; start: boolean }[]; starters: number; others: [number, number][]; league: number };

export function NhlGameCard({ g, v, stake, fp, talk, hero }: { g: HubGame; v: Verdict; stake: Stake; fp: Map<number, number>; talk?: number; hero?: boolean }) {
  const { me, team } = useLeague();
  const sheet = useGameSheet();
  const live = LIVE.has(g.state), done = DONE.has(g.state);
  const myPts = stake.mine.reduce((k, x) => k + (fp.get(x.p.id) ?? 0), 0);
  const nets = [...new Set(g.tv.filter((t) => t.country === countryOf(me?.tv)).map((t) => NET[t.network] ?? t.network))];
  const shown = nets.length ? nets : [...new Set(g.tv.map((t) => NET[t.network] ?? t.network))].slice(0, 2);
  const sn = goesStraight(g.sn, me?.tv, v.best?.name);
  const open = () => sheet.open(g.id, { hint: g });
  return (
    <div className={`${hero ? 'card-hero' : 'card'} overflow-hidden transition ${live ? 'border-goal/40 shadow-[0_0_0_1px_rgba(239,42,79,.25)]' : ''}`}>
      <div className="relative">
        <button type="button" onClick={open} className="block w-full p-3 text-left active:scale-[.995]">
          <div className="mb-2 flex items-center gap-2 text-[11px]">
            <span className={`shrink-0 font-bold uppercase tracking-wider ${live ? 'text-goal' : 'text-mute'}`}>{live && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-goal align-middle" />}{status(g)}{g.type === 1 ? ' · preseason' : g.type === 3 ? ' · playoffs' : ''}</span>
            {shown.length > 0 && <span className="min-w-0 flex-1 truncate text-right text-mute">📺 {shown.join(' · ')}</span>}
          </div>
          {[g.away, g.home].map((t, i) => {
            const other = i === 0 ? g.home : g.away;
            const win = done && t.score != null && other.score != null && t.score > other.score;
            return (
              <div key={t.abbrev} className={`flex items-center gap-2 py-1 ${done && !win ? 'opacity-60' : ''}`}>
                {t.logo ? <img src={t.logo} alt="" className={hero ? 'h-9 w-9' : 'h-7 w-7'} /> : <span className="h-7 w-7" />}
                <span className={`min-w-0 flex-1 font-semibold leading-tight ${hero ? 'text-base' : 'text-sm'}`}>{t.place ? `${t.place} ${t.name}` : t.name} <span className="text-xs font-normal text-mute">{t.abbrev}{t.record && !done && !live ? ` · ${t.record}` : ''}</span></span>
                {t.sog != null && (live || done) && <span className="num w-12 text-right text-[11px] text-mute">{t.sog} SOG</span>}
                <span className={`num w-8 text-right font-display font-extrabold ${hero ? 'text-3xl' : 'text-2xl'} ${win ? 'text-white' : ''}`}>{t.score ?? ''}</span>
              </div>
            );
          })}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {!done && g.tv.length > 0 && <VerdictPill g={g} v={v} />}
            {stake.mine.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-semibold text-gold ring-1 ring-gold/40">{stake.starters} of yours{stake.mine.length > stake.starters ? ` (+${stake.mine.length - stake.starters} benched)` : ''}{(live || done) && ` · ${fmtPts(myPts)} pts`}</span>}
            {stake.others.slice(0, 4).map(([t, n]) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-white/[.05] py-0.5 pl-0.5 pr-2 text-[10px] text-slate-300 ring-1 ring-white/10"><TeamBadge team={team(t)} size={16} />{n}</span>)}
            {stake.others.length > 4 && <span className="text-[10px] text-mute">+{stake.others.length - 4}</span>}
            {!!talk && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-bold text-sky-200 ring-1 ring-sky-400/30"><MessageCircle size={11} /> {talk}</span>}
          </div>
        </button>

        {/* the quick ways in, without opening the game */}
        {(!done && (sn || v.best || g.home.radio || g.away.radio)) || (done && (g.recap || g.condensed)) ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[.06] px-3 py-2">
            {!done && sn && <GameFeeds feeds={g.sn!} title={live ? 'Watch live' : 'Watch the game'} />}
            {!done && v.best && !sn && <button type="button" onClick={() => openTab(v.best!.url)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${v.state === 'yes' || v.state === 'free' ? 'btn-gold' : 'bg-white/[.06] text-white ring-1 ring-white/15'}`}><Tv className="h-3.5 w-3.5" /> {v.best.name === 'Out-of-market' ? (v.state === 'no' ? 'Get out-of-market' : 'Watch out-of-market') : v.state === 'no' ? `Get ${v.best.name}` : `Watch on ${v.best.name}`} <ExternalLink className="h-3 w-3 opacity-70" /></button>}
            {!done && [g.away, g.home].filter((t) => t.radio).map((t) => {
              const on = sheet.radio?.url === t.radio;
              return <button key={t.abbrev} type="button" onClick={() => sheet.setRadio(on ? null : { url: t.radio!, label: t.abbrev })} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${on ? 'bg-emerald-400/20 text-emerald-100 ring-emerald-400/50' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}><Headphones className="h-3.5 w-3.5" /> {t.abbrev}</button>;
            })}
            {done && (g.recap || g.condensed) && <button type="button" onClick={open} className="inline-flex items-center gap-1 rounded-full bg-white/[.06] px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15"><Play className="h-3.5 w-3.5" /> {g.recap ? 'Recap' : 'Condensed game'}</button>}
            <button type="button" onClick={open} className="ml-auto text-[11px] font-semibold text-sky-300">Game ›</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
