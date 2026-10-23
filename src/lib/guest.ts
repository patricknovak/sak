// A seat joined with just a name (migration 332): the account sits on a placeholder address on this domain, kept on the
// phone that joined until its member adds an email (KeepSeat). The join function owns the domain; this only reads it.
import { supabase } from './supabase';

export const GUEST_DOMAIN = 'guest.superpoolsai.com';
export const isGuestEmail = (email?: string | null) => (email ?? '').toLowerCase().endsWith(`@${GUEST_DOMAIN}`);

// signing a guest out loses the seat on this phone for good, so it asks first
export async function signOut() {
  const { data } = await supabase.auth.getSession();
  if (isGuestEmail(data.session?.user?.email) && !window.confirm('You joined without an email, so signing out loses your place for good. Add an email on the pool’s home first to keep it. Sign out anyway?')) return;
  await supabase.auth.signOut();
}
