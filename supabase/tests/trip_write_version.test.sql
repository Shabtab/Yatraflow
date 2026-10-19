\set ON_ERROR_STOP on

do $$
begin
  if (select write_version from public.trips where id = '10000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'Existing trips must start at version zero';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.advance_trip_write_version()'::regprocedure and prosecdef) then
    raise exception 'The version trigger needs narrow sequence privileges';
  end if;
end;
$$;

set role authenticated;

do $$
declare
  v_version bigint;
  v_count integer;
  v_previous bigint;
  v_insert bigint;
  v_restored bigint;
begin
  insert into public.trips (id, name, write_version)
  values ('10000000-0000-0000-0000-000000000002', 'Synthetic local fixture', 9000)
  returning write_version into v_version;
  if v_version <= 0 or v_version = 9000 then raise exception 'Clients must not forge insert versions'; end if;
  begin
    perform pg_catalog.nextval('public.trip_write_version_seq'::regclass);
    raise exception 'Clients must not access the sequence directly';
  exception when insufficient_privilege then null;
  end;

  update public.trips set name = 'Legacy update'
  where id = '10000000-0000-0000-0000-000000000001'
  returning write_version into v_version;
  if v_version <= 0 then raise exception 'Legacy updates must advance the version'; end if;
  v_previous := v_version;

  update public.trips set name = 'Stale conditional update'
  where id = '10000000-0000-0000-0000-000000000001' and write_version = 0;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'Stale updates must affect zero rows'; end if;

  update public.trips set name = 'Current conditional update'
  where id = '10000000-0000-0000-0000-000000000001' and write_version = v_previous
  returning write_version into v_version;
  get diagnostics v_count = row_count;
  if v_count <> 1 or v_version <= v_previous then raise exception 'Current updates must succeed exactly once'; end if;

  update public.trips set name = 'Repeated conditional update'
  where id = '10000000-0000-0000-0000-000000000001' and write_version = v_previous;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'Repeated updates must not replay'; end if;
  v_previous := v_version;

  update public.trips set write_version = 0
  where id = '10000000-0000-0000-0000-000000000001'
  returning write_version into v_version;
  if v_version <= v_previous then raise exception 'Clients must not reset versions'; end if;
  v_previous := v_version;

  update public.trips set write_version = 9223372036854775807
  where id = '10000000-0000-0000-0000-000000000001'
  returning write_version into v_version;
  if v_version <= v_previous then raise exception 'Clients must not forge update versions'; end if;
  v_previous := v_version;

  update public.trips set write_version = null
  where id = '10000000-0000-0000-0000-000000000001'
  returning write_version into v_version;
  if v_version <= v_previous then raise exception 'Null payloads must not remove the version'; end if;

  insert into public.trips (id, name)
  values ('10000000-0000-0000-0000-000000000003', 'Before delete')
  returning write_version into v_insert;
  delete from public.trips where id = '10000000-0000-0000-0000-000000000003';
  insert into public.trips (id, name, write_version)
  values ('10000000-0000-0000-0000-000000000003', 'Undo restored', v_insert)
  returning write_version into v_restored;
  if v_restored <= v_insert then raise exception 'Undo must create a fresh revision'; end if;
  update public.trips set name = 'Stale writer before delete'
  where id = '10000000-0000-0000-0000-000000000003' and write_version = v_insert;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'Old revisions must fail after delete and reinsert'; end if;
end;
$$;

reset role;

do $$
begin
  if (select name from public.trips where id = '10000000-0000-0000-0000-000000000001') <> 'Current conditional update' then
    raise exception 'Rejected writes must preserve saved contents';
  end if;
end;
$$;

select 'PASS: legacy writes, stale CAS, duplicate replay, forged versions, sequence access, and delete/Undo';
