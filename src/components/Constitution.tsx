import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { useHistory } from '../lib/history';
import { useBrand } from '../lib/brand';
import { hasFeature } from '../lib/features';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { Sheet, useAction } from './ui';

// The league's constitution on the League page. The rules that are settings (teams, roster, keepers, the draft, trades,
// pickups, money) are read straight from the settings, so they are always what the league actually runs on. Under them,
// the rules in the league's own words, which its commissioner writes and edits here (commish_set_rules).
interface RuleSection { title: string; items: string[] }

const SLOTS: [string, string][] = [['C', 'C'], ['LW', 'LW'], ['RW', 'RW'], ['D', 'D'], ['G', 'G'], ['Util', 'Util'], ['BN', 'Bench'], ['IR', 'IR']];

// a starting point for a league with no written rules yet; every word can be changed
const STARTER: RuleSection[] = [
  { title: 'How we play', items: ['Set a lineup every game day, or switch on the auto-pilot.', 'Chirp the GM, never the person.', 'Disputes go to the commissioner, whose call is final.'] },
  { title: 'Trades', items: ['Every trade has to make sense for both teams: no deals made to help a friend.', 'Every trade can be reviewed before it goes through.'] },
  { title: 'Changing the rules', items: ['Any GM can propose a rule change on the Proposals tab.', 'A change passes with a majority of GMs and starts next season.'] },
];

export function Constitution() {
  const { league, teams, me } = useLeague();
  const brand = useBrand();
  const { rules, loaded } = useHistory();
  const { busy, run } = useAction();
  const [mine, setMine] = useState<RuleSection[] | null>(null);   // the sections as just saved here
  const [edit, setEdit] = useState<RuleSection[] | null>(null);
  useEffect(() => { setMine(null); }, [league?.league_id]);
  if (!league) return null;
  const sections = mine ?? rules;
  const money = hasFeature(league, 'money');

  const roster = SLOTS.filter(([k]) => (league.roster?.[k as keyof typeof league.roster] ?? 0) > 0).map(([k, l]) => `${l} ${league.roster[k as keyof typeof league.roster]}`).join(' · ');
  const facts: [string, string, string][] = [
    ['🏒', 'Teams', `${teams.length} teams`],
    ['📋', 'Roster', roster],
    ['🔒', 'Keepers', league.keepers > 0 ? `${league.keepers} per team${league.top_scorer_rule ? '; last season’s top scorer can’t be kept' : ''}` : 'None: a fresh draft every season'],
    ['🎯', 'Draft', `${league.draft_rounds} rounds, ${league.snake ? 'snake' : 'straight'} order, ${league.pick_seconds} seconds a pick${league.draft_at ? ` · ${fmtDateTime(league.draft_at)}` : ''}`],
    ['🤝', 'Trades', `Reviewed for ${league.trade_review_hours} hours before they go through${league.trade_deadline ? ` · deadline ${fmtDateTime(league.trade_deadline)}` : ''}`],
    ['🛒', 'Pickups', `${league.max_acquisitions} free a season${money && league.extra_acq_fee ? `, then ${fmtMoney(league.extra_acq_fee)} each` : ''}`],
    ...(money ? [['💵', 'Money', `${fmtMoney(league.entry_fee)} to enter · the prize pool splits ${league.prize_split.join(' / ')}%`] as [string, string, string]] : []),
    [brand.coin.emoji, brand.coin.name, `Played at the Book and in side bets; never real money`],
  ];

  const save = () => edit && run(async () => {
    const clean = edit.map((x) => ({ title: x.title.trim(), items: x.items.map((i) => i.trim()).filter(Boolean) })).filter((x) => x.title || x.items.length);
    await rpc('commish_set_rules', { p_sections: clean });
    setMine(clean); setEdit(null);
  }, 'The rules are saved');

  const move = (i: number, d: number) => { if (!edit) return; const n = [...edit]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setEdit(n); };

  return (
    <div className="space-y-4">
      <div className="card-hero p-4">
        <div className="relative">
          <div className="label text-white/60">The rules at a glance</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {facts.map(([e, t, d]) => (
              <div key={t} className="flex items-start gap-2.5 rounded-xl bg-black/25 px-3 py-2">
                <span className="text-lg leading-6">{e}</span>
                <span className="min-w-0"><span className="block text-xs font-bold uppercase tracking-wider text-white/60">{t}</span><span className="block break-words text-sm text-white">{d}</span></span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-white/45">Straight from the league’s settings, so these are always the rules in force.</p>
        </div>
      </div>

      {loaded && (
        <div className="space-y-3">
          {sections.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {sections.map((r) => (
                <div key={r.title} className="card p-4">
                  <h3 className="h-display text-lg">{r.title}</h3>
                  <ul className="mt-2 space-y-1.5 text-sm text-slate-300">{r.items.map((i) => <li key={i} className="flex gap-2"><span className="text-gold">•</span><span>{i}</span></li>)}</ul>
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-4 text-sm text-mute">{me?.is_commish ? 'The league’s own rules go here: how you play, trades, disputes, changing the rules. Start from a few sensible ones and make them yours.' : 'The commissioner hasn’t written the league’s own rules yet. The ones that are settings are above.'}</div>
          )}
          {me?.is_commish && (
            <button className="btn-ghost w-full" onClick={() => setEdit(sections.length ? sections.map((x) => ({ ...x, items: [...x.items] })) : STARTER.map((x) => ({ ...x, items: [...x.items] })))}>
              ✏️ {sections.length ? 'Edit the league’s rules' : 'Write the league’s rules'}
            </button>
          )}
        </div>
      )}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title="The league’s rules" wide>
        {edit && (
          <div className="space-y-3">
            <p className="text-xs text-mute">One rule per line. The settings (roster, keepers, draft, trades, pickups) already show above the rules, so there is no need to repeat them here.</p>
            {edit.map((x, i) => (
              <div key={i} className="card space-y-2 p-3">
                <div className="flex gap-2">
                  <input className="input font-semibold" maxLength={60} placeholder="Section title" value={x.title} onChange={(e) => setEdit(edit.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} />
                  <button className="btn-ghost btn-sm shrink-0" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="btn-ghost btn-sm shrink-0" aria-label="Move down" disabled={i === edit.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button className="btn-ghost btn-sm shrink-0 text-red-300" aria-label="Remove section" onClick={() => setEdit(edit.filter((_, j) => j !== i))}>✕</button>
                </div>
                <textarea className="input min-h-28 text-sm" value={x.items.join('\n')} placeholder="One rule per line"
                  onChange={(e) => setEdit(edit.map((y, j) => (j === i ? { ...y, items: e.target.value.split('\n') } : y)))} />
              </div>
            ))}
            {edit.length < 20 && <button className="btn-ghost w-full" onClick={() => setEdit([...edit, { title: '', items: [] }])}>＋ Add a section</button>}
            <button className="btn-gold w-full py-3 text-base" disabled={busy} onClick={save}>Save the rules</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
