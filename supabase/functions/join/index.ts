// join: someone new takes a seat from an invite link (Phase 2, docs/EXPANSION.md B5).
//   POST {code, email, password, name}
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const b = await req.json().catch(() => ({})) as { code?: string; email?: string; password?: string; name?: string };
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
