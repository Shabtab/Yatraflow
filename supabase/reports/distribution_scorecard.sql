-- Run through an authorized admin session or the SQL editor. This file writes nothing.
-- Default window: the last seven completed UTC days. Change bounds before running a reading.
-- Supply the team cohort privately. Set exclusions_confirmed only after you check that cohort.
begin transaction read only;
with
params as (
  select
    (date_trunc('day', now() at time zone 'utc') at time zone 'utc') - interval '7 days' as start_at,
    date_trunc('day', now() at time zone 'utc') at time zone 'utc' as end_at,
    array[]::uuid[] as excluded_user_ids,
    false as exclusions_confirmed
),
campaigns(code, engine, slot) as (values
  ('p_a7c1d9e4b206', 'creator', 'Creator A / first route'),
  ('p_f2b8a064cd19', 'creator', 'Creator A / second route'),
  ('p_9d340e7ab165', 'creator', 'Creator B / route'),
  ('p_c6812fa930bd', 'partner', 'Partner A / guest guide'),
  ('p_4be09c713af8', 'partner', 'Partner B / guest guide'),
  (null, 'unattributed', 'No campaign')
),
usable as (
  select t.id, t.owner_id, t.created_at, t.creation_kind, t.ref, t.source_pub_id, t.campaign_id, t.deleted_at
  from public.trips t cross join params p
  where not (t.owner_id = any(p.excluded_user_ids))
    and exists (select 1 from public.trip_members m
      where m.trip_id = t.id and m.user_id = t.owner_id and m.role = 'owner')
),
primary_trips as (
  select * from usable where creation_kind in ('created', 'forked')
),
cohort as (
  select t.* from primary_trips t cross join params p
  where t.created_at >= extract(epoch from p.start_at) * 1000
    and t.created_at < extract(epoch from p.end_at) * 1000
),
origin_counts as (
  select coalesce(t.creation_kind, 'unknown') as origin, count(*) as trips
  from usable t cross join params p
  where t.created_at >= extract(epoch from p.start_at) * 1000
    and t.created_at < extract(epoch from p.end_at) * 1000
  group by coalesce(t.creation_kind, 'unknown')
),
nonowners as (
  select t.id as trip_id, t.owner_id, t.campaign_id, m.user_id, m.joined_at
  from primary_trips t join public.trip_members m on m.trip_id = t.id cross join params p
  where m.user_id <> t.owner_id and not (m.user_id = any(p.excluded_user_ids))
),
cohort_members as (
  select m.* from nonowners m join cohort t on t.id = m.trip_id cross join params p
  where m.joined_at < extract(epoch from p.end_at) * 1000
),
new_members as (
  select m.* from nonowners m cross join params p
  where m.joined_at >= extract(epoch from p.start_at) * 1000
    and m.joined_at < extract(epoch from p.end_at) * 1000
),
proposals as (
  select 'suggestion' as kind, id, trip_id, proposed_by as actor_id, created_at as at
  from public.suggestions
  union all
  select 'decision', id, trip_id, raised_by, created_at from public.decisions
),
member_proposals as (
  select a.*, m.campaign_id from proposals a join nonowners m
    on m.trip_id = a.trip_id and m.user_id = a.actor_id
  cross join params p
  where a.at >= m.joined_at
    and a.at >= extract(epoch from p.start_at) * 1000
    and a.at < extract(epoch from p.end_at) * 1000
),
cohort_proposals as (
  select a.* from member_proposals a join cohort t on t.id = a.trip_id
),
returning_proposers as (
  select actor_id, trip_id from member_proposals
  group by actor_id, trip_id
  having count(distinct (to_timestamp(at / 1000.0) at time zone 'utc')::date) >= 2
),
first_organized as (
  select owner_id, min(created_at) as at from primary_trips group by owner_id
),
prior_participation as (
  select m.*, f.at as organized_at,
    row_number() over (partition by m.user_id order by m.joined_at, m.trip_id) as first_membership
  from nonowners m join first_organized f on f.owner_id = m.user_id cross join params p
  where f.at > m.joined_at
    and f.at >= extract(epoch from p.start_at) * 1000
    and f.at < extract(epoch from p.end_at) * 1000
    and not exists (
      select 1 from usable earlier
      where earlier.owner_id = m.user_id and earlier.created_at < f.at
        and earlier.creation_kind is distinct from 'demo'
    )
),
traffic as (
  select e.pub_id, e.kind, e.source, e.campaign_id from public.pub_events e cross join params p
  where e.at >= p.start_at and e.at < p.end_at
),
campaign_rows as (
  select c.code, c.engine, c.slot,
    (select count(*) from traffic e where e.campaign_id is not distinct from c.code and e.kind = 'view') as publication_view_sessions,
    (select count(*) from traffic e where e.campaign_id is not distinct from c.code and e.kind = 'fork') as publication_fork_sessions,
    (select count(*) from cohort t where t.campaign_id is not distinct from c.code and t.creation_kind = 'created') as created_trips,
    (select count(*) from cohort t where t.campaign_id is not distinct from c.code and t.creation_kind = 'forked') as forked_trips,
    (select count(distinct t.owner_id) from cohort t where t.campaign_id is not distinct from c.code) as activated_organizers,
    (select count(distinct m.trip_id) from cohort_members m where m.campaign_id is not distinct from c.code) as cohort_trips_with_second_member,
    (select count(distinct a.trip_id) from cohort_proposals a where a.campaign_id is not distinct from c.code) as cohort_trips_with_member_proposal,
    (select count(distinct a.actor_id) from cohort_proposals a where a.campaign_id is not distinct from c.code) as cohort_member_proposal_authors
  from campaigns c
),
source_keys as (
  select source from traffic union select ref from cohort
),
source_rows as (
  select coalesce(k.source, 'unattributed') as source,
    (select count(*) from traffic e where e.source is not distinct from k.source and e.kind = 'view') as publication_view_sessions,
    (select count(*) from traffic e where e.source is not distinct from k.source and e.kind = 'fork') as publication_fork_sessions,
    (select count(*) from cohort t where t.ref is not distinct from k.source and t.creation_kind = 'created') as created_trips,
    (select count(*) from cohort t where t.ref is not distinct from k.source and t.creation_kind = 'forked') as forked_trips,
    (select count(distinct t.owner_id) from cohort t where t.ref is not distinct from k.source) as activated_organizers
  from source_keys k
),
publication_keys as (
  select campaign_id, pub_id from traffic
  union
  select campaign_id, source_pub_id from cohort where creation_kind = 'forked' and source_pub_id is not null
),
publication_rows as (
  select k.campaign_id, k.pub_id,
    (select count(*) from traffic e where e.pub_id = k.pub_id and e.campaign_id is not distinct from k.campaign_id and e.kind = 'view') as publication_view_sessions,
    (select count(*) from traffic e where e.pub_id = k.pub_id and e.campaign_id is not distinct from k.campaign_id and e.kind = 'fork') as publication_fork_sessions,
    (select count(*) from cohort t where t.source_pub_id = k.pub_id and t.campaign_id is not distinct from k.campaign_id and t.creation_kind = 'forked') as forked_trips
  from publication_keys k
),
engine_rows as (
  select c.engine, count(distinct t.id) as activated_trips, count(distinct t.owner_id) as activated_organizers
  from campaigns c left join cohort t on t.campaign_id is not distinct from c.code
  group by c.engine
),
create_diagnostics as (
  select count(*) filter (where e.event = 'started') as start_events,
    count(*) filter (where e.event = 'submitted') as submit_events,
    count(distinct e.trip_id) filter (where e.event = 'submitted') as submitted_trip_ids,
    count(*) filter (where e.event = 'moment_invite_sent') as share_destination_events
  from public.create_funnel_events e cross join params p
  where e.at >= p.start_at and e.at < p.end_at
)
select jsonb_build_object(
  'period', (select jsonb_build_object('start_utc', start_at, 'end_utc_exclusive', end_at) from params),
  'team_exclusions_confirmed', (select exclusions_confirmed from params),
  'campaigns', (select jsonb_agg(to_jsonb(c) order by c.engine, c.code) from campaign_rows c),
  'activity_by_source', coalesce((select jsonb_agg(to_jsonb(s) order by s.source) from source_rows s), '[]'::jsonb),
  'campaign_publications', coalesce((select jsonb_agg(to_jsonb(r) order by r.campaign_id, r.pub_id) from publication_rows r), '[]'::jsonb),
  'trip_origins', coalesce((select jsonb_object_agg(origin, trips) from origin_counts), '{}'::jsonb),
  'activated_organizers_total', (select count(distinct owner_id) from cohort),
  'engine_activations', (select jsonb_agg(to_jsonb(e) order by e.engine) from engine_rows e),
  'group_activity', jsonb_build_object(
    'new_memberships', (select count(*) from new_members),
    'distinct_new_members', (select count(distinct user_id) from new_members),
    'persisted_member_proposals', (select count(*) from member_proposals),
    'member_proposal_authors', (select count(distinct actor_id) from member_proposals),
    'trips_with_member_proposal', (select count(distinct trip_id) from member_proposals),
    'returning_member_proposal_authors', (select count(distinct actor_id) from returning_proposers),
    'first_known_organizers_after_participation', (select count(*) from prior_participation where first_membership = 1)
  ),
  'create_event_diagnostics', (select to_jsonb(d) from create_diagnostics d),
  'orphan_trip_rows', (
    select count(*) from public.trips t cross join params p
    where t.created_at >= extract(epoch from p.start_at) * 1000
      and t.created_at < extract(epoch from p.end_at) * 1000
      and not (t.owner_id = any(p.excluded_user_ids))
      and not exists (select 1 from public.trip_members m
        where m.trip_id = t.id and m.user_id = t.owner_id and m.role = 'owner')
  ),
  'unsupported', jsonb_build_array('unique visitors', 'visitor conversion', 'invite acceptance rate', 'generic app retention', 'cross-device attribution'),
  'limitations', jsonb_build_array(
    'Traffic cannot apply the private team exclusion cohort.',
    'Session claims and campaign tags are client claims, not proof of a person or sender.',
    'Membership does not identify invite joins separately from owner additions.',
    'Removed memberships and hard-deleted rows remove historical evidence.',
    'Proposal authorship uses existing member-writable product records.',
    'Review campaign_publications against the frozen private campaign mapping.'
  )
);
rollback;
