// join: someone new takes a seat from an invite link (Phase 2, docs/EXPANSION.md B5), or opens a pool of their own.
//   POST {code, email, password, name}
//   POST {pool: {name, color, pack}, email, password, name}   (migration 153: start a pool with no account yet)
// Open sign-up is off, so the invite is the way in: the code has to be good, then this makes the account (email and
// password, confirmed on the invite's word) and seats it through _accept_invite in one go. If the seat can't be taken
// the new account is removed again, so a failed join leaves nothing behind. Someone who already has an account signs
// in and accepts the invite on the join page instead.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const WHY: Record<string, string> = {
  unknown: 'That invite link isn’t right. Ask the commissioner for a new one.',
  revoked: 'That invite was cancelled. Ask the commissioner for a new one.',
  expired: 'That invite has expired. Ask the commissioner for a new one.',
  used: 'That invite has already been used. Ask the commissioner for a new one.',
  taken: 'Someone has already taken that seat.',
};

// the caller's address, kept only as a hash: the database limits how many pools one address opens in a day
async function addressHash(req: Request) {
  const ip = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim();
  if (!ip) return '';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`super-pools:${ip}`));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}

// first-touch UTM/referrer from the site (optional; ignored when the SQL columns are not live yet)
function attribution(b: Record<string, unknown>) {
  const clip = (v: unknown, n: number) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, n) : null;
  };
  return {
    p_utm_source: clip(b.utm_source, 120),
    p_utm_medium: clip(b.utm_medium, 120),
    p_utm_campaign: clip(b.utm_campaign, 160),
    p_utm_content: clip(b.utm_content, 160),
    p_utm_term: clip(b.utm_term, 160),
    p_referrer: clip(b.referrer, 500),
  };
}

// someone new opens a pool: the door's limits first, then the account, then the pool with them as its host. If the pool
// can't be opened the account is removed again, so a failed start leaves nothing behind.
async function startPool(req: Request, b: { pool?: { name?: string; color?: string; pack?: string }; email?: string; password?: string; name?: string } & Record<string, unknown>) {
  const pool = String(b.pool?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const color = /^#[0-9a-f]{6}$/i.test(String(b.pool?.color ?? '')) ? String(b.pool!.color).toLowerCase() : null;
  const pack = /^[a-z0-9-]{3,60}$/.test(String(b.pool?.pack ?? '')) ? String(b.pool!.pack) : null;
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');
  const name = String(b.name ?? '').trim().slice(0, 40);
  if (pool.length < 3) return reply(400, { error: 'Give the pool a name (3 to 40 characters).' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: 'That doesn’t look like an email address.' });
  if (password.length < 6) return reply(400, { error: 'Pick a password of at least 6 characters.' });
  if (name.length < 2) return reply(400, { error: 'Tell us your name.' });

  const ip = await addressHash(req);
  const { data: why, error: we } = await db.rpc('_pool_signup_check', { p_ip: ip });
  if (we) { console.error('check', we); return reply(500, { error: 'Couldn’t start the pool. Try again in a minute.' }); }
  if (why) return reply(429, { error: why });

  const { data: made, error: ue } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (ue || !made?.user) {
    if (/already|registered|exists/i.test(ue?.message ?? '')) {
      return reply(409, { error: 'That email already has an account. Sign in with it and start the pool from My pools.', signIn: true });
    }
    console.error('create user', ue);
    return reply(500, { error: 'Couldn’t make your account. Try again in a minute.' });
  }
  const base = { p_user: made.user.id, p_name: pool, p_color: color, p_pack: pack, p_host: name, p_ip: ip };
  // try with attribution first; fall back if the migration is not live yet (safe to merge before SQL)
  let started = await db.rpc('_pool_start_new', { ...base, ...attribution(b) });
  if (started.error && /utm_|referrer|could not find|PGRST202|42883/i.test(started.error.message)) {
    started = await db.rpc('_pool_start_new', base);
  }
  if (started.error) {
    await db.auth.admin.deleteUser(made.user.id);
    return reply(400, { error: started.error.message.replace(/^.*?ERROR:\s*/, '') });
  }
  return reply(200, { ok: true, pool: started.data });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const b = await req.json().catch(() => ({})) as { code?: string; email?: string; password?: string; name?: string; pool?: { name?: string; color?: string; pack?: string } } & Record<string, unknown>;
  if (b.pool) return startPool(req, b);
  const code = String(b.code ?? '').trim().toLowerCase();
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');
  const name = String(b.name ?? '').trim().slice(0, 40);
  if (!/^[a-z0-9-]{6,40}$/.test(code)) return reply(400, { error: WHY.unknown });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: 'That doesn’t look like an email address.' });
  if (password.length < 6) return reply(400, { error: 'Pick a password of at least 6 characters.' });
  if (name.length < 2) return reply(400, { error: 'Tell us your name.' });

  const { data: pv, error: pe } = await db.rpc('invite_preview', { p_code: code });
  if (pe) { console.error('preview', pe); return reply(500, { error: 'Couldn’t check the invite. Try again in a minute.' }); }
  if (!pv?.ok) return reply(400, { error: WHY[pv?.reason ?? 'unknown'] ?? WHY.unknown });

  const { data: made, error: ue } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (ue || !made?.user) {
    if (/already|registered|exists/i.test(ue?.message ?? '')) {
      return reply(409, { error: 'That email already has an account. Sign in with it, then open the invite link again.', signIn: true });
    }
    console.error('create user', ue);
    return reply(500, { error: 'Couldn’t make your account. Try again in a minute.' });
  }
  const { data: league, error: ae } = await db.rpc('_accept_invite', { p_user: made.user.id, p_code: code, p_name: name });
  if (ae) {
    await db.auth.admin.deleteUser(made.user.id);
    return reply(400, { error: ae.message.replace(/^.*?ERROR:\s*/, '') });
  }
  return reply(200, { ok: true, league });
});
