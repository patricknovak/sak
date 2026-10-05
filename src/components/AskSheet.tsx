import { useMemo, useState } from 'react';
import { CircleHelp, Hash, ListOrdered, Repeat, Users } from 'lucide-react';
import { rpc } from '../lib/supabase';
import type { PoolDrop } from '../lib/pool';
import { Sheet, useAction } from './ui';

// The host's "Ask the pool" sheet: a question from a starting shape (yes or no, who, how many), or the same question
// once for each name on a list (every couple, every finalist) in one go, with its close set in a tap: the next coin
// drop, a day, a week. Each question goes through pool_create, so the chat and the members' alerts hear about it as
// before (a burst of new questions folds into one alert).

type Shape = 'yesno' | 'who' | 'many' | 'each';
const SHAPES: { key: Shape; label: string; icon: typeof CircleHelp; title: string; answers: string; rule: string }[] = [
  { key: 'yesno', label: 'Yes or no', icon: CircleHelp, title: 'Does it happen before the finale?', answers: 'Yes\nNo', rule: 'Yes if it happens on screen before the finale, as aired.' },
  { key: 'who', label: 'Who', icon: Users, title: 'Who is first to go home?', answers: '', rule: 'The first one to leave, as aired. Anyone not named counts as Anyone else.' },
  { key: 'many', label: 'How many', icon: Hash, title: 'How many say yes this week?', answers: 'None\nOne\nTwo\nThree or more', rule: 'The number shown in this week’s episodes, as aired.' },
  { key: 'each', label: 'One for each', icon: Repeat, title: 'Will {name} make it to the end?', answers: 'Yes\nNo', rule: 'Yes for {name} if it happens on screen, as aired.' },
];

const pad = (n: number) => String(n).padStart(2, '0');
// a time as the datetime-local input wants it, in the phone's own time zone
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const shortWhen = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function AskSheet({ open, onClose, drops, onAsked }: { open: boolean; onClose: () => void; drops: PoolDrop[]; onAsked: () => void }) {
  const { busy, run } = useAction();
  const [shape, setShape] = useState<Shape>('yesno');
  const [f, setF] = useState({ title: '', answers: 'Yes\nNo', rule: '', category: '', closes: '', names: '' });
  const now = Date.now();
  const nextDrop = drops.find((d) => new Date(d.at).getTime() > now + 10 * 60e3);
  const pick = (k: Shape) => {
    const s = SHAPES.find((x) => x.key === k)!;
    setShape(k);
    setF((v) => ({ ...v, answers: s.answers, title: '', rule: '' }));
  };
  const cur = SHAPES.find((x) => x.key === shape)!;
  const answers = f.answers.split('\n').map((s) => s.trim()).filter(Boolean);
  const names = f.names.split('\n').map((s) => s.trim()).filter(Boolean);
  const pattern = f.title || cur.title;
  const rulePattern = f.rule || (shape === 'each' ? cur.rule : '');
  // the questions this will ask: one, or one for each name
  const asks = useMemo(() => (shape === 'each'
    ? names.map((n) => ({ title: pattern.replaceAll('{name}', n), rule: rulePattern.replaceAll('{name}', n) }))
    : [{ title: f.title, rule: f.rule }]), [shape, names.join('|'), pattern, rulePattern, f.title, f.rule]); // eslint-disable-line react-hooks/exhaustive-deps
  const closes = f.closes ? new Date(f.closes) : null;
  const problem = !closes ? 'Pick when it closes'
    : closes.getTime() <= now ? 'Close it in the future'
    : answers.length < 2 || answers.length > 12 ? 'Two to twelve answers'
    : new Set(answers.map((a) => a.toLowerCase())).size < answers.length ? 'Two answers say the same thing'
    : shape === 'each' && !pattern.includes('{name}') ? 'Put {name} in the question where each name goes'
    : shape === 'each' && names.length < 1 ? 'Add the names, one a line'
    : asks.some((a) => a.title.trim().length < 3) ? 'Write the question' : null;
  const ask = () => run(async () => {
    for (const a of asks) {
      await rpc('pool_create', { p: { title: a.title.trim(), rule: a.rule.trim(), category: f.category.trim() || null, outcomes: answers, closes_at: closes!.toISOString() } });
    }
    setF({ title: '', answers: cur.answers, rule: '', category: f.category, closes: f.closes, names: '' });
    onClose(); onAsked();
  }, asks.length === 1 ? 'Question asked' : `${asks.length} questions asked`);
  const quick = [
    ...(nextDrop ? [{ label: `At the next drop`, sub: shortWhen(new Date(nextDrop.at)), at: new Date(nextDrop.at) }] : []),
    { label: 'In a day', sub: shortWhen(new Date(now + 864e5)), at: new Date(now + 864e5) },
    { label: 'In a week', sub: shortWhen(new Date(now + 7 * 864e5)), at: new Date(now + 7 * 864e5) },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Ask the pool">
      <div className="space-y-4">
        <div>
          <span className="label">Start from</span>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {SHAPES.map((s) => (
              <button key={s.key} type="button" onClick={() => pick(s.key)}
                className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm font-semibold transition ${shape === s.key ? 'border-gold/60 bg-gold/15 text-white' : 'border-white/10 bg-white/[.03] text-slate-200 hover:bg-white/[.06]'}`}>
                <s.icon className={`h-4 w-4 shrink-0 ${shape === s.key ? 'text-gold' : 'text-mute'}`} /> {s.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block"><span className="label">{shape === 'each' ? 'The question, with {name} where each name goes' : 'The question, the way you’d ask the group chat'}</span>
          <input className="input mt-1 w-full" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={cur.title} maxLength={160} /></label>

        {shape === 'each' && (
          <label className="block"><span className="label">The names, one a line (a couple, a contestant, a team)</span>
            <textarea className="input mt-1 w-full" rows={4} value={f.names} onChange={(e) => setF({ ...f, names: e.target.value })} placeholder={'Kara & Tucker\nMia & Jordan\nAva & Leo'} /></label>
        )}

        <label className="block"><span className="label">Answers, one a line (2 to 12)</span>
          <textarea className="input mt-1 w-full" rows={shape === 'who' ? 5 : 3} value={f.answers} onChange={(e) => setF({ ...f, answers: e.target.value })}
            placeholder={shape === 'who' ? 'One name a line\nAnyone else' : 'Yes\nNo'} /></label>

        <label className="block"><span className="label">How it settles (locked once anyone calls it)</span>
          <textarea className="input mt-1 w-full" rows={2} value={f.rule} onChange={(e) => setF({ ...f, rule: e.target.value })} placeholder={cur.rule} /></label>

        <div>
          <span className="label">Closes</span>
          <div className="mt-2 grid gap-2">
            {quick.map((q) => {
              const on = f.closes === toInput(q.at);
              return (
                <button key={q.label} type="button" onClick={() => setF({ ...f, closes: toInput(q.at) })}
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left text-sm transition ${on ? 'border-gold/60 bg-gold/15' : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
                  <span className="font-semibold text-white">{q.label}</span><span className="text-xs text-mute">{q.sub}</span>
                </button>
              );
            })}
            <input className="input w-full" type="datetime-local" value={f.closes} onChange={(e) => setF({ ...f, closes: e.target.value })} aria-label="Or pick a time" />
          </div>
        </div>

        <label className="block"><span className="label">Group (optional)</span>
          <input className="input mt-1 w-full" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Drop 2 · Oct 21" maxLength={40} /></label>

        {shape === 'each' && names.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-mute"><ListOrdered className="h-3.5 w-3.5" /> {names.length} question{names.length === 1 ? '' : 's'}</div>
            <ul className="space-y-1 text-sm text-slate-200">
              {asks.slice(0, 4).map((a, i) => <li key={i} className="break-words">{a.title}</li>)}
              {asks.length > 4 && <li className="text-mute">and {asks.length - 4} more</li>}
            </ul>
          </div>
        )}

        <button type="button" className="btn-gold w-full py-3" disabled={busy || !!problem} onClick={ask}>
          {busy ? 'Asking…' : problem ?? (asks.length > 1 ? `Ask all ${asks.length}` : 'Ask it')}
        </button>
        <p className="text-xs text-mute">Close it before the episode that answers it drops. The pool hears about it in the chat.</p>
      </div>
    </Sheet>
  );
}
