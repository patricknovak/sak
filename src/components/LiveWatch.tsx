// The pieces for watching and listening to an NHL game, shared by NHL centre and Watch live: the network names, the
// box of ways to watch (the GM's own TV provider first, then the broadcasters), team radio and the NHL's own videos.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Headphones, Tv } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { watchOptions, playerFor, PROVIDERS } from '../lib/watch';

export const LIVE = new Set(['LIVE', 'CRIT']), DONE = new Set(['OFF', 'FINAL']);
export const BRIGHTCOVE = (id: string) => `https://players.brightcove.net/6415718365001/default_default/index.html?videoId=${id}`;
export const NET: Record<string, string> = { SN: 'Sportsnet', SNP: 'Sportsnet Pacific', SNW: 'Sportsnet West', SNO: 'Sportsnet Ontario', SNE: 'Sportsnet East', SN1: 'Sportsnet One', SN360: 'Sportsnet 360', TVAS: 'TVA Sports', CBC: 'CBC', ESPN: 'ESPN', 'ESPN+': 'ESPN+', ABC: 'ABC', TNT: 'TNT', TBS: 'TBS', MAX: 'Max', HULU: 'Hulu', NHLN: 'NHL Network', PRIME: 'Prime Video', AMZN: 'Prime Video', SCRIPPS: 'Scripps' };

// NHL team radio (HLS): Safari plays it natively, everyone else through hls.js loaded on demand
// broadcaster and TV-provider sign-ins go in a plain new tab with no opener: a scripted popup can make Safari
// drop the login cookie and bounce the GM back to the sign-in page in a loop
export const openTab = (url: string) => { window.open(url, '_blank', 'noopener,noreferrer'); };

// where to watch this game: the GM's own TV provider player first (one sign-in, every channel), then the
// broadcasters' players. A GM who hasn't said what they have gets a one-tap provider picker right here.
export function WatchBox({ watch, channels }: { watch: ReturnType<typeof watchOptions>; channels: string[] }) {
  const { me, refresh } = useLeague();
  const [saving, setSaving] = useState(false);
  const player = playerFor(me?.tv?.provider);
  const setProvider = async (provider: string) => {
    setSaving(true);
    try { await rpc('set_tv', { p_tv: { ...(me?.tv ?? {}), provider } }); await refresh(['teams']); } finally { setSaving(false); }
  };
  const btn = (have: boolean) => `btn-sm inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-sm font-semibold ${have ? 'border-sky-400/50 bg-sky-500/15 text-sky-100' : 'border-white/10 bg-white/[.04] text-slate-300'}`;
  return (
    <div className="rounded-xl border border-white/[.08] bg-white/[.03] p-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-mute"><span>Watch live</span>{channels.length > 0 && <span className="normal-case tracking-normal">📺 {channels.join(' · ')}</span>}</div>
      <div className="flex flex-wrap gap-1.5">
        {player && <button className={btn(true)} onClick={() => openTab(player.url)} title={player.how}><Tv size={14} /> {player.name} <span className="text-[10px] font-normal text-sky-200/80">your {me?.tv?.provider}</span><ExternalLink size={11} className="opacity-60" /></button>}
        {watch.map((w) => (
          <button key={w.service.k} className={btn(w.have)} onClick={() => openTab(w.service.url)} title={w.service.note}>
            <Tv size={14} /> {w.service.name}{w.network !== 'NHL.TV' && w.network.toUpperCase() !== w.service.name.toUpperCase() ? <span className="text-[10px] font-normal text-mute">{w.network}</span> : null}{w.have && <span className="text-[10px]">✓</span>}<ExternalLink size={11} className="opacity-60" />
          </button>
        ))}
      </div>
      {!me?.tv?.provider ? (
        <div className="mt-2 text-[11px] text-mute">
          <div className="mb-1">Who’s your TV provider? One tap and the fastest way in goes first on every game.</div>
          <div className="scroll-x flex gap-1">{PROVIDERS.filter((p) => p !== 'Other').map((p) => <button key={p} disabled={saving} className="chip shrink-0 py-1" onClick={() => setProvider(p)}>{p}</button>)}<Link to="/profile" className="chip shrink-0 py-1">Streaming only…</Link></div>
        </div>
      ) : (
        <details className="mt-2 text-[11px] text-mute">
          <summary className="cursor-pointer text-sky-300">How to get the game on screen ({me.tv.provider})</summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            {player ? <li><b>{player.name}</b>: {player.how} It’s the channel shown above ({channels[0] ?? 'see the game page'}). Every channel in your package, one login.</li> : null}
            <li><b>Broadcaster’s player</b> ({watch.map((w) => w.service.name).join(', ')}): tap Sign in, choose “TV provider”, pick {me.tv.provider}, then the live channel. You stay signed in on that site.</li>
            <li>Each opens in its own tab so the sign-in sticks; once you’re signed in there, the next tap goes straight to live TV. <Link to="/profile" className="text-sky-300">Change provider or services</Link>.</li>
          </ol>
        </details>
      )}
    </div>
  );
}

export function RadioPlayer({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let hls: { destroy: () => void } | null = null;
    (async () => {
      if (el.canPlayType('application/vnd.apple.mpegurl')) { el.src = url; el.play().catch(() => {}); return; }
      try {
        const Hls = (await import('hls.js')).default;
        if (!Hls.isSupported()) { setErr('This browser can’t play the stream.'); return; }
        const h = new Hls(); hls = h; h.loadSource(url); h.attachMedia(el);
        h.on(Hls.Events.MANIFEST_PARSED, () => { el.play().catch(() => {}); });
        h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal?: boolean }) => { if (d.fatal) setErr('Stream unavailable right now (it usually starts near puck drop).'); });
      } catch { setErr('Could not load the player.'); }
    })();
    return () => { hls?.destroy(); el.pause(); };
  }, [url]);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm">
      <Headphones size={16} className="shrink-0 text-emerald-300" />
      <div className="min-w-0 flex-1"><div className="truncate font-semibold">{label} radio</div>{err && <div className="text-xs text-amber-200">{err}</div>}</div>
      <audio ref={ref} controls className="h-8 max-w-[45%]" />
      <button className="text-xs text-mute" onClick={onClose}>✕</button>
    </div>
  );
}

export function Video({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs"><span className="font-semibold">{title}</span><button className="text-mute" onClick={onClose}>✕</button></div>
      <div className="aspect-video w-full"><iframe title={title} src={BRIGHTCOVE(id)} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
    </div>
  );
}

