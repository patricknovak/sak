// A postseason game by hand (migration 206), on the Platform page: when the feed stalls or reports a game wrong, a
// platform admin sets its score and state here, with a reason, and the series, every pool on it and the squares follow.
// The feed leaves a game set by hand alone until it is handed back.
import { useEffect, useState } from 'react';
import { Hand, RotateCcw } from 'lucide-react';
import { rpc, supabase } from '../lib/supabase';
import { Section, useAction } from './ui';

interface Club { short: string | null; name: string }
interface Game {
  id: number; competition: string; game_no: number | null; kickoff: string; state: string; home_score: number | null; away_score: number | null;
  detail: { by_hand?: { at: string; reason: string } } | null;
  home: Club | null; away: Club | null; series: { short: string | null; label: string } | null;
}
const STATES = [['final', 'Final'], ['live', 'Live'], ['postponed', 'Postponed']] as const;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const nameOf = (c: Club | null) => c?.short ?? c?.name ?? '?';

export function GameFix() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = async () => {
    const { data: comps } = await supabase.from('competitions').select('id').eq('format', 'series').eq('active', true);
    const ids = (comps ?? []).map((c: { id: string }) => c.id);
    if (!ids.length) { setGames([]); return; }
    const from = new Date(Date.now() - 3 * 864e5).toISOString(), to = new Date(Date.now() + 12 * 36e5).toISOString();
    const { data } = await supabase.from('fixtures')
      .select('id,competition,game_no,kickoff,state,home_score,away_score,detail,home:clubs!fixtures_home_club_fkey(short,name),away:clubs!fixtures_away_club_fkey(short,name),series:series!fixtures_series_id_fkey(short,label)')
      .in('competition', ids).not('series_id', 'is', null).gte('kickoff', from).lte('kickoff', to).order('kickoff', { ascending: false }).limit(30);
    setGames((data ?? []) as unknown as Game[]);
  };
  useEffect(() => { load(); }, []);
  if (!games?.length) return null;
  return (
    <Section title="Fix a game" right={<span className="text-xs text-mute">Postseason, last 3 days</span>}>
      <div className="card divide-y divide-white/[.05] p-1">
        {games.map((g) => (
          <div key={g.id} className="px-2 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-mute">
                  <span className="font-semibold text-slate-200">{g.series?.short ?? g.series?.label ?? g.competition}{g.game_no ? ` · Game ${g.game_no}` : ''}</span>
                  <span>· {when(g.kickoff)}</span>
                  {g.detail?.by_hand && <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-px font-bold text-amber-200 ring-1 ring-amber-300/30"><Hand className="h-3 w-3" />By hand</span>}
                </div>
                <div className="mt-0.5 font-semibold text-white">
                  {nameOf(g.away)} <span className="num">{g.away_score ?? '–'}</span> <span className="text-mute">at</span> {nameOf(g.home)} <span className="num">{g.home_score ?? '–'}</span>
                  <span className="ml-1.5 text-xs font-normal capitalize text-mute">{g.state}</span>
                </div>
                {g.detail?.by_hand && <div className="mt-0.5 text-[11px] text-amber-100/80">{g.detail.by_hand.reason}</div>}
              </div>
              <button type="button" className="btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={() => setOpen(open === g.id ? null : g.id)}>{open === g.id ? 'Close' : 'Fix'}</button>
            </div>
            {open === g.id && <FixForm g={g} done={async () => { setOpen(null); await load(); }} />}
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[11px] leading-snug text-mute">For when the feed stalls or gets a game wrong. The series, every pool on it and the squares follow at once; the feed leaves the game alone until you hand it back.</p>
    </Section>
  );
}

function FixForm({ g, done }: { g: Game; done: () => Promise<void> }) {
  const { busy, run } = useAction();
  const [away, setAway] = useState(String(g.away_score ?? ''));
  const [home, setHome] = useState(String(g.home_score ?? ''));
  const [state, setState] = useState<string>(g.state === 'scheduled' ? 'final' : g.state);
  const [awayLine, setAwayLine] = useState('');
  const [homeLine, setHomeLine] = useState('');
  const [reason, setReason] = useState('');
  // the score by period, typed as runs per inning ("0,1,0,2"): squares pay from it
  const line = (s: string) => s.split(/[\s,]+/).filter(Boolean).map(Number);
  const a = line(awayLine), h = line(homeLine);
  const periods = a.length || h.length ? Array.from({ length: Math.max(a.length, h.length) }, (_, i) => ({ n: i + 1, home: h[i] ?? null, away: a[i] ?? null })) : null;
  const badLine = [...a, ...h].some((x) => !Number.isInteger(x) || x < 0);
  const scored = state === 'postponed' || (home !== '' && away !== '');
  return (
    <div className="mt-2.5 space-y-2.5 rounded-2xl bg-black/25 p-3 ring-1 ring-white/10">
      <div className="grid grid-cols-2 gap-2">
        {([[nameOf(g.away), away, setAway, awayLine, setAwayLine], [nameOf(g.home), home, setHome, homeLine, setHomeLine]] as const).map(([n, v, set, ln, setLn]) => (
          <label key={n} className="block space-y-1">
            <span className="label">{n}</span>
            <input className="input num w-full text-center text-lg font-black" inputMode="numeric" value={v} onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 3))} />
            <input className="input w-full py-1.5 text-xs" placeholder="By period: 0,1,0,2" value={ln} onChange={(e) => setLn(e.target.value)} />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-black/25 p-1">
        {STATES.map(([k, l]) => <button key={k} type="button" onClick={() => setState(k)} className={`rounded-xl px-2 py-1.5 text-xs font-bold transition ${state === k ? 'bg-white text-[#0b1220]' : 'text-white/70 hover:text-white'}`}>{l}</button>)}
      </div>
      <input className="input w-full text-sm" placeholder="Why (for the record)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      {badLine && <p className="text-[11px] text-amber-200">Periods are whole numbers, separated by commas.</p>}
      <button type="button" className="btn-gold w-full" disabled={busy || !scored || badLine || reason.trim().length < 3}
        onClick={() => run(async () => {
          await rpc('platform_game_fix', { p_fixture: g.id, p_home: state === 'postponed' ? null : Number(home), p_away: state === 'postponed' ? null : Number(away), p_state: state, p_periods: periods, p_reason: reason.trim() });
          await done();
        }, 'Game set; the series follows')}>
        Set the game
      </button>
      {g.detail?.by_hand && (
        <button type="button" className="btn-ghost flex w-full items-center justify-center gap-1.5 text-sm" disabled={busy}
          onClick={() => run(async () => { await rpc('platform_game_fix', { p_fixture: g.id, p_home: null, p_away: null, p_state: null }); await done(); }, 'Handed back to the feed')}>
          <RotateCcw className="h-4 w-4" /> Hand back to the feed
        </button>
      )}
    </div>
  );
}
