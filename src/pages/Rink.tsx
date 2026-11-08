// Rink Duel (#/rink, 7 November 2026): thumb air hockey for every hockey league and pool. Play the computer at four
// levels, or challenge another member live: a challenge pops up on their phone wherever they are in the app (or goes
// into the chat for anyone to take). The game is components/rink/RinkGame.tsx; nothing about it is stored on the
// server, and this phone remembers its own record against the computer.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3, Bot, Gamepad2, MessageCircle, Swords, Zap } from 'lucide-react';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { PageHeader, Section, TeamBadge, useToast } from '../components/ui';
import { RinkGame, type RinkMode, type RinkResult } from '../components/rink/RinkGame';
import { RinkStats } from '../components/rink/RinkStats';
import { LEVELS, type Level } from '../lib/rink/ai';
import { HEAT_AT, WIN_AT } from '../lib/rink/physics';
import { joinLobby, newMatchId, onLobby, sendLobby } from '../lib/rink/net';
import { wake } from '../lib/rink/sound';

type Record_ = Partial<Record<Level, { w: number; l: number }>>;
const REC = 'rink-record';
const BEST = 'rink-best';
const readRec = (): Record_ => { try { return JSON.parse(localStorage.getItem(REC) ?? '{}') as Record_; } catch { return {}; } };
const readBest = () => { try { return Number(localStorage.getItem(BEST) ?? 0) || 0; } catch { return 0; } };

export default function Rink() {
  const { me, league, teams, spectators, online, brand } = useLeague();
  const lid = league?.league_id ?? 1;
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [game, setGame] = useState<RinkMode | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [rec, setRec] = useState<Record_>(readRec);
  const [best, setBest] = useState(readBest);
  const [pending, setPending] = useState<{ id: string; to: number; at: number } | null>(null);
  const [posting, setPosting] = useState(false);
  // Play, or the league's standings (?t=stats); a kept game reads them again
  const [tab, setTab] = useState<'play' | 'stats'>(params.get('t') === 'stats' ? 'stats' : 'play');
  const [statsKey, setStatsKey] = useState(0);

  const members = useMemo(() => [...teams, ...spectators].filter((t) => t.id !== me?.id)
    .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.name.localeCompare(b.name)), [teams, spectators, online, me?.id]);

  // opened from an accepted challenge (?m=) or an open one in the chat (?join=)
  useEffect(() => {
    const m = params.get('m') ?? params.get('join');
    const vs = Number(params.get('vs'));
    if (m && vs && vs !== me?.id) {
      setGame({ kind: 'online', match: m, side: 1, vs });
      setGameKey((k) => k + 1);
      nav('/rink', { replace: true });
    }
  }, [params]);

  // the answer to a challenge you sent
  useEffect(() => {
    if (!me) return;
    joinLobby(lid);
    return onLobby((m) => {
      if (m.type !== 'reply' || m.to !== me.id) return;
      setPending((p) => {
        if (!p || p.id !== m.id) return p;
        const who = members.find((t) => t.id === m.from)?.name ?? 'They';
        if (m.ok) { setGame({ kind: 'online', match: p.id, side: 0, vs: p.to }); setGameKey((k) => k + 1); }
        else toast(`${who} said not now`, 'info');
        return null;
      });
    });
  }, [me?.id, lid, members]);
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => {
      setPending((p) => (p?.id === pending.id ? null : p));
      sendLobby({ type: 'cancel', id: pending.id, from: me!.id, to: pending.to });
      toast(`No answer from ${members.find((t) => t.id === pending.to)?.name ?? 'them'}. Try the chat.`, 'info');
    }, 45_000);
    return () => clearTimeout(id);
  }, [pending?.id]);

  if (!me) return null;

  const playCpu = (level: Level) => { wake(); setGame({ kind: 'cpu', level: LEVELS.find((l) => l.key === level)! }); setGameKey((k) => k + 1); };
  const challenge = (to: number) => {
    wake();
    const id = newMatchId();
    sendLobby({ type: 'invite', id, from: me.id, to });
    setPending({ id, to, at: Date.now() });
  };
  const cancel = () => { if (pending) sendLobby({ type: 'cancel', id: pending.id, from: me.id, to: pending.to }); setPending(null); };
  // an open challenge in the league's chat: the first member to tap it plays you
  const openChallenge = async () => {
    wake();
    setPosting(true);
    const id = newMatchId();
    const body = `🏒 ${me.name} is at the Rink Duel table and wants a game, first to ${WIN_AT}. First to tap plays: 👉 #/rink?join=${id}&vs=${me.id}`;
    const { error } = await supabase.from('messages').insert({ channel: 'general', team_id: me.id, body });
    setPosting(false);
    if (error) { toast('Couldn’t post to the chat. Try again.', 'err'); return; }
    setGame({ kind: 'online', match: id, side: 0, vs: null });
    setGameKey((k) => k + 1);
  };
  const done = (r: RinkResult) => {
    if (r.best > best) { setBest(r.best); try { localStorage.setItem(BEST, String(r.best)); } catch { /* fine */ } }
    if (game?.kind !== 'cpu') return;
    const k = game.level.key;
    const next = { ...rec, [k]: { w: (rec[k]?.w ?? 0) + (r.won ? 1 : 0), l: (rec[k]?.l ?? 0) + (r.won ? 0 : 1) } };
    setRec(next);
    try { localStorage.setItem(REC, JSON.stringify(next)); } catch { /* private window */ }
  };

  const waitingOn = pending ? members.find((t) => t.id === pending.to) : null;
  const onlineCount = members.filter((t) => online.has(t.id)).length;

  return (
    <div className="space-y-4">
      <PageHeader icon={<span className="text-xl">🏒</span>} title="Rink Duel" sub="Thumb air hockey. Your end, your thumb, first to 7." />

      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white/[.04] p-1 ring-1 ring-white/[.07]">
        {([['play', 'Play', Gamepad2], ['stats', 'Standings', BarChart3]] as const).map(([k, label, I]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-bold transition ${tab === k ? 'tab-on' : 'text-white/70'}`}><I size={16} />{label}</button>
        ))}
      </div>

      {tab === 'stats' ? <RinkStats teams={[...teams, ...spectators]} me={me} refresh={statsKey} /> : <>

      {/* the hero: a little table you can see the game in */}
      <div className="card relative overflow-hidden p-0">
        <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_80%_0%,rgb(var(--gold-rgb)/.22),transparent_60%),radial-gradient(70%_60%_at_0%_100%,rgba(255,59,92,.18),transparent_60%)]" />
        <div className="relative flex items-center gap-4 p-4">
          <MiniRink />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-[.18em] text-gold">How it plays</div>
            <ul className="mt-1.5 space-y-1.5 text-[13px] leading-snug text-white/85">
              <li>👍 Put your thumb on the ice. The paddle rides just above it.</li>
              <li>🥅 Hit it hard and the puck flies. Bank it off the boards.</li>
              <li>🔥 {HEAT_AT} straight exchanges and the puck catches fire: that goal counts two.</li>
            </ul>
            {best > 0 && <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/[.07] px-2.5 py-1 text-[11px] font-bold text-white/80 ring-1 ring-white/10"><Zap size={12} className="text-gold" /> Your hardest goal: {best} km/h</div>}
          </div>
        </div>
      </div>

      <Section title="Play the computer" icon={<Bot size={16} />}>
        <div className="grid gap-2 sm:grid-cols-2">
          {LEVELS.map((l, i) => {
            const r = rec[l.key];
            const beat = (r?.w ?? 0) > 0;
            return (
              <button key={l.key} onClick={() => playCpu(l.key)} className={`card group relative flex items-center gap-3 p-3 text-left transition active:scale-[.98] ${beat ? 'border-gold/40' : ''}`}>
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl ring-1 ring-white/10" style={{ background: `linear-gradient(135deg, ${['#2f7d4f', '#2b5fa8', '#7a3fb0', '#b0373f'][i]}, #0b1222)` }}>{l.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display text-lg font-extrabold uppercase leading-none">{l.name}</span>
                    <span className="text-xs text-mute">vs {l.who}</span>
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-white/70">{l.blurb}</span>
                  <span className="mt-1.5 flex items-center gap-1.5">
                    {[0, 1, 2, 3].map((d) => <span key={d} className={`h-1.5 w-5 rounded-full ${d <= i ? 'bg-gold' : 'bg-white/10'}`} />)}
                    {r && <span className="num ml-auto text-[11px] font-bold text-white/70">{r.w}–{r.l}{beat ? ' ⭐' : ''}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Challenge the league" icon={<Swords size={16} />} right={<span className="text-xs text-mute">{onlineCount ? `${onlineCount} on now` : 'Nobody else on right now'}</span>}>
        <button disabled={posting} onClick={openChallenge} className="card mb-2 flex w-full items-center gap-3 border-gold/30 p-3 text-left transition active:scale-[.98]">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-gold/40 to-white/[.04] ring-1 ring-gold/40"><MessageCircle size={20} className="text-gold" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">Throw down in the chat</span>
            <span className="block text-xs leading-snug text-white/65">Posts an open challenge. The first member to tap it plays you while you wait at the table.</span>
          </span>
        </button>
        <div className="divide-y divide-white/[.06] rounded-2xl border border-white/[.07] bg-white/[.02]">
          {members.length === 0 && <div className="p-4 text-center text-sm text-mute">Nobody else is in yet. Invite your crew, then come back for a game.</div>}
          {members.map((t) => {
            const on = online.has(t.id);
            return (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="relative">
                  <TeamBadge team={t} size={36} />
                  <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0d1528] ${on ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.9)]' : 'bg-slate-600'}`} />
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm font-semibold">{t.name}</div>
                  <div className="truncate text-xs text-mute">{t.gm_name}{on ? ' · on now' : ''}</div>
                </div>
                <button className={on ? 'btn-gold btn-sm' : 'btn-ghost btn-sm opacity-60'} disabled={!on || !!pending} onClick={() => challenge(t.id)}>
                  {on ? 'Challenge' : 'Away'}
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-mute">A challenge goes straight to their phone if they have the app open. Away? Throw down in the chat instead.</p>
      </Section>

      </>}

      {pending && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-6 backdrop-blur-sm">
          <div className="animate-slideup w-full max-w-sm rounded-[28px] border border-white/10 bg-gradient-to-b from-[#16213b] to-[#0a1222] p-5 text-center shadow-2xl">
            <div className="relative mx-auto h-16 w-16">
              <span className="absolute inset-0 animate-ping rounded-full bg-gold/30" />
              <span className="relative"><TeamBadge team={waitingOn ?? undefined} size={64} /></span>
            </div>
            <div className="mt-3 font-display text-2xl font-extrabold uppercase">Challenge sent</div>
            <p className="mt-1 text-sm text-white/70">Waiting for {waitingOn?.name ?? 'them'} to take you on…</p>
            <button className="btn-ghost mt-4" onClick={cancel}>Call it off</button>
          </div>
        </div>
      )}

      {game && (
        <RinkGame key={gameKey} me={me} mode={game} league={lid} teams={[...teams, ...spectators]} ice={brand.short ?? league?.name ?? 'Rink Duel'}
          onExit={() => setGame(null)} onResult={done} onRecorded={() => setStatsKey((k) => k + 1)} />
      )}
    </div>
  );
}

// the hero's little table: two paddles, a puck with a tail, the red line
function MiniRink() {
  return (
    <svg viewBox="0 0 100 172" className="h-36 w-[84px] shrink-0 drop-shadow-[0_10px_24px_rgba(0,0,0,.6)]" aria-hidden>
      <defs>
        <linearGradient id="rk-ice" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#eef6ff" /><stop offset="1" stopColor="#d3e6fa" /></linearGradient>
        <radialGradient id="rk-gold" cx=".35" cy=".3"><stop offset="0" stopColor="#fff" /><stop offset=".35" stopColor="var(--color-gold)" /><stop offset="1" stopColor="var(--color-gold)" /></radialGradient>
        <radialGradient id="rk-red" cx=".35" cy=".3"><stop offset="0" stopColor="#fff" /><stop offset=".35" stopColor="#ff3b5c" /><stop offset="1" stopColor="#c21d3a" /></radialGradient>
      </defs>
      <rect x="2" y="2" width="96" height="168" rx="16" fill="#1c2a46" stroke="var(--color-gold)" strokeOpacity=".7" strokeWidth="1.5" />
      <rect x="6" y="6" width="88" height="160" rx="13" fill="url(#rk-ice)" />
      <rect x="32" y="3" width="36" height="3" fill="#05080f" /><rect x="32" y="166" width="36" height="3" fill="#05080f" />
      <rect x="6" y="85" width="88" height="2" fill="#e11e3c" opacity=".7" />
      <rect x="6" y="55" width="88" height="1.6" fill="#1e6ee6" opacity=".55" /><rect x="6" y="116" width="88" height="1.6" fill="#1e6ee6" opacity=".55" />
      <circle cx="50" cy="86" r="15" fill="none" stroke="#1e6ee6" strokeOpacity=".6" strokeWidth="1.2" />
      <path d="M32 6 a18 18 0 0 0 36 0" fill="#46a0ff" fillOpacity=".22" /><path d="M32 166 a18 18 0 0 1 36 0" fill="#46a0ff" fillOpacity=".22" />
      <circle cx="47" cy="99" r="3.4" fill="#78c8ff" opacity=".25" /><circle cx="51" cy="91" r="3.8" fill="#78c8ff" opacity=".35" /><circle cx="56" cy="82" r="4.2" fill="#78c8ff" opacity=".45" />
      <circle cx="61" cy="72" r="4.6" fill="#0a0d12" stroke="#fff" strokeOpacity=".25" strokeWidth=".8" />
      <circle cx="42" cy="138" r="8.5" fill="url(#rk-gold)" /><circle cx="42" cy="138" r="3.5" fill="#fff" fillOpacity=".7" />
      <circle cx="66" cy="34" r="8.5" fill="url(#rk-red)" /><circle cx="66" cy="34" r="3.5" fill="#fff" fillOpacity=".7" />
    </svg>
  );
}
