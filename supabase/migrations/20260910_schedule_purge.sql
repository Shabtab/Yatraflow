-- ============ Optional: schedule the 30-day trash purge (pg_cron) ============
-- The `purge_trashed_trips()` function (20260910_trip_trash.sql) hard-deletes any
-- trip trashed more than 30 days ago. This schedules it to run daily at 03:00 UTC.
--
-- PREREQUISITE: the pg_cron extension must be enabled first —
--   Dashboard → Database → Extensions → search "pg_cron" → enable.
-- On plans without pg_cron, run the purge manually instead:
--   select public.purge_trashed_trips();
--
-- Undo the schedule: select cron.unschedule('yatraflow-purge-trips');

select cron.schedule('yatraflow-purge-trips', '0 3 * * *', 'select public.purge_trashed_trips();');
