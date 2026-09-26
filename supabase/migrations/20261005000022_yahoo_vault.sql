-- The yahoo edge function can take its Yahoo app keys from Vault (secrets 'yahoo_client_id' and
-- 'yahoo_client_secret') when the YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET env secrets aren't set.
-- Only the service role may call this.
create or replace function public._yahoo_creds() returns jsonb
language sql stable security definer set search_path = public, vault as $$
  select jsonb_object_agg(name, decrypted_secret) from vault.decrypted_secrets where name in ('yahoo_client_id', 'yahoo_client_secret')
$$;
revoke all on function public._yahoo_creds() from public, anon, authenticated;
