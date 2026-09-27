// The league's videos, shown on the League and Features pages. The files live in public/ so they ship with the site.
const VIDEOS = [
  { src: 'draft-day.mp4', poster: 'draft-day-poster.jpg', title: '🎬 Draft Day 2026-27', blurb: 'The SAK Superleague’s 13th season, in 70 seconds: the new crest, the draft room, cheat sheets, keeper grades, Garry’s Book and everything else that landed this month. Sound on.', file: 'SAK-Superleague-draft-day-2026-27.mp4' },
  { src: 'promo.mp4', poster: 'promo-poster.jpg', title: '🎬 The 2026-27 promo', blurb: 'Everything the league can do, in 76 seconds. Share it with anyone who still thinks we run this on a spreadsheet.', file: 'SaK-2026-27-promo.mp4' },
];
export function PromoVideo({ only }: { only?: 'draft' | 'promo' } = {}) {
  const list = only === 'draft' ? [VIDEOS[0]] : only === 'promo' ? [VIDEOS[1]] : VIDEOS;
  return (
    <div className={list.length > 1 ? 'grid gap-3 lg:grid-cols-2' : ''}>
      {list.map((v) => (
        <div key={v.src} className="card flex overflow-hidden">
          <video className="aspect-[9/16] w-36 shrink-0 bg-black sm:w-52" controls playsInline preload="none" poster={v.poster} src={v.src} />
          <div className="min-w-0 self-center p-3 sm:p-4">
            <div className="h-display text-xl">{v.title}</div>
            <p className="mt-1 text-[13px] text-mute sm:text-sm">{v.blurb}</p>
            <a className="btn-ghost btn-sm mt-3" href={v.src} download={v.file}>⬇️ Download</a>
          </div>
        </div>
      ))}
    </div>
  );
}
