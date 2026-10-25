// A club's fan pulse (25 October 2026, Patrick: "team management could see directly from the fans what they think"):
// #/fans/<club>/pulse, one page anyone can read, share, print or download. What the fans called this season (who
// starts in goal, the MVP, the one to move, the need, the window, the spring, the grades), their verdicts on the
// analysis's bigger questions, the ideas and questions they voted to the top, the fixes, the knowledge base and who
// added the most. Everything from fan_pulse (migration 337); no account behind any of it.
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer, ShieldCheck, Users } from 'lucide-react';
import {
  CLUB_CALLS, KINDS, NHL_CALLS, QUESTION_CALLS, VERDICTS, callLabel, clubName, download, fanExport, fanLink, gradeAvg, pulseCsv, shares,
  type CallSplit, type FanKind,
} from '../lib/fanVoice';
import { clubVars } from '../data/clubColors';
import { CLUB_LORE } from '../data/clubHistory';
import { NHL_TEAMS, fmtDate } from '../lib/format';
import { NhlLogo, Spinner, useToast } from '../components/ui';
import { FanVoiceProvider, useVoice } from '../components/fan/FanVoice';
import { ShareButton } from '../components/fan/FanShare';

const seasonLabel = (s: number) => `${String(s).slice(0, 4)}-${String(s).slice(6, 8)}`;
const TONE: Record<string, string> = { keep: 'rgb(52 211 153)', adjust: 'rgb(251 191 36)', rethink: 'rgb(248 113 113)' };

export default function FanPulse() {
  const { club: param } = useParams();
  const club = (param ?? 'EDM').toUpperCase();
  const ok = club === 'NHL' || !!NHL_TEAMS[club];
  if (!ok) return <div className="card p-6 text-center text-sm text-mute">There&apos;s no club {club} in the NHL. <Link to="/fans" className="text-sky-300 underline">Every club&apos;s fan zone</Link></div>;
  return (
    <div className="print-sheet" style={clubVars(club, CLUB_LORE[club]?.colors)}>
      <FanVoiceProvider club={club}><Pulse club={club} /></FanVoiceProvider>
    </div>
  );
}

function Pulse({ club }: { club: string }) {
  const v = useVoice()!;
  const toast = useToast();
  const p = v.pulse;
  const name = clubName(club);
  useEffect(() => { document.title = `${name} fan pulse · Super Pools`; }, [name]);
  if (!p) return <div className="flex justify-center py-20"><Spinner /></div>;
  const defs = club === 'NHL' ? NHL_CALLS : CLUB_CALLS;
  const calls = Object.values(p.calls).reduce((t, s) => t + s.total, 0);
  const questions = Object.entries(QUESTION_CALLS).filter(([, k]) => p.calls[k]?.total);
  const csv = () => download(`${club.toLowerCase()}-fan-pulse-${p.season}.csv`, pulseCsv(p, (t, c) => callLabel(t, c, p.calls[t]?.choices.find((x) => x.choice === c)?.name)), 'text/csv');
  const json = async () => {
    try { const x = await fanExport(club); download(`${club.toLowerCase()}-fan-zone-${p.season}.json`, JSON.stringify(x, null, 2), 'application/json'); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div className="space-y-5">
      <Link to={club === 'NHL' ? '/fans' : `/fans/${club}`} className="no-print inline-flex items-center gap-1 text-sm font-semibold text-sky-300"><ArrowLeft className="h-4 w-4" />{club === 'NHL' ? 'Every club' : `The ${name} fan zone`}</Link>
      <div className="print-plain relative overflow-hidden rounded-[28px] border p-4 sm:p-6" style={{ borderColor: 'rgb(var(--club-rgb) / .35)', background: 'radial-gradient(120% 90% at 100% 0%, rgb(var(--club-rgb) / .32), transparent 55%), linear-gradient(160deg, var(--club2), #070b16 75%)' }}>
        <div className="pointer-events-none absolute -right-6 -top-6 opacity-[.12]"><NhlLogo abbr={club} size={190} /></div>
        <div className="relative flex items-start gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/95 shadow-lg"><NhlLogo abbr={club} size={42} light /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[.2em]" style={{ color: 'var(--club)' }}>Fan pulse · {seasonLabel(p.season)}</div>
            <h1 className="font-display text-[clamp(26px,8vw,38px)] font-extrabold italic leading-[.95] text-white">{name}</h1>
            <p className="mt-1 text-sm text-slate-300">What {p.people} fan{p.people === 1 ? '' : 's'} think{p.people === 1 ? 's' : ''}, as of {fmtDate(p.at.slice(0, 10))}.</p>
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2 min-[420px]:grid-cols-4">
          {[['Fans', p.people], ['Calls', calls], ['Ideas', p.counts.idea ?? 0], ['Questions', p.counts.ask ?? 0]].map(([k, n]) => (
            <div key={k} className="print-box rounded-2xl bg-black/30 px-3 py-2 ring-1 ring-white/10">
              <div className="label">{k}</div>
              <div className="num font-display text-2xl font-extrabold text-white">{n}</div>
            </div>
          ))}
        </div>
        <div className="no-print relative mt-3 flex flex-wrap gap-2">
          <ShareButton url={fanLink(club === 'NHL' ? undefined : club, 'pulse')} title={`${name} fan pulse`} text={`What ${name} fans think: the calls, the ideas and the questions, open to everyone.`} className="btn-club btn-sm px-3!" />
          <button type="button" onClick={() => window.print()} className="btn-ghost btn-sm px-3!"><Printer className="h-3.5 w-3.5" />Print</button>
          <button type="button" onClick={csv} className="btn-ghost btn-sm px-3!"><Download className="h-3.5 w-3.5" />Spreadsheet</button>
          <button type="button" onClick={() => void json()} className="btn-ghost btn-sm px-3!"><Download className="h-3.5 w-3.5" />Open data</button>
        </div>
      </div>

      {p.people === 0 && (
        <div className="card p-5 text-center">
          <div className="text-3xl">📣</div>
          <p className="mt-1 text-sm text-slate-300">No fan has made a call or posted for {name} this season yet. The pulse fills in as they do.</p>
          <Link to={club === 'NHL' ? '/fans' : `/fans/${club}`} className="btn-club mt-3 inline-flex px-4">Be the first</Link>
        </div>
      )}

      <section className="space-y-2">
        <H title="The fans' calls" sub="Each fan's call for the season, one each, open to everyone." />
        <div className="grid gap-2 sm:grid-cols-2">
          {defs.map((d) => <CallResult key={d.key} title={d.title} topic={d.key} split={p.calls[d.key]} />)}
        </div>
      </section>

      {questions.length > 0 && (
        <section className="space-y-2">
          <H title="The bigger questions" sub="The fans' own verdict on each of the analysis's big calls: keep it, adjust it or rethink it." />
          <div className="card divide-y divide-white/[.06] p-1">
            {questions.map(([area, k]) => {
              const s = shares(p.calls[k]);
              const top = s[0];
              return (
                <div key={k} className="px-3 py-2.5">
                  <div className="flex items-baseline gap-2 text-sm"><b className="min-w-0 flex-1 text-white">{area}</b><span className="text-[11px] text-mute">{p.calls[k].total} fans</span></div>
                  <div className="print-bar mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-white/[.06]">
                    {VERDICTS.map(([c]) => { const x = s.find((y) => y.choice === c); return x ? <div key={c} style={{ width: `${x.pct * 100}%`, background: TONE[c] }} className="h-2.5 border-r-2 border-[#0e1527] last:border-r-0" /> : null; })}
                  </div>
                  <div className="mt-1 text-[12px] text-slate-300">{top ? <><b className="text-white">{Math.round(top.pct * 100)}% {callLabel(k, top.choice).toLowerCase()}</b>{s.slice(1).map((x) => ` · ${Math.round(x.pct * 100)}% ${callLabel(k, x.choice).toLowerCase()}`).join('')}</> : null}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(['idea', 'ask', 'insight', 'fix'] as FanKind[]).map((k) => <TopList key={k} kind={k} />)}
      <TopList kind="fact" title="The knowledge base" sub="The facts fans voted most useful, with the ones the editors checked marked." />

      {p.contributors.length > 0 && (
        <section className="space-y-2">
          <H title="Who added the most" sub="This season, by the votes their posts earned." />
          <div className="card divide-y divide-white/[.06] p-1">
            {p.contributors.map((c, i) => (
              <div key={`${c.author}-${i}`} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                <span className="num w-5 text-center text-xs font-bold text-mute">{i + 1}</span>
                <b className="min-w-0 flex-1 truncate text-white">{c.author}</b>
                <span className="text-[12px] text-mute">{c.posts} post{c.posts === 1 ? '' : 's'}</span>
                <span className="num w-10 text-right font-bold text-white">{c.score >= 0 ? '+' : ''}{c.score}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="px-1 text-[11px] leading-snug text-mute">From the {name} fan zone on Super Pools: each fan makes a call once and can change it; posts are voted up or down by the fans and checked by the fan zones&apos; editors when marked. Free to read, share and download. <Link to="/fans/about" className="underline">How the fan zones work</Link>. Not affiliated with the NHL or its clubs.</p>
    </div>
  );
}

function H({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-1">
      <h2 className="h-display flex items-center gap-2 text-lg text-white"><span className="h-4 w-1 rounded-full" style={{ background: 'var(--club)' }} />{title}</h2>
      {sub && <p className="text-[13px] text-mute">{sub}</p>}
    </div>
  );
}

function CallResult({ title, topic, split }: { title: string; topic: string; split: CallSplit | undefined }) {
  const s = shares(split);
  const avg = topic === 'gm' || topic === 'coach' ? gradeAvg(split) : null;
  return (
    <div className="card p-3.5">
      <div className="flex items-baseline gap-2"><b className="min-w-0 flex-1 leading-snug text-white">{title}</b><span className="flex shrink-0 items-center gap-1 text-[11px] text-mute"><Users className="h-3 w-3" />{split?.total ?? 0}</span></div>
      {avg && <p className="mt-1 text-[12px] text-slate-300">Average grade <b className="font-display text-base text-white">{avg}</b></p>}
      {s.length ? (
        <div className="mt-2 space-y-1.5">
          {s.slice(0, 5).map((c, i) => (
            <div key={c.choice}>
              <div className="flex items-baseline gap-2 text-[12px]"><span className={`min-w-0 flex-1 truncate ${i === 0 ? 'font-bold text-white' : 'text-slate-300'}`}>{callLabel(topic, c.choice, c.name)}{c.team && topic !== 'cup' ? <span className="text-mute"> · {c.team}</span> : null}</span><span className="num font-bold text-white">{Math.round(c.pct * 100)}%</span><span className="num w-8 text-right text-mute">{c.n}</span></div>
              <div className="print-bar mt-0.5 h-1.5 rounded-full bg-white/[.06]"><div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, c.pct * 100)}%`, background: i === 0 ? 'rgb(var(--club-rgb))' : 'rgb(148 163 184 / .55)' }} /></div>
            </div>
          ))}
        </div>
      ) : <p className="mt-2 text-[12px] text-mute">No calls yet.</p>}
    </div>
  );
}

function TopList({ kind, title, sub }: { kind: FanKind; title?: string; sub?: string }) {
  const v = useVoice()!;
  const list = v.pulse?.top[kind] ?? [];
  if (!list.length) return null;
  const k = KINDS.find((x) => x.key === kind)!;
  return (
    <section className="space-y-2">
      <H title={title ?? `Top ${k.label.toLowerCase()}`} sub={sub ?? `The ${k.label.toLowerCase()} fans voted highest this season.`} />
      <ol className="card divide-y divide-white/[.06] p-1">
        {list.map((x, i) => (
          <li key={x.id} className="flex gap-3 px-3 py-2.5">
            <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-black" style={{ background: 'rgb(var(--club-rgb) / .25)', color: 'var(--club)' }}>{i + 1}</span>
            <div className="min-w-0 flex-1">
              <Link to={v.club === 'NHL' ? `/fans?post=${x.id}` : `/fans/${v.club}?post=${x.id}`} className="font-semibold leading-snug text-white hover:underline [overflow-wrap:anywhere]">{x.title}</Link>
              {x.body && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-slate-300">{x.body}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-mute">
                <span>{x.author}</span>
                {x.status === 'checked' && <span className="inline-flex items-center gap-0.5 text-emerald-300"><ShieldCheck className="h-3 w-3" />{kind === 'fix' ? 'Fixed' : kind === 'ask' ? 'Answered' : kind === 'idea' ? 'Noted' : 'Checked'}</span>}
                {x.note && <span className="text-emerald-200/80">{x.note}</span>}
              </div>
            </div>
            <span className="num shrink-0 text-right text-sm font-extrabold text-white">{x.ups - x.downs >= 0 ? '+' : ''}{x.ups - x.downs}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
