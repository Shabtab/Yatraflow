-- G4 draft. Apply by hand after review. This SQL is not applied yet.
begin;
create table if not exists public.creator_follows (
  follower uuid not null references public.profiles(id) on delete cascade,
  creator uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (follower, creator)
);
alter table public.creator_follows drop constraint if exists creator_follows_no_self;
alter table public.creator_follows add constraint creator_follows_no_self check (follower <> creator);
create index if not exists creator_follows_creator_idx on public.creator_follows(creator);
alter table public.creator_follows enable row level security;
drop policy if exists "creator follows own" on public.creator_follows;
create policy "creator follows own" on public.creator_follows
  for all to authenticated using (follower = auth.uid()) with check (follower = auth.uid());
drop policy if exists "deny disabled" on public.creator_follows;
create policy "deny disabled" on public.creator_follows
  as restrictive for all to authenticated
  using (not public.is_disabled()) with check (not public.is_disabled());
revoke all on public.creator_follows from public, anon, authenticated;
grant select, insert, delete on public.creator_follows to authenticated;

drop trigger if exists creator_follows_guard_target on public.creator_follows;
drop function if exists public.guard_creator_follow_target();
create or replace function public.guard_creator_follow_target()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform 1 from public.profiles p
    where p.id = new.creator and p.is_creator and not p.is_disabled for share;
  if not found then
    raise exception 'Follow target must be an active creator' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_creator_follow_target() from public, anon, authenticated;
create trigger creator_follows_guard_target before insert or update on public.creator_follows
  for each row execute function public.guard_creator_follow_target();

drop function if exists public.get_creator_follower_count();
drop function if exists public.get_creator_follower_count(uuid);
create or replace function public.get_creator_follower_count(p_creator uuid)
returns bigint language plpgsql security definer set search_path = public stable
as $$
begin
  if public.is_disabled() then return 0; end if;
  if not exists (select 1 from public.profiles p
    where p.id = p_creator and p.is_creator and not p.is_disabled) then return 0; end if;
  return (select count(*) from public.creator_follows f where f.creator = p_creator);
end;
$$;
revoke all on function public.get_creator_follower_count(uuid) from public, anon, authenticated;
grant execute on function public.get_creator_follower_count(uuid) to anon, authenticated;
commit;
