-- Super Pools waitlist: the landing page's "notify me" form, one row per address.
--
-- The page posts straight to PostgREST with the publishable key, so the anon role may insert and nothing
-- else: no select, no update, no delete through the API. The commissioner reads the list in SQL (a Commish
-- page comes with onboarding). The address format and the field lengths are checked here, not just in the
-- form, because the form is the only thing between the internet and this table.

create table if not exists public.waitlist (
  id bigserial primary key,
  email text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' and length(email) <= 254),
  name text check (length(name) <= 80),
  -- what they run today, in their words: "12-team keeper on Yahoo, since 2011"
  league text check (length(league) <= 160),
  note text check (length(note) <= 500),
  -- the page or campaign the signup came from
  source text check (length(source) <= 120),
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;
revoke all on public.waitlist from public, anon, authenticated;
grant insert (email, name, league, note, source) on public.waitlist to anon;
grant usage on sequence public.waitlist_id_seq to anon;
drop policy if exists waitlist_signup on public.waitlist;
create policy waitlist_signup on public.waitlist for insert to anon with check (true);
