import { useSearchParams } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { ChatPanel } from '../components/ChatPanel';
import { useUnread } from '../components/Layout';
import { TeamBadge } from '../components/ui';

export default function Chat() {
  const { me, teams, online } = useLeague();
  const [params, setParams] = useSearchParams();
  const channel = params.get('c') ?? 'general';
  const { unread } = useUnread();
  const dm = (id: number) => `dm:${Math.min(id, me!.id)}-${Math.max(id, me!.id)}`;
  const channels = [
    { c: 'general', label: '🔥 Trash Talk' },
    { c: 'draft', label: '📋 Draft' },
    ...teams.filter((t) => t.id !== me?.id).map((t) => ({ c: dm(t.id), label: t.gm_name, team: t })),
  ];
  const cur = channels.find((x) => x.c === channel);

  return (
    <div className="-mx-3 -my-3 flex h-[calc(100dvh-8.25rem-env(safe-area-inset-bottom)-env(safe-area-inset-top)-var(--banner,0px))] flex-col sm:-mx-5 lg:m-0 lg:h-[calc(100dvh-3rem-var(--banner,0px))] lg:flex-row lg:gap-3">
      <div className="scroll-x flex shrink-0 gap-1.5 border-b border-white/[.07] px-2 py-2 lg:card lg:w-56 lg:flex-col lg:overflow-y-auto lg:p-2">
        {channels.map((x) => (
          <button key={x.c} onClick={() => setParams({ c: x.c })}
            className={`relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition lg:rounded-xl ${channel === x.c ? 'bg-white text-ice shadow-[0_6px_18px_-8px_rgba(255,255,255,.6)]' : 'border border-white/[.07] bg-white/[.05] text-slate-300'}`}>
            {'team' in x && x.team && <TeamBadge team={x.team} size={18} />}
            {x.label}
            {'team' in x && x.team && online.has(x.team.id) && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
            {unread(x.c) && channel !== x.c && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-goal" />}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:card lg:overflow-hidden">
        <div className="hidden border-b border-line px-4 py-2 text-sm font-semibold lg:block">{cur?.label}{channel.startsWith('dm:') && <span className="ml-2 text-xs font-normal text-mute">private</span>}</div>
        <ChatPanel key={channel} channel={channel} className="flex-1" />
      </div>
    </div>
  );
}
