// Sends web push notifications.
//   POST {notification: id}  from the notifications trigger: pushes that row to its team's devices
//   POST {test: true}        from a signed-in GM: sends a test push to their own devices
// The VAPID private key comes from Supabase Vault through _vapid_private() (service role only).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const db = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const VAPID_PUBLIC = 'BEz86QWfjI0MlV7iV33KCnUSAahyR9UGXZ3O4MbbVil9vzmYXkoG6i_DhhWP8SYhjdwMcjVxCvGeU50IWMW2P20';
const SITE = 'https://patricknovak.github.io/sak/';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

let ready = false;
async function init() {
  if (ready) return;
  const { data, error } = await db.rpc('_vapid_private');
  if (error || !data) throw new Error('VAPID key missing from Vault');
  webpush.setVapidDetails('mailto:commish@sakleague.app', VAPID_PUBLIC, data as string);
  ready = true;
}

const ICONS: Record<string, string> = { draft: '⏰', trade: '🔄', bet: '🎲', mention: '💬', injury: '🚑', big_night: '🔥', weekly: '🏆', health: '🩺', idea: '💡' };

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
      // who is asking? use their JWT to find their team
      const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
      const { data: u } = await db.auth.getUser(jwt);
      if (!u?.user) return new Response(JSON.stringify({ error: 'Sign in first' }), { status: 401, headers: cors });
      const { data: t } = await db.from('teams').select('id,gm_name').eq('user_id', u.user.id).single();
      if (!t) return new Response(JSON.stringify({ error: 'No team' }), { status: 404, headers: cors });
      const r = await sendToTeam(t.id, { title: '🏒 SaK League', body: `Notifications are on, ${t.gm_name}. See you on draft night.`, url: SITE, tag: 'test' });
      return new Response(JSON.stringify(r), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const id = Number(body.notification);
    if (!id) return new Response('bad request', { status: 400, headers: cors });
    const { data: n } = await db.from('notifications').select('id,team_id,kind,body,link').eq('id', id).single();
    if (!n) return new Response('not found', { status: 404, headers: cors });
    const r = await sendToTeam(n.team_id, {
      title: `${ICONS[n.kind] ?? '🔔'} SaK League`,
      body: n.body,
      url: SITE + '#' + (n.link ?? '/'),
      tag: n.kind === 'draft' ? 'draft-clock' : `n${n.id}`,
      urgent: n.kind === 'draft',
    });
    return new Response(JSON.stringify(r), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: cors });
  }
});
