// The commissioner shapes the league's voice: a briefing he reads before every post (the league's history,
// trophies, who's who, running jokes, what to leave alone), facts handed to him by name, the file he has built
// from the chat (anything can be struck), his current voice notes, and buttons to make him learn or rewrite now.
import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { useBrand } from '../lib/brand';
import { rpc, supabase } from '../lib/supabase';
import { fmtDateTime } from '../lib/format';
import { useAction } from './ui';
import type { GarryMemory } from '../lib/types';

type State = { briefing: string | null; briefing_updated_at: string | null; persona: string | null; persona_updated_at: string | null; learned_at: string | null };

export function GarryShaper() {
  const { teams, team } = useLeague();
  const brand = useBrand();
  const { busy, run } = useAction();
  const [st, setSt] = useState<State | null>(null);
  const [brief, setBrief] = useState('');
  const [file, setFile] = useState<GarryMemory[]>([]);
  const [fact, setFact] = useState({ team: '', text: '' });
  const [showFile, setShowFile] = useState(false);
  const name = brand.bot.name;

  const load = () => {
    supabase.from('garry_state').select('briefing,briefing_updated_at,persona,persona_updated_at,learned_at').limit(1).maybeSingle()
      .then(({ data }) => { setSt((data as State) ?? null); setBrief((data as State | null)?.briefing ?? ''); });
    supabase.from('garry_memory').select('*').order('weight', { ascending: false }).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setFile((data ?? []) as GarryMemory[]));
  };
  useEffect(load, []);

  // the edge function, as the commissioner: it works out the league from the session
  const ask = (task: 'learn' | 'evolve') => run(async () => {
    const { data, error } = await supabase.functions.invoke(`garry?task=${task}`, { method: 'POST', body: {} });
    if (error) throw new Error(error.message);
    if (data && data.ok === false) throw new Error(data.error ?? `${name} didn’t answer`);
    load();
  }, task === 'learn' ? `${name} read the chat` : `${name} rewrote his voice notes`);

  const dirty = brief !== (st?.briefing ?? '');
  return (
    <div className="space-y-3">
      <div className="card space-y-2 p-3">
        <div className="text-sm font-semibold">What {name} should know</div>
        <p className="text-xs text-mute">He reads this before every post, every answer and every memory pass. The league’s history and trophies, who’s who, the traditions and running jokes, the lines he must not cross. Plain sentences, up to 4,000 characters.</p>
        <textarea className="input min-h-[160px] text-sm" value={brief} maxLength={4000} onChange={(e) => setBrief(e.target.value)} placeholder={`Example: The league started in 2013. The champion wins ${brand.trophy}; last place holds ${brand.booby}. Terry won back to back…`} />
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary btn-sm" disabled={busy || !dirty} onClick={() => run(async () => { await rpc('garry_brief', { p_text: brief }); load(); }, `${name} has been briefed`)}>Save briefing</button>
          <span className="text-[11px] text-mute">{brief.length}/4000{st?.briefing_updated_at ? ` · last saved ${fmtDateTime(st.briefing_updated_at)}` : ''}</span>
        </div>
      </div>

      <div className="card space-y-2 p-3">
        <div className="text-sm font-semibold">Tell him something</div>
        <p className="text-xs text-mute">A fact about a GM or the league that he keeps and uses when it fits. These outweigh what he picks up from the chat.</p>
        <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
          <select className="input" value={fact.team} onChange={(e) => setFact({ ...fact, team: e.target.value })}>
            <option value="">The league</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.gm_name}</option>)}
          </select>
          <input className="input" placeholder="e.g. Drafts a goalie in round one every single year" maxLength={300} value={fact.text} onChange={(e) => setFact({ ...fact, text: e.target.value })} />
          <button className="btn-ghost btn-sm" disabled={busy || fact.text.trim().length < 3} onClick={() => run(async () => { await rpc('garry_remember', { p_text: fact.text.trim(), p_team: fact.team ? Number(fact.team) : null }); setFact({ team: '', text: '' }); load(); }, 'Noted')}>Remember</button>
        </div>
      </div>

      <div className="card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold">His file on the league</div>
          <span className="text-xs text-mute">{file.length} memor{file.length === 1 ? 'y' : 'ies'}{st?.learned_at ? ` · last read the chat ${fmtDateTime(st.learned_at)}` : ''}</span>
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => ask('learn')}>Read the chat now</button>
            <button className="btn-ghost btn-sm" onClick={() => setShowFile(!showFile)}>{showFile ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        {showFile && (
          <div className="divide-y divide-white/[.05]">
            {file.length === 0 && <div className="py-2 text-sm text-mute">Nothing yet. He learns from the chat after replies and with the morning post.</div>}
            {file.map((m) => (
              <div key={m.id} className="flex items-start gap-2 py-1.5 text-sm">
                <span className="chip shrink-0">{m.weight >= 3 ? '📌' : m.kind === 'gag' ? '🔁' : m.kind === 'lesson' ? '📚' : '🧠'}</span>
                <span className="min-w-0 flex-1"><span className="text-mute">{m.team_id ? team(m.team_id)?.gm_name ?? 'someone' : 'league'} · </span>{m.content}</span>
                <button className="shrink-0 text-xs text-mute hover:text-red-300" onClick={() => run(async () => { await rpc('garry_forget', { p_id: m.id }); load(); }, 'Struck')}>Forget</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold">His voice notes this week</div>
          <span className="text-xs text-mute">{st?.persona_updated_at ? `rewritten ${fmtDateTime(st.persona_updated_at)}` : 'not written yet'}</span>
          <button className="btn-ghost btn-sm ml-auto" disabled={busy} onClick={() => ask('evolve')}>Rewrite now</button>
        </div>
        <p className="whitespace-pre-wrap text-sm text-slate-300">{st?.persona ?? `${name} writes these himself once a week from what he has picked up. Save a briefing and tap Rewrite now to start him off.`}</p>
      </div>
    </div>
  );
}
