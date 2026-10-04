// Draft Centre: everything about the draft in one place. The draft room and board, keepers, the pick order
// with traded picks, the post-draft analysis, and (in draft season) the cheat sheet and the mock draft.
import { lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, FlaskConical, LineChart, ListOrdered, Lock, NotebookPen, Tv } from 'lucide-react';
import { useLeague } from '../lib/store';
import { PageHeader, Skeleton } from '../components/ui';

const Draft = lazy(() => import('./Draft'));
const Keepers = lazy(() => import('./Keepers'));
const DraftList = lazy(() => import('./DraftList'));
const DraftAnalysis = lazy(() => import('./DraftAnalysis'));
const CheatSheet = lazy(() => import('./CheatSheet'));
const Mock = lazy(() => import('./Mock'));

type Tab = 'room' | 'keepers' | 'order' | 'analysis' | 'sheet' | 'mock';

export default function DraftCentre() {
  const { league, draft, me, rosters } = useLeague();
  const [params, setParams] = useSearchParams();
  const phase = league?.phase;
  const draftish = phase === 'keepers' || phase === 'predraft' || phase === 'draft';
  const live = draft?.status === 'live' || draft?.status === 'paused';
  const done = draft?.status === 'done' || phase === 'season';
  const gm = me?.role !== 'spectator';
  const tabs = ([
    { k: 'room', label: live ? 'Draft room' : done ? 'Draft board' : 'Draft room', icon: <ClipboardList size={14} />, show: true },
    // a league that has kept nobody yet (a new league's first draft) has no keepers to show
    { k: 'keepers', label: 'Keepers', icon: <Lock size={14} />, show: phase === 'keepers' || rosters.some((r) => r.acquired === 'keeper') },
    { k: 'order', label: 'Order & picks', icon: <ListOrdered size={14} />, show: true },
    { k: 'analysis', label: 'Analysis', icon: <LineChart size={14} />, show: done || !draftish },
    { k: 'sheet', label: 'Cheat sheet', icon: <NotebookPen size={14} />, show: draftish && gm },
    { k: 'mock', label: 'Mock draft', icon: <FlaskConical size={14} />, show: draftish && gm },
  ] as { k: Tab; label: string; icon: React.ReactNode; show: boolean }[]).filter((t) => t.show);
  // in keeper season the centre opens on keepers; otherwise on the room / board
  const fallback: Tab = phase === 'keepers' && !live ? 'keepers' : 'room';
  const want = params.get('t') as Tab | null;
  const tab: Tab = tabs.some((t) => t.k === want) ? want! : fallback;
  const go = (k: Tab) => setParams(k === fallback ? {} : { t: k }, { replace: true });
  const sub = live ? `Live: pick #${draft?.current_overall} on the clock`
    : phase === 'keepers' ? 'Keeper season: pick who you keep, then study the order'
    : done ? `${draft?.season ?? league?.season} draft: the board, every pick and how it graded out`
    : `${league?.draft_rounds} rounds · ${league?.pick_seconds}s clock`;

  return (
    <div className="space-y-4">
      <PageHeader icon={<ClipboardList size={22} className="text-gold" />} title="Draft Centre" sub={sub}
        right={<Link to="/draft/tv" className="btn-ghost btn-sm" title="TV mode: the full board for the big screen"><Tv size={16} /><span className="hidden sm:inline">TV mode</span></Link>} />
      <div className="scroll-x flex gap-1">
        {tabs.map((t) => (
          <button key={t.k} className={`tab flex shrink-0 items-center gap-1.5 ${tab === t.k ? 'tab-on' : ''}`} onClick={() => go(t.k)}>
            {t.icon}{t.label}{t.k === 'room' && live && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}
          </button>
        ))}
      </div>
      <Suspense fallback={<div className="space-y-2"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>}>
        {tab === 'room' && <Draft />}
        {tab === 'keepers' && <Keepers embedded />}
        {tab === 'order' && <DraftList embedded />}
        {tab === 'analysis' && <DraftAnalysis embedded />}
        {tab === 'sheet' && <CheatSheet embedded />}
        {tab === 'mock' && <Mock embedded />}
      </Suspense>
    </div>
  );
}
