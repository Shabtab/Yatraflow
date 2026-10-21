do $$ begin
  if current_database() <> 'yatraflow_growth_test' then raise exception 'local test database required'; end if;
end $$;
insert into public.trips (id, owner_id, name, created_at) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'private fixture title', (extract(epoch from now() - interval '30 days') * 1000)::bigint);
insert into public.published_itineraries (id, trip_id, creator_id) values
  ('pub_fixture', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');

set role anon;
set request.jwt.claim.sub = '';
do $$ begin
  begin
    perform public.join_trip('PRIVATE-CODE');
    raise exception 'anonymous join succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.pub_events (pub_id, kind) values ('pub_fixture', 'view');
    raise exception 'direct event insert succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select public.bump_published_stats('pub_fixture', 'views');
select public.bump_published_stats('pub_fixture', 'copies', 'explore');
select public.bump_published_stats('pub_fixture', 'views', 'wa', 'p_a7c1d9e4b206');
select public.bump_published_stats('pub_fixture', 'views', 'wa', '9845012345@example.com');
select public.bump_published_stats('pub_missing', 'views', 'wa', 'p_a7c1d9e4b206');
select public.bump_published_stats('pub_fixture', 'unknown');
reset role;
select public.test_assert((select count(*) = 4 from public.pub_events), 'legacy signatures and counter guards');
select public.test_assert((select views = 3 and copies = 1 from public.published_itineraries where id = 'pub_fixture'), 'counter and dated log agree');
select public.test_assert((select count(*) = 1 from public.pub_events where campaign_id is not null), 'campaign allowlist drops private text');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
do $$ begin
  begin
    perform public.join_trip('PRIVATE-CODE');
    raise exception 'disabled caller joined a trip';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.trips (id, owner_id, name, creation_kind, source_pub_id, campaign_id, created_at, invite_code) values
  ('10000000-0000-0000-0000-000000000002', auth.uid(), 'private fixture title', 'forked', 'pub_fixture', 'p_a7c1d9e4b206', (extract(epoch from now() - interval '6 days') * 1000)::bigint, 'PRIVATE-CODE');
insert into public.trip_members values ('10000000-0000-0000-0000-000000000002', auth.uid(), 'owner', (extract(epoch from now() - interval '6 days') * 1000)::bigint);
insert into public.trips (id, owner_id, name, creation_kind, source_pub_id, campaign_id) values
  ('10000000-0000-0000-0000-000000000009', auth.uid(), 'private fixture title', 'forked', 'pub_fixture', 'person@example.com');
select public.test_assert((select creation_kind = 'forked' and source_pub_id = 'pub_fixture' and campaign_id is null from public.trips where id = '10000000-0000-0000-0000-000000000009'), 'invalid campaign does not block a real fork record');
insert into public.create_funnel_events(session_id, event, meta, user_id, phase) values
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'started', '{"name":"private fixture title","phone":"9845012345"}', null, 'private fixture title');
insert into public.create_funnel_events(session_id, event, trip_id, meta, user_id) values
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'submitted', '10000000-0000-0000-0000-000000000002', '{"days":3,"travellers":2,"mode":"car","phone":"9845012345"}', '00000000-0000-0000-0000-000000000003');
insert into public.create_funnel_events(session_id, event, trip_id, meta) values
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'submitted', null, '{"days":3,"travellers":2,"mode":"car"}');
reset role;
select public.test_assert((select count(*) = 2 from public.create_funnel_events), 'only a usable persisted trip can acknowledge submit');
select public.test_assert((select bool_and(user_id = '00000000-0000-0000-0000-000000000001'::uuid and phase is null) from public.create_funnel_events), 'authenticated identity is bound by the server');
select public.test_assert((select meta = '{"days":3,"travellers":2,"mode":"car"}'::jsonb from public.create_funnel_events where event = 'submitted'), 'event metadata excludes private content');

set role anon;
set request.jwt.claim.sub = '';
insert into public.create_funnel_events(session_id, event, meta, user_id) values
  ('private fixture title', 'abandoned', '{"lastStage":"Priya"}', '00000000-0000-0000-0000-000000000001');
select public.test_assert((select count(*) = 0 from public.create_funnel_events), 'anonymous event reads remain denied');
reset role;
select public.test_assert((select user_id is null and meta is null and session_id ~ '^[0-9a-f]{32}$' from public.create_funnel_events where event = 'abandoned'), 'anonymous events contain no identity or arbitrary stage');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
  begin
    insert into public.trip_members values ('10000000-0000-0000-0000-000000000002', auth.uid(), 'owner', 0);
    raise exception 'unsafe self-insert succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select public.test_assert(public.join_trip('INVALID') is null, 'invalid invitation joins nobody');
select public.test_assert(public.join_trip('private-code') = '10000000-0000-0000-0000-000000000002'::uuid, 'valid authenticated invite joins the trip');
select public.join_trip('PRIVATE-CODE');
reset role;
select public.test_assert((select count(*) = 1 from public.trip_members where trip_id = '10000000-0000-0000-0000-000000000002' and user_id = '00000000-0000-0000-0000-000000000002'), 'duplicate joins keep one membership');
update public.trip_members set joined_at = (extract(epoch from now() - interval '5 days') * 1000)::bigint
  where trip_id = '10000000-0000-0000-0000-000000000002' and user_id = '00000000-0000-0000-0000-000000000002';
insert into public.trip_members values
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'viewer', (extract(epoch from now() - interval '4 days') * 1000)::bigint);

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
update public.trips set campaign_id = 'p_c6812fa930bd', creation_kind = 'created', source_pub_id = null
  where id = '10000000-0000-0000-0000-000000000002';
update public.create_funnel_events set user_id = auth.uid() where user_id is null;
reset role;
select public.test_assert((select campaign_id = 'p_a7c1d9e4b206' and creation_kind = 'forked' and source_pub_id = 'pub_fixture' from public.trips where id = '10000000-0000-0000-0000-000000000002'), 'members cannot rewrite trip acquisition');
select public.test_assert((select user_id is null from public.create_funnel_events where event = 'abandoned'), 'anonymous history cannot be claimed through UPDATE');

update public.trip_members set role = 'viewer'
  where trip_id = '10000000-0000-0000-0000-000000000002' and user_id = '00000000-0000-0000-0000-000000000002';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select public.join_trip('PRIVATE-CODE');
reset role;
select public.test_assert((select role = 'viewer' from public.trip_members where trip_id = '10000000-0000-0000-0000-000000000002' and user_id = '00000000-0000-0000-0000-000000000002'), 'an existing membership keeps its role');

revoke select on public.published_itineraries from authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
insert into public.trips (id, owner_id, name, creation_kind, source_pub_id, campaign_id) values
  ('10000000-0000-0000-0000-000000000007', auth.uid(), 'private fixture title', 'forked', 'pub_fixture', 'p_a7c1d9e4b206');
reset role;
grant select on public.published_itineraries to authenticated;
select public.test_assert((select creation_kind is null and source_pub_id is null and campaign_id is null from public.trips where id = '10000000-0000-0000-0000-000000000007'), 'failed attribution lookup does not block a valid trip insert');

insert into public.trips (id, owner_id, name, creation_kind, campaign_id, created_at) values
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'private fixture title', 'created', 'private fixture title', (extract(epoch from now() - interval '1 day') * 1000)::bigint),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'private fixture title', 'demo', null, (extract(epoch from now() - interval '2 days') * 1000)::bigint),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000003', 'private fixture title', null, null, (extract(epoch from now() - interval '2 days') * 1000)::bigint),
  ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003', 'private fixture title', 'created', null, (extract(epoch from now() - interval '1 day') * 1000)::bigint);
insert into public.trips (id, owner_id, name, creation_kind, source_pub_id, campaign_id, created_at) values
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'private fixture title', 'forked', 'pub_fixture', 'p_f2b8a064cd19', (extract(epoch from now() - interval '4 days') * 1000)::bigint);
insert into public.trip_members
  select id, owner_id, 'owner', created_at from public.trips where id <> '10000000-0000-0000-0000-000000000002';
insert into public.trips (id, owner_id, name, creation_kind, created_at) values
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000004', 'private fixture title', 'created', (extract(epoch from now() - interval '2 days') * 1000)::bigint);
insert into public.suggestions values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', (extract(epoch from now() - interval '3 days') * 1000)::bigint, 'private fixture title');
insert into public.decisions values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', (extract(epoch from now() - interval '2 days') * 1000)::bigint, 'private fixture title');
select 'PASS: SQL counter compatibility, privacy guards, authenticated writes, usable activation, immutable attribution, owner-only membership, and idempotent joins';
