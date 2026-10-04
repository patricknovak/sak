// Sends web push notifications.
//   POST {notification: id}  from the notifications trigger (with the platform's admin key): pushes that row to its
//                            team's devices
//   POST {test: true}        from a signed-in GM: sends a test push to their own devices
// Each push is titled with its league's name and opens that league's site.
// The VAPID private key comes from Supabase Vault through _vapid_private() (service role only).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const db = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const VAPID_PUBLIC = 'BEz86QWfjI0MlV7iV33KCnUSAahyR9UGXZ3O4MbbVil9vzmYXkoG6i_DhhWP8SYhjdwMcjVxCvGeU50IWMW2P20';
const SITE = 'https://patricknovak.github.io/sak/';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-league' };

// the league a team plays in, as a push names it: "SAK Superleague" from SaK's wordmark, the league's name
// otherwise; and where a tap lands: the league's own domain when it has one, SaK's site for SaK (its GMs installed it
// there), and for every other pool the one app with the pool in the link (migration 151), so the tap opens that pool
// and not whichever one the phone had open last
const APP = 'https://app.superpoolsai.com/';
async function leagueOf(teamId: number) {
  const { data: t } = await db.from('teams').select('league_id').eq('id', teamId).single();
  const { data: l } = await db.from('leagues').select('id,slug,name,domain,brand').eq('id', t?.league_id ?? 1).single();
  const w = (l?.brand as { wordmark?: { a?: string; b?: string } } | null)?.wordmark;
  const word = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
  const name = w?.a ? [w.a, w.b ? word(w.b) : ''].filter(Boolean).join(' ') : (l?.name ?? 'Super Pools');
  const site = l?.domain ? `https://${l.domain}/` : (l?.id ?? 1) === 1 || !l?.slug ? SITE : APP;
  const open = (link: string | null) => {
    const path = link && link.startsWith('/') ? link : '/';
    return site === APP ? `${APP}#/p/${l!.slug}${path === '/' ? '' : path}` : `${site}#${path}`;
  };
  return { name, site, open };
}

// the notifications trigger sends the platform's admin key; the public key alone can't replay a notification
async function adminCall(req: Request) {
  const key = req.headers.get('x-admin-key');
  if (!key) return false;
  const { data } = await db.rpc('admin_key_ok', { p_key: key });
  return data === true;
}

let ready = false;
async function init() {
  if (ready) return;
  const { data, error } = await db.rpc('_vapid_private');
  if (error || !data) throw new Error('VAPID key missing from Vault');
  webpush.setVapidDetails('mailto:commish@sakleague.app', VAPID_PUBLIC, data as string);
  ready = true;
}

const ICONS: Record<string, string> = { draft: '⏰', trade: '🔄', bet: '🎲', mention: '💬', injury: '🚑', big_night: '🔥', weekly: '🏆', health: '🩺', idea: '💡', matchup: '⚔️', watch: '⭐' };

async function sendToTeam(teamId: number, payload: Record<string, unknown>) {
  const { data: subs } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('team_id', teamId);
  let sent = 0, gone = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 600, urgency: 'high' });
      sent++;
      await db.from('push_subscriptions').update({ last_ok: new Date().toISOString() }).eq('endpoint', s.endpoint);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { gone++; await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint); }
      else console.error('push failed', code, (e as Error).message);
    }
  }));
  return { devices: subs?.length ?? 0, sent, gone };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    await init();
    const body = await req.json().catch(() => ({}));

    if (body.test) {
      // who is asking? their sign-in names their team in the league they're in (a GM can be in more than one)
      const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
      const { data: u } = await db.auth.getUser(jwt);
      if (!u?.user) return new Response(JSON.stringify({ error: 'Sign in first' }), { status: 401, headers: cors });
      const asUser = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}`, ...(req.headers.get('x-league') ? { 'x-league': req.headers.get('x-league')! } : {}) } } });
      const { data: mine } = await asUser.rpc('my_team');
      const { data: t } = mine ? await db.from('teams').select('id,gm_name').eq('id', mine).single() : { data: null };
      if (!t) return new Response(JSON.stringify({ error: 'No team' }), { status: 404, headers: cors });
      const lg = await leagueOf(t.id);
      const r = await sendToTeam(t.id, { title: `🏒 ${lg.name}`, body: `Notifications are on, ${t.gm_name}. See you on draft night.`, url: lg.site, tag: 'test' });
      return new Response(JSON.stringify(r), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const id = Number(body.notification);
    if (!id) return new Response('bad request', { status: 400, headers: cors });
    if (!(await adminCall(req))) return new Response('forbidden', { status: 403, headers: cors });
    const { data: n } = await db.from('notifications').select('id,team_id,kind,body,link').eq('id', id).single();
    if (!n) return new Response('not found', { status: 404, headers: cors });
    const lg = await leagueOf(n.team_id);
    // a line that opens with its own emoji ("⚔️ Week 2 starts today…") lends it to the title instead of showing it twice
    const lead = String(n.body ?? '').match(/^(\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*)\s+/u);
    const r = await sendToTeam(n.team_id, {
      title: `${lead?.[1] ?? ICONS[n.kind] ?? '🔔'} ${lg.name}`,
      body: lead ? String(n.body).slice(lead[0].length) : n.body,
      url: lg.open(n.link),
      tag: n.kind === 'draft' ? 'draft-clock' : `n${n.id}`,
      urgent: n.kind === 'draft',
    });
    return new Response(JSON.stringify(r), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: cors });
  }
});
