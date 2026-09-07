-- ============================================================
-- 0074 — Events Phase C: audience fan-out + the events-tick cron
-- ============================================================
-- Requires pg_cron + pg_net (already enabled on this project) and the
-- Supabase Vault. Two secrets must be created ONCE by an operator before
-- the schedule can authenticate (values are never committed):
--
--   select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'events_tick_service_key');
--   select vault.create_secret('<EMAIL_WORKER_SECRET>',        'events_tick_worker_secret');
--
-- The edge function (supabase/functions/events-tick) does its own auth on
-- the x-worker-secret header; the Bearer token just satisfies the gateway.

-- ---------- 1. audience -> active member ids ----------
-- Set-wise mirror of event_is_visible_to(): no audience rows for the
-- series = the whole org (back-compat). Used by events-tick to fan out
-- reminders without a per-user round trip.
create or replace function public.event_audience_user_ids(p_event_id uuid)
returns table (user_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  with ev as (select org_id from events where id = p_event_id),
  rules as (
    select kind, ref_id from event_audiences
    where event_id = p_event_id and occurrence_id is null
  ),
  members as (
    select m.user_id, m.role
    from memberships m, ev
    where m.org_id = ev.org_id and m.status = 'active'
  )
  select distinct mm.user_id
  from members mm
  where
    not exists (select 1 from rules)
    or exists (select 1 from rules where kind = 'all')
    or exists (
      select 1 from rules r
      where (r.kind = 'leadership' and mm.role in ('admin', 'trainer', 'team_leader'))
         or (r.kind = 'member' and r.ref_id = mm.user_id)
         or (r.kind = 'team' and exists (
              select 1 from group_members gm where gm.group_id = r.ref_id and gm.user_id = mm.user_id))
         or (r.kind = 'rank' and exists (
              select 1 from member_rank_progress mrp
              where mrp.user_id = mm.user_id and mrp.current_rank_id = r.ref_id))
    );
$$;
grant execute on function public.event_audience_user_ids(uuid) to authenticated, service_role;

-- ---------- 2. the schedule ----------
-- Every 10 minutes. Idempotent: unschedule an existing job of the same
-- name first so re-running the migration doesn't stack duplicates.
do $$
begin
  perform cron.unschedule('events-tick');
exception when others then null;
end $$;

select cron.schedule(
  'events-tick',
  '*/10 * * * *',
  $$
    select net.http_post(
      url := 'https://rbzkinczddgsjvuofntq.supabase.co/functions/v1/events-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'events_tick_service_key'), ''),
        'x-worker-secret', coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'events_tick_worker_secret'), '')
      ),
      body := '{}'::jsonb
    );
  $$
);
