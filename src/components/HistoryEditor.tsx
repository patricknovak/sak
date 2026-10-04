import { useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { historyChanged, useHistory } from '../lib/history';
import { useBrand } from '../lib/brand';
import { Sheet, useAction } from './ui';
import { parsePastedTable } from '../lib/historyPaste';

// The commissioner writes the league's past seasons in (commish_set_season): a league that played for years somewhere
// else brings its champions, final tables and last places, and the History tab fills in from them. A season starts from
// today's teams in today's order; places are the row order, moved with the arrows.
interface Row { team_name: string; gm_name: string; team_id: number | null; points: string; prize: string; last_place: boolean }

const pastSeasons = (current: string, n = 25) => {
  const y = Number(current.slice(0, 4)) || new Date().getFullYear();
  return Array.from({ length: n }, (_, i) => { const a = y - 1 - i; return `${a}-${String((a + 1) % 100).padStart(2, '0')}`; });
};

export function HistoryEditor() {
  const { me, league, teams } = useLeague();
  const brand = useBrand();
  const { seasons } = useHistory();
  const { busy, run } = useAction();
  const [season, setSeason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [paste, setPaste] = useState<string | null>(null);
  const options = useMemo(() => pastSeasons(league?.season ?? ''), [league?.season]);
  if (!me?.is_commish || !league) return null;
  const have = new Set(seasons.filter((s) => s.rows.length).map((s) => s.season));

  const open = (s: string) => {
    const old = seasons.find((x) => x.season === s);
    setSeason(s); setNote(old?.note ?? ''); setPaste(null);
    setRows(old?.rows.length
      ? old.rows.map((r) => ({ team_name: r.team, gm_name: r.gm, team_id: r.teamId ?? null, points: r.points ? String(r.points) : '', prize: r.prize ? String(r.prize) : '', last_place: !!r.peter }))
      : teams.map((t) => ({ team_name: t.name, gm_name: t.gm_name === 'Open seat' ? '' : t.gm_name, team_id: t.id, points: '', prize: '', last_place: false })));
  };
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : patch.last_place ? { ...r, last_place: false } : r)));
  const move = (i: number, d: number) => { const n = [...rows]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setRows(n); };

  const save = () => run(async () => {
    await rpc('commish_set_season', { p_season: season, p_note: note || null, p_rows: rows.filter((r) => r.team_name.trim() || r.gm_name.trim()).map((r) => ({
      team_name: r.team_name, gm_name: r.gm_name, team_id: r.team_id, points: r.points.trim() || null, prize: r.prize.trim() || null, last_place: r.last_place })) });
    historyChanged(league.league_id); setSeason(null);
  }, `${season} is in the league’s history`);
  const remove = () => season && confirm(`Take ${season} out of the league’s history?`) && run(async () => {
    await rpc('commish_delete_season', { p_season: season }); historyChanged(league.league_id); setSeason(null);
  }, `${season} removed`);

  return (
    <>
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[.06] text-xl">📜</span>
        <div className="min-w-0 flex-1 basis-48 text-sm">
          <div className="font-semibold text-slate-100">The league’s past</div>
          <div className="text-xs text-mute">Played before {league.season}? Write in each season’s final table and the banners, titles and last places fill in.</div>
        </div>
        <select className="input w-auto shrink-0 py-2 text-sm" value="" onChange={(e) => e.target.value && open(e.target.value)} aria-label="Pick a season to write in">
          <option value="">✏️ A past season…</option>
          {options.map((s) => <option key={s} value={s}>{s}{have.has(s) ? ' ✓' : ''}</option>)}
        </select>
      </div>

      <Sheet open={!!season} onClose={() => setSeason(null)} title={`${season ?? ''} final table`} wide>
        <div className="space-y-3">
          <p className="text-xs text-mute">Top to bottom is first to last; move teams with the arrows. Points and prize money are optional. Tick the team that finished last ({brand.booby}).</p>
          {paste == null ? (
            <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[.03] p-3 text-left transition hover:bg-white/[.06]" onClick={() => setPaste('')}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[.06] text-lg">📋</span>
              <span className="min-w-0 text-sm"><span className="block font-semibold text-slate-100">Paste the final table</span><span className="block text-xs text-mute">Copy it from Yahoo, ESPN, Fantrax, CBS or a spreadsheet, one team a line, and the rows fill in.</span></span>
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border border-white/10 bg-black/25 p-3">
              <textarea className="input min-h-32 w-full font-mono text-xs" autoFocus placeholder={'1\tIce Holes\tCraig\t1,234.5\n2\tSin Bin\tTodd\t1,198.0'} value={paste} onChange={(e) => setPaste(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" className="btn-primary flex-1" disabled={!paste.trim()} onClick={() => {
                  const got = parsePastedTable(paste);
                  if (!got.length) return alert('No teams found in that. One team a line, first place first.');
                  // a team or GM by today's name keeps its link to the team, so its titles count on its page
                  const norm = (x: string) => x.trim().toLowerCase();
                  setRows(got.map((g) => {
                    const t = teams.find((x) => norm(x.name) === norm(g.team_name) || (g.gm_name && norm(x.gm_name) === norm(g.gm_name)));
                    return { team_name: g.team_name, gm_name: g.gm_name || (t && t.gm_name !== 'Open seat' ? t.gm_name : ''), team_id: t?.id ?? null, points: g.points, prize: '', last_place: false };
                  }).map((r, i, all) => (i === all.length - 1 ? { ...r, last_place: true } : r)));
                  setPaste(null);
                }}>Read {paste.trim() ? parsePastedTable(paste).length : 0} teams</button>
                <button type="button" className="btn-ghost" onClick={() => setPaste(null)}>Cancel</button>
              </div>
              <p className="text-[11px] text-mute">Places, W-L-T records, headers and money columns are left out; the team, its GM and its points come through. The last line is ticked last place; check it below.</p>
            </div>
          )}
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={i} className={`rounded-xl border p-2 ${i === 0 ? 'border-gold/40 bg-gold/[.06]' : 'border-white/10 bg-white/[.03]'}`}>
                <div className="flex items-center gap-2">
                  <span className="num w-7 shrink-0 text-center font-display text-xl font-extrabold text-white/80">{i === 0 ? '🏆' : i + 1}</span>
                  <input className="input min-w-0 flex-1 py-1.5 text-sm font-semibold" placeholder="Team" maxLength={60} value={r.team_name} onChange={(e) => set(i, { team_name: e.target.value })} />
                  <button type="button" className="btn-ghost btn-sm shrink-0" aria-label="Up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="btn-ghost btn-sm shrink-0" aria-label="Down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-9">
                  <input className="input min-w-0 flex-1 basis-28 py-1.5 text-sm" placeholder="GM" maxLength={40} value={r.gm_name} onChange={(e) => set(i, { gm_name: e.target.value })} />
                  <input className="input w-24 py-1.5 text-sm" placeholder="Points" inputMode="decimal" value={r.points} onChange={(e) => set(i, { points: e.target.value.replace(/[^\d.]/g, '') })} />
                  <input className="input w-20 py-1.5 text-sm" placeholder="Prize $" inputMode="decimal" value={r.prize} onChange={(e) => set(i, { prize: e.target.value.replace(/[^\d.]/g, '') })} />
                  <label className="flex items-center gap-1 text-xs text-mute"><input type="checkbox" className="h-4 w-4 accent-sky-400" checked={r.last_place} onChange={(e) => set(i, { last_place: e.target.checked })} />Last</label>
                  <button type="button" className="ml-auto text-xs text-red-300/80" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
                </div>
              </div>
            ))}
          </div>
          {rows.length < 30 && <button className="btn-ghost w-full" onClick={() => setRows([...rows, { team_name: '', gm_name: '', team_id: null, points: '', prize: '', last_place: false }])}>＋ Add a team</button>}
          <label className="block"><span className="label">A line about the season (optional)</span>
            <input className="input mt-1" maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Won it on the last night of the season." /></label>
          <button className="btn-gold w-full py-3 text-base" disabled={busy || rows.filter((r) => r.team_name.trim()).length < 2} onClick={save}>Save {season}</button>
          {season && have.has(season) && <button className="w-full text-center text-sm text-red-300/80 underline" onClick={remove}>Take {season} out</button>}
        </div>
      </Sheet>
    </>
  );
}
