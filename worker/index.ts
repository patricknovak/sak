// The Super Pools app at the edge (Cloudflare Workers Paid, 11 October 2026). The Worker serves the built site (dist/)
// as static assets, as before, and runs first only for the paths it owns:
//   /api/hub?task=…   the sports data the centres read (nhl-hub), cached at Cloudflare's edge: a room full of people on
//                     game night costs one call to the function per refresh window per location, not one each
//   /j/<code>         an invite link that unfurls in iMessage, WhatsApp and Slack with the pool's own name, colour and
//                     host, then opens the join page (#/join/<code>)
//   /p/<web name>/…   a pool's link, the same way, then the pool (#/p/<web name>/…)
//   /og/j/<code>.png, /og/p/<web name>.png   the preview pictures those pages point at
//   /api/live/<league>/<day>   the league's live room for that game night (a WebSocket; worker/live.ts)
//   /api/live/<league>/draft   the league's draft room: the pick clock and every pick, live (a WebSocket; worker/draft.ts)
//   /api/live/<league>/pool/<day>   a prediction pool's room for the day: its games and its table, live (worker/pool.ts)
// Everything else is the app, unchanged. Postgres stays the source of truth: the Worker reads only what the public key
// may (invite_preview, league_by_host) and the public sports feeds.
import { hub } from './hub';
import { live, LiveRoom } from './live';
import { draftRoom, DraftRoom } from './draft';
import { poolRoom, PoolRoom } from './pool';
import { inviteImage, invitePage, poolImage, poolPage } from './preview';
import { withSecurity } from './headers';

export interface Env {
  ASSETS: Fetcher;
  LIVE: DurableObjectNamespace<LiveRoom>;
  DRAFT: DurableObjectNamespace<DraftRoom>;
  POOL: DurableObjectNamespace<PoolRoom>;
  SUPABASE_URL: string;
  SUPABASE_ANON: string;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === '/api/hub') return withSecurity(await hub(req, env, ctx));
      if (/^\/api\/live\/\d+\/draft$/.test(p)) return withSecurity(await draftRoom(req, env));
      if (/^\/api\/live\/\d+\/pool\//.test(p)) return withSecurity(await poolRoom(req, env));
      if (p.startsWith('/api/live/')) return withSecurity(await live(req, env));
      let m = /^\/og\/j\/([a-z0-9-]{4,64})\.png$/i.exec(p);
      if (m) return withSecurity(await inviteImage(m[1], req, env, ctx));
      m = /^\/og\/p\/([a-z0-9-]{1,40})\.png$/i.exec(p);
      if (m) return withSecurity(await poolImage(m[1], req, env, ctx));
      m = /^\/j\/([a-z0-9-]{4,64})\/?$/i.exec(p);
      if (m) return withSecurity(await invitePage(m[1], url, env));
      m = /^\/p\/([a-z0-9-]{1,40})(\/.*)?$/i.exec(p);
      if (m) return withSecurity(await poolPage(m[1], m[2] ?? '', url, env));
    } catch (e) {
      console.error(p, e);
      // a link always opens something: the app itself, if the preview couldn't be made
      if (/^\/(j|p)\//.test(p)) return withSecurity(Response.redirect(`${url.origin}/#${p.replace(/^\/j\//, '/join/')}`, 302));
      return withSecurity(new Response('Something went wrong', { status: 502 }));
    }
    // static assets: public/_headers also applies; this covers any path that still hits the Worker
    return withSecurity(await env.ASSETS.fetch(req));
  },
} satisfies ExportedHandler<Env>;

export { LiveRoom, DraftRoom, PoolRoom };
