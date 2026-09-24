-- Minimal stand-ins for the Supabase platform so migrations can be tested on plain Postgres.
-- Usage: createdb sak_test && psql -d sak_test -f supabase/tests/supabase-stubs.sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema extensions;
create extension pgcrypto schema extensions;
create schema auth;
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text unique,
  encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text,
  last_sign_in_at timestamptz
);
create table auth.identities (
  id uuid primary key, provider_id text, user_id uuid, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create publication supabase_realtime;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant select on auth.users to authenticated;
create schema if not exists net;
create function net.http_post(url text, body jsonb default null, params jsonb default null, headers jsonb default null,
  timeout_milliseconds int default null) returns bigint language sql as $$ select 1::bigint $$;
