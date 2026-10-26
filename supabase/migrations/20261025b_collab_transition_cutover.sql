-- Tighten direct workflow status writes after the transition-aware client is
-- deployed.
--
-- Preconditions (verified below, this file fails clearly when unmet):
--   1. The Stage A collab cutover (guard triggers on suggestions/decisions)
--      is already applied. This file replaces that guard function in place
--      and re-attaches its own triggers, so it never depends silently on the
--      earlier file having run.
--   2. Old clients are DRAINED. From the moment this file applies, any direct
--      authenticated write to the frozen transition columns receives 42501.
--      Old clients that still write status directly will fail every such
--      write — there is no grace period, no flag, and no automatic
--      activation. Deploy only after no active client performs direct status
--      writes.
begin;

do $$
begin
  if to_regclass('public.suggestions') is null or to_regclass('public.decisions') is null
    or not exists(select 1 from pg_trigger
      where tgname='suggestions_guard_contributions'
        and tgrelid='public.suggestions'::regclass and not tgisinternal)
    or not exists(select 1 from pg_trigger
      where tgname='decisions_guard_contributions'
        and tgrelid='public.decisions'::regclass and not tgisinternal) then
    raise exception 'Stage A collab cutover guard triggers are missing; apply the Stage A cutover before this file' using errcode='55000';
  end if;
end;
$$;

create or replace function public.guard_collab_contribution_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Trusted security-definer RPCs own these changes. Direct authenticated
  -- updates remain editor-scoped but cannot split a transition across writes.
  if current_user in ('postgres','service_role') then return new; end if;
  if tg_table_name='suggestions' and (
    (to_jsonb(new)->>'id') is distinct from (to_jsonb(old)->>'id')
    or (to_jsonb(new)->>'trip_id') is distinct from (to_jsonb(old)->>'trip_id')
    or (to_jsonb(new)->>'proposed_by') is distinct from (to_jsonb(old)->>'proposed_by')
    or to_jsonb(new)->'day_id' is distinct from to_jsonb(old)->'day_id'
    or to_jsonb(new)->'place' is distinct from to_jsonb(old)->'place'
    or to_jsonb(new)->'votes' is distinct from to_jsonb(old)->'votes'
    or to_jsonb(new)->'comments' is distinct from to_jsonb(old)->'comments'
    or to_jsonb(new)->'status' is distinct from to_jsonb(old)->'status'
    or to_jsonb(new)->'accepted_stop_id' is distinct from to_jsonb(old)->'accepted_stop_id'
  ) then raise exception 'use submit_collab_command for suggestion transitions and contributions' using errcode='42501'; end if;
  if tg_table_name='decisions' and (
    (to_jsonb(new)->>'id') is distinct from (to_jsonb(old)->>'id')
    or (to_jsonb(new)->>'trip_id') is distinct from (to_jsonb(old)->>'trip_id')
    or (to_jsonb(new)->>'raised_by') is distinct from (to_jsonb(old)->>'raised_by')
    or to_jsonb(new)->'options' is distinct from to_jsonb(old)->'options'
    or to_jsonb(new)->'votes_by_user_id' is distinct from to_jsonb(old)->'votes_by_user_id'
    or to_jsonb(new)->'comments' is distinct from to_jsonb(old)->'comments'
    or to_jsonb(new)->'status' is distinct from to_jsonb(old)->'status'
    or to_jsonb(new)->'resolved_option_id' is distinct from to_jsonb(old)->'resolved_option_id'
    or to_jsonb(new)->'resolved_at' is distinct from to_jsonb(old)->'resolved_at'
    or to_jsonb(new)->'resolved_stop_id' is distinct from to_jsonb(old)->'resolved_stop_id'
  ) then raise exception 'use submit_collab_command for decision transitions and contributions' using errcode='42501'; end if;
  return new;
end;
$$;

drop trigger if exists suggestions_guard_contributions on public.suggestions;
create trigger suggestions_guard_contributions before update on public.suggestions
  for each row execute function public.guard_collab_contribution_columns();
drop trigger if exists decisions_guard_contributions on public.decisions;
create trigger decisions_guard_contributions before update on public.decisions
  for each row execute function public.guard_collab_contribution_columns();

revoke all on function public.guard_collab_contribution_columns() from public, anon, authenticated;

commit;

