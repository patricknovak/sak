// join: someone new takes a seat from an invite link (Phase 2, docs/EXPANSION.md B5), or opens a pool of their own.
//   POST {code, email, password, name}
//   POST {pool: {name, color, pack}, email, password, name}   (migration 153: start a pool with no account yet)
//   POST {code, name, guest: true}                             (migration 332: a pool's seat with just a name)
//   POST {claim: {email, password}}, signed in as a guest       (the guest adds an email and keeps the seat)
//   POST {fan: {name, club, league}}                            (migrations 337 and 338: a voice in the fan zones, no seat)
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

// a guest's account sits on a placeholder address nobody reads; the site spots one by this domain and asks for an email
const GUEST_DOMAIN = 'guest.superpoolsai.com';
const isGuest = (email?: string | null) => (email ?? '').toLowerCase().endsWith(`@${GUEST_DOMAIN}`);
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (x) => x.toString(16).padStart(2, '0')).join('');

// a pool's seat with just a name (migration 332): only a prediction pool, never a fantasy league, and only so many a day
// from one connection. The account is made on a placeholder address with a long random password, both handed back once
// so the phone signs in with them and keeps the session; the seat is kept everywhere once an email is added (claim).
async function guestJoin(req: Request, code: string, name: string) {
  if (name.length < 2) return reply(400, { error: 'Tell us your name.' });
  const { data: pv, error: pe } = await db.rpc('invite_preview', { p_code: code });
  if (pe) { console.error('preview', pe); return reply(500, { error: 'Couldn’t check the invite. Try again in a minute.' }); }
  if (!pv?.ok) return reply(400, { error: WHY[pv?.reason ?? 'unknown'] ?? WHY.unknown });
  if (pv.kind !== 'predict') return reply(400, { error: 'A fantasy league needs an email to join.', needEmail: true });
  const { data: why, error: we } = await db.rpc('_guest_join_check', { p_ip: await addressHash(req) });
  if (we) { console.error('guest check', we); return reply(500, { error: 'Couldn’t join just now. Try again in a minute.' }); }
  if (why) return reply(429, { error: why, needEmail: true });

  const email = `guest-${crypto.randomUUID()}@${GUEST_DOMAIN}`;
  const password = secret();
  const { data: made, error: ue } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, guest: true } });
  if (ue || !made?.user) { console.error('create guest', ue); return reply(500, { error: 'Couldn’t save your seat. Try again in a minute.' }); }
  const { data: league, error: ae } = await db.rpc('_accept_invite', { p_user: made.user.id, p_code: code, p_name: name });
  if (ae) {
    await db.auth.admin.deleteUser(made.user.id);
    return reply(400, { error: ae.message.replace(/^.*?ERROR:\s*/, '') });
  }
  return reply(200, { ok: true, league, email, password });
}

// a fan's account with just a name (migration 337): no seat anywhere, only a voice in the fan zones (posts, votes and
// calls). Made like a guest's, on a placeholder address with a long random password handed back once for the phone to
// sign in with, five a day from one connection and a thousand a day in all (_fan_join_check, apart from the pools'
// guest seats), and kept everywhere once an email is added (claim).
async function fanJoin(req: Request, b: { fan?: { name?: string; club?: string; league?: string } }) {
  const name = String(b.fan?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  // the club the fan follows, in its league (the NHL's when none is named); the database keeps it only if it's real
  const club = /^[A-Z0-9]{2,5}$/.test(String(b.fan?.club ?? '')) ? String(b.fan!.club) : null;
  const league = /^[a-z][a-z0-9-]{1,11}$/.test(String(b.fan?.league ?? '')) ? String(b.fan!.league) : 'nhl';
  if (name.length < 2) return reply(400, { error: 'Tell us your name.' });
  const { data: why, error: we } = await db.rpc('_fan_join_check', { p_ip: await addressHash(req) });
  if (we) { console.error('fan check', we); return reply(500, { error: 'Couldn’t sign you up just now. Try again in a minute.' }); }
  if (why) return reply(429, { error: why, needEmail: true });

  const email = `fan-${crypto.randomUUID()}@${GUEST_DOMAIN}`;
  const password = secret();
  const { data: made, error: ue } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, guest: true, fan: true } });
  if (ue || !made?.user) { console.error('create fan', ue); return reply(500, { error: 'Couldn’t sign you up just now. Try again in a minute.' }); }
  const { error: fe } = await db.rpc('_fan_person', { p_user: made.user.id, p_name: name, p_club: club, p_league: league });
  if (fe) {
    await db.auth.admin.deleteUser(made.user.id);
    console.error('fan person', fe);
    return reply(500, { error: 'Couldn’t sign you up just now. Try again in a minute.' });
  }
  return reply(200, { ok: true, email, password });
}

// a guest adds an email and a password: the same account, so every seat and pick stays; only a guest's own session
// can do it, and only once (a real address is no longer a guest's)
async function claim(req: Request, b: { claim?: { email?: string; password?: string } }) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(token);
  if (!who?.user || !isGuest(who.user.email)) return reply(403, { error: 'Only a seat joined without an email can be kept this way.' });
  const email = String(b.claim?.email ?? '').trim().toLowerCase();
  const password = String(b.claim?.password ?? '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || isGuest(email)) return reply(400, { error: 'That doesn’t look like an email address.' });
  if (password.length < 6) return reply(400, { error: 'Pick a password of at least 6 characters.' });
  const { error } = await db.auth.admin.updateUserById(who.user.id, {
    email, password, email_confirm: true, user_metadata: { ...(who.user.user_metadata ?? {}), guest: false },
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) return reply(409, { error: 'That email already has an account. Use another, or sign in with it and open the invite link again.' });
    console.error('claim', error);
    return reply(500, { error: 'Couldn’t save your email. Try again in a minute.' });
  }
  return reply(200, { ok: true, email });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const b = await req.json().catch(() => ({})) as { code?: string; email?: string; password?: string; name?: string; pool?: { name?: string; color?: string; pack?: string } } & Record<string, unknown>;
  if (b.pool) return startPool(req, b);
  if (b.claim) return claim(req, b as { claim?: { email?: string; password?: string } });
  if (b.fan) return fanJoin(req, b as { fan?: { name?: string; club?: string; league?: string } });
  const code = String(b.code ?? '').trim().toLowerCase();
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');
  const name = String(b.name ?? '').trim().slice(0, 40);
  if (!/^[a-z0-9-]{6,40}$/.test(code)) return reply(400, { error: WHY.unknown });
  if (b.guest === true) return guestJoin(req, code, name);
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
