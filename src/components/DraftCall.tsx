// Voice and video for draft night. Two ways in: a call link the commish pasted (Google Meet, FaceTime,
// Discord, whatever the group uses) or the built-in room, which is a Jitsi Meet call embedded in the draft
// page (free, no account or app needed, works in the phone browser). Jitsi's public server asks the first
// person in to sign in with Google or GitHub so the room has a moderator; everyone after just joins.
import { useEffect, useRef, useState } from 'react';
import { Mic, PhoneOff, Video, ExternalLink } from 'lucide-react';
import { useLeague } from '../lib/store';

declare global { interface Window { JitsiMeetExternalAPI?: new (domain: string, opts: Record<string, unknown>) => { dispose: () => void; executeCommand: (c: string, ...a: unknown[]) => void } } }

export const jitsiRoom = (info: Record<string, unknown> | undefined, season: string | undefined) =>
  (typeof info?.call_room === 'string' && info.call_room) || `SaKKeeperLeagueDraft${(season ?? '').replace(/[^0-9]/g, '')}`;
export const callLink = (info: Record<string, unknown> | undefined) => (typeof info?.call_url === 'string' && info.call_url ? info.call_url : null);

let scriptLoading: Promise<void> | null = null;
const loadJitsi = () => scriptLoading ??= new Promise<void>((res, rej) => {
  if (window.JitsiMeetExternalAPI) return res();
  const s = document.createElement('script'); s.src = 'https://meet.jit.si/external_api.js'; s.async = true;
  s.onload = () => res(); s.onerror = () => { scriptLoading = null; rej(new Error('Couldn’t load the call. Open it in a new tab instead.')); };
  document.head.appendChild(s);
});

export function DraftCall({ tall }: { tall?: boolean }) {
  const { me, league } = useLeague();
  const link = callLink(league?.info);
  const room = jitsiRoom(league?.info, league?.season);
  const [joined, setJoined] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<{ dispose: () => void } | null>(null);
  const jitsiUrl = `https://meet.jit.si/${room}#userInfo.displayName="${encodeURIComponent(me?.gm_name ?? 'GM')}"&config.startWithVideoMuted=true`;

  useEffect(() => {
    if (!joined || !box.current) return;
    let dead = false;
    loadJitsi().then(() => {
      if (dead || !box.current || !window.JitsiMeetExternalAPI) return;
      api.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
        roomName: room, parentNode: box.current, width: '100%', height: '100%',
        userInfo: { displayName: me?.gm_name ?? 'GM' },
        configOverwrite: { startWithVideoMuted: true, startWithAudioMuted: false, prejoinConfig: { enabled: false }, disableDeepLinking: true, subject: 'SaK draft night', toolbarButtons: ['microphone', 'camera', 'hangup', 'tileview', 'settings', 'fullscreen', 'participants-pane'] },
        interfaceConfigOverwrite: { MOBILE_APP_PROMO: false, SHOW_JITSI_WATERMARK: false, SHOW_CHROME_EXTENSION_BANNER: false },
      });
    }).catch((e: Error) => setErr(e.message));
    return () => { dead = true; api.current?.dispose(); api.current = null; };
  }, [joined, room]); // eslint-disable-line react-hooks/exhaustive-deps

  if (link) {
    return (
      <div className="card flex items-center gap-3 p-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300"><Video size={20} /></div>
        <div className="min-w-0 flex-1 text-sm"><div className="font-semibold">Draft night call</div><div className="truncate text-xs text-mute">{link.replace(/^https?:\/\//, '')}</div></div>
        <a href={link} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm shrink-0"><Mic size={14} /> Join <ExternalLink size={11} className="opacity-60" /></a>
      </div>
    );
  }
  return (
    <div className={`card overflow-hidden ${tall && joined ? 'flex min-h-[320px] flex-1 flex-col' : ''}`}>
      {!joined ? (
        <div className="flex items-center gap-3 p-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300"><Video size={20} /></div>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold">Draft night voice & video</div>
            <div className="text-xs text-mute">Built-in room, no app needed. Camera starts off, mic on. The first one in signs in (Google or GitHub) to open the room; everyone after just joins.</div>
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <button className="btn-primary btn-sm" onClick={() => { setErr(null); setJoined(true); }}><Mic size={14} /> Join here</button>
            <a href={jitsiUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm text-xs">New tab <ExternalLink size={11} /></a>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-white/[.08] px-3 py-1.5 text-xs">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /><span className="font-semibold">On the call</span>
            <a href={jitsiUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-sky-300">Pop out</a>
            <button className="btn-ghost btn-sm text-red-300" onClick={() => setJoined(false)}><PhoneOff size={14} /> Leave</button>
          </div>
          {err ? <div className="p-3 text-sm text-red-300">{err} <a href={jitsiUrl} target="_blank" rel="noopener noreferrer" className="underline">Open in a new tab</a></div>
            : <div ref={box} className={tall ? 'min-h-0 flex-1' : 'h-[300px]'} />}
        </>
      )}
    </div>
  );
}
