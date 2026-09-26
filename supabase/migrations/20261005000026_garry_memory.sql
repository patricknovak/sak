-- Garry remembers. Facts and running gags he learns from the chat (extracted by Grok after his replies and
-- with the morning post), a lesson or two about the league, and his own evolving voice notes. Memories
-- feed every post he writes; GMs can see (and delete) what he has on them.
create table if not exists public.garry_memory (
  id bigserial primary key,
  kind text not null check (kind in ('fact', 'gag', 'lesson')),   -- fact about a GM · running gag · something about the league
  team_id int references public.teams(id) on delete cascade,      -- null = about the league as a whole
  content text not null check (length(content) between 3 and 300),
  source_msg bigint references public.messages(id) on delete set null,
  weight int not null default 1,
  created_at timestamptz not null default now(),
  last_used timestamptz
);
create index if not exists garry_memory_team on public.garry_memory (team_id, created_at desc);
create table if not exists public.garry_state (
  id int primary key default 1 check (id = 1),
  last_learned_msg bigint not null default 0,
  learned_at timestamptz,
  persona text,                 -- Garry's current voice notes: mood, gags, who he's picking on, catchphrases
  persona_updated_at timestamptz
);
insert into public.garry_state (id) values (1) on conflict do nothing;
alter table public.garry_memory enable row level security;
alter table public.garry_state enable row level security;
revoke all on public.garry_memory, public.garry_state from anon, authenticated;
grant select on public.garry_memory, public.garry_state to authenticated;
grant all on public.garry_memory, public.garry_state to service_role;
drop policy if exists read_all on public.garry_memory;
create policy read_all on public.garry_memory for select to authenticated using (true);
drop policy if exists read_all on public.garry_state;
create policy read_all on public.garry_state for select to authenticated using (true);

-- a GM can make Garry forget something about them; the commish can delete anything
create or replace function public.garry_forget(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare m garry_memory;
begin
  select * into m from garry_memory where id = p_id;
  if m.id is null then return; end if;
  if m.team_id is distinct from _team() and not is_commish() then raise exception 'That one isn''t about you'; end if;
  delete from garry_memory where id = p_id;
end $$;
revoke execute on function public.garry_forget(bigint) from public, anon;
grant execute on function public.garry_forget(bigint) to authenticated;
