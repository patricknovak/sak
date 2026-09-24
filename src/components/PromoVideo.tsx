// The 2026-27 promo, shown on the League and Features pages. The file lives in public/ so it ships with the site.
export function PromoVideo() {
  return (
    <div className="card flex overflow-hidden">
      <video className="aspect-[9/16] w-36 shrink-0 bg-black sm:w-60" controls playsInline preload="none" poster="promo-poster.jpg" src="promo.mp4" />
      <div className="min-w-0 self-center p-3 sm:p-4">
        <div className="h-display text-xl">🎬 The 2026-27 promo</div>
        <p className="mt-1 text-[13px] text-mute sm:text-sm">Everything the league can do, in 76 seconds. Sound on. Share it with anyone who still thinks we run this on a spreadsheet.</p>
        <a className="btn-ghost btn-sm mt-3" href="promo.mp4" download="SaK-2026-27-promo.mp4">⬇️ Download</a>
      </div>
    </div>
  );
}
