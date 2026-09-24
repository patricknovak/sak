-- League Features page: GMs comment on what's been built and suggest (and upvote) what to build next.
-- Feature comments hang off a feature key from the site's catalogue ("chat", "lineup-tools", ...) or an
-- idea ("idea:12").

create table if not exists public.feature_comments (
  id bigint generated always as identity primary key,
  feature_key text not null check (length(feature_key) between 1 and 60),
  team_id int not null references public.teams(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists feature_comments_key on public.feature_comments (feature_key, id);

create table if not exists public.feature_ideas (
  id bigint generated always as identity primary key,
  team_id int not null references public.teams(id) on delete cascade,
  title text not null check (length(trim(title)) between 3 and 120),
  body text check (length(body) <= 2000),
  status text not null default 'new' check (status in ('new', 'planned', 'building', 'done', 'declined')),
  commish_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.feature_votes (
  idea_id bigint not null references public.feature_ideas(id) on delete cascade,
  team_id int not null references public.teams(id) on delete cascade,
  primary key (idea_id, team_id)
);

alter table public.feature_comments enable row level security;
alter table public.feature_ideas enable row level security;
alter table public.feature_votes enable row level security;

drop policy if exists read_all on public.feature_comments;
create policy read_all on public.feature_comments for select to authenticated using (true);
drop policy if exists post_own on public.feature_comments;
create policy post_own on public.feature_comments for insert to authenticated with check (team_id = public.my_team());
drop policy if exists delete_own on public.feature_comments;
create policy delete_own on public.feature_comments for delete to authenticated using (team_id = public.my_team() or public.is_commish());

drop policy if exists read_all on public.feature_ideas;
create policy read_all on public.feature_ideas for select to authenticated using (true);
-- new ideas always start as 'new'; only the commissioner changes status (via set_idea_status)
drop policy if exists post_own on public.feature_ideas;
create policy post_own on public.feature_ideas for insert to authenticated
  with check (team_id = public.my_team() and status = 'new' and commish_note is null);
drop policy if exists delete_own on public.feature_ideas;
create policy delete_own on public.feature_ideas for delete to authenticated using (team_id = public.my_team() or public.is_commish());

drop policy if exists read_all on public.feature_votes;
create policy read_all on public.feature_votes for select to authenticated using (true);
drop policy if exists vote_own on public.feature_votes;
create policy vote_own on public.feature_votes for insert to authenticated with check (team_id = public.my_team());
drop policy if exists unvote_own on public.feature_votes;
create policy unvote_own on public.feature_votes for delete to authenticated using (team_id = public.my_team());

revoke all on public.feature_comments, public.feature_ideas, public.feature_votes from anon;
grant select, insert, delete on public.feature_comments, public.feature_ideas, public.feature_votes to authenticated;

-- the commissioner triages ideas; the suggester hears about it
create or replace function public.set_idea_status(p_id bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i feature_ideas;
begin
  perform _commish();
  update feature_ideas set status = p_status, commish_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id
    returning * into i;
  if not found then raise exception 'No such idea'; end if;
  perform _notify(i.team_id, 'idea', format('Your idea “%s” is now %s', i.title, p_status), '/features?idea=' || i.id);
  if p_status in ('planned', 'done') then
    perform _sys('general', format('💡 %s: “%s” (suggested by %s)',
      case p_status when 'done' then 'Shipped' else 'On the list' end, i.title, _tname(i.team_id)));
  end if;
end $$;
revoke execute on function public.set_idea_status(bigint, text, text) from public, anon;
grant execute on function public.set_idea_status(bigint, text, text) to authenticated;

-- a new idea gets announced in the league chat so others can vote
create or replace function public._idea_posted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _sys('general', format('💡 %s suggested a feature: “%s”. Vote on it under More → League features.', _tname(new.team_id), new.title));
  return new;
end $$;
drop trigger if exists idea_posted on public.feature_ideas;
create trigger idea_posted after insert on public.feature_ideas for each row execute function public._idea_posted();
revoke execute on function public._idea_posted() from public, anon, authenticated;
