-- ============================================================
-- 0053 — Transactional email (Resend)
-- ------------------------------------------------------------
-- Adds the delivery layer that sits *beside* the in-app
-- notification system:
--
--   domain event  ->  in-app notification  ->  (decision gate)
--                                          ->  email_outbox  ->  Resend
--
-- Design rules baked in here:
--  * Financial / goal / announcement state changes NEVER depend on
--    email. Everything server-side only does a local INSERT into
--    email_outbox (via enqueue_email / triggers). A Resend outage
--    leaves rows in 'pending' / 'failed' — the business transaction
--    already committed.
--  * email_outbox  = durable queue for server/trigger-originated mail.
--  * email_log      = one row per actual send attempt (no message body).
--  * Hard dedupe on dedupe_key (partial unique index) on BOTH tables.
--  * No client writes to either table. Reads: office admins get a
--    column-limited view of their org; platform admins see all.
--  * Category -> preference gate lives in the Edge function, but the
--    bridge trigger below also respects notification_prefs so we never
--    even enqueue mail a member has turned off (essential categories
--    — account / security / billing / support / invite — bypass).
-- ============================================================

-- ---------- preference columns ------------------------------
-- notification_prefs already has: goal_reminders, learning, finance,
-- events, announcements (in-app). Add the email mirror. Everything
-- defaults ON except learning (explicitly opt-in). email_account is
-- always-on and is intentionally NOT a user-facing toggle.
alter table notification_prefs
  add column if not exists email_account       boolean not null default true,
  add column if not exists email_goals         boolean not null default true,
  add column if not exists email_finance       boolean not null default true,
  add column if not exists email_events        boolean not null default true,
  add column if not exists email_announcements boolean not null default true,
  add column if not exists email_learning      boolean not null default false;

-- ---------- office announcements: opt-in email fan-out ------
alter table office_announcements
  add column if not exists send_email boolean not null default false;

-- ============================================================
-- email_outbox — durable queue
-- ============================================================
create table if not exists email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid references organizations(id) on delete cascade,
  recipient_user_id   uuid references profiles(id) on delete set null,
  recipient_email     text not null,
  email_type          text not null,
  category            text not null default 'account',
  template_data       jsonb not null default '{}'::jsonb,   -- already masked; no secrets
  dedupe_key          text,
  related_entity_type text,
  related_entity_id   uuid,
  status              text not null default 'pending'
    check (status in ('pending','processing','sent','failed')),
  attempt_count       int not null default 0,
  max_attempts        int not null default 5,
  scheduled_for       timestamptz not null default now(),
  last_error          text,
  locked_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index if not exists email_outbox_due_idx
  on email_outbox (status, scheduled_for)
  where status in ('pending','processing');
create index if not exists email_outbox_org_idx on email_outbox (org_id, created_at desc);
create unique index if not exists email_outbox_dedupe_uq
  on email_outbox (dedupe_key) where dedupe_key is not null;

-- ============================================================
-- email_log — one row per send attempt (no body stored)
-- ============================================================
create table if not exists email_log (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid references organizations(id) on delete cascade,
  recipient_user_id   uuid references profiles(id) on delete set null,
  recipient_email     text not null,
  email_type          text not null,
  category            text not null default 'account',
  subject             text,
  provider            text not null default 'resend',
  provider_message_id text,
  status              text not null check (status in ('sent','failed')),
  dedupe_key          text,
  related_entity_type text,
  related_entity_id   uuid,
  error_message       text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  failed_at           timestamptz
);
create index if not exists email_log_org_idx on email_log (org_id, created_at desc);
create index if not exists email_log_recipient_idx on email_log (recipient_user_id, created_at desc);
create index if not exists email_log_type_idx on email_log (email_type, created_at desc);
create unique index if not exists email_log_dedupe_uq
  on email_log (dedupe_key) where dedupe_key is not null;

-- ============================================================
-- RLS — no client writes; scoped reads only
-- ============================================================
alter table email_outbox enable row level security;
alter table email_log    enable row level security;

-- office admins: read their own org's rows (safe columns only via the view)
drop policy if exists "office admins read org email_outbox" on email_outbox;
create policy "office admins read org email_outbox"
  on email_outbox for select
  using (org_id is not null and has_org_role(org_id, array['admin']));

drop policy if exists "office admins read org email_log" on email_log;
create policy "office admins read org email_log"
  on email_log for select
  using (org_id is not null and has_org_role(org_id, array['admin']));

drop policy if exists "platform admins read all email_outbox" on email_outbox;
create policy "platform admins read all email_outbox"
  on email_outbox for select using (is_platform_admin());

drop policy if exists "platform admins read all email_log" on email_log;
create policy "platform admins read all email_log"
  on email_log for select using (is_platform_admin());

-- Column-limited view for office admins: never expose template_data.
create or replace view email_log_admin_v as
  select id, org_id, recipient_user_id, recipient_email, email_type, category,
         subject, provider, provider_message_id, status, related_entity_type,
         related_entity_id, error_message, created_at, sent_at, failed_at
  from email_log;

-- ============================================================
-- enqueue_email — the one safe path to queue mail
-- ============================================================
-- Callable by authenticated users (must be a member of p_org) and by
-- other SECURITY DEFINER functions / triggers. Resolves the recipient
-- email, applies the notification_prefs gate for non-essential
-- categories, and dedupes. Never raises for a "skip" — just returns.
create or replace function enqueue_email(
  p_org uuid,
  p_recipient_user uuid,
  p_email_type text,
  p_category text,
  p_template_data jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_related_type text default null,
  p_related_id uuid default null,
  p_recipient_email text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := p_recipient_email;
  v_allowed boolean := true;
begin
  -- authorisation: callers acting inside an org must belong to it.
  -- (SECURITY DEFINER triggers pass through here too; is_org_member is
  --  evaluated as the invoking user, so trigger context — running as
  --  the acting user — still resolves correctly for member self-mail.)
  if p_org is not null and not is_org_member(p_org) and not is_platform_admin() then
    return;
  end if;

  if p_recipient_user is not null then
    -- target must be an active member of the org (cross-tenant guard)
    if p_org is not null and not exists (
      select 1 from memberships
      where org_id = p_org and user_id = p_recipient_user and status = 'active'
    ) then
      return;
    end if;
    if v_email is null then
      select u.email into v_email from auth.users u where u.id = p_recipient_user;
      if v_email is null then
        select pr.email into v_email from profiles pr where pr.id = p_recipient_user;
      end if;
    end if;
  end if;

  if v_email is null or position('@' in v_email) = 0 then
    return;
  end if;

  -- org must not be suspended
  if p_org is not null and exists (
    select 1 from organizations where id = p_org and status <> 'active'
  ) then
    return;
  end if;

  -- preference gate — essential categories always pass
  if p_category not in ('account','security','billing','support','invite')
     and p_recipient_user is not null then
    select case p_category
      when 'goals'   then coalesce(np.email_goals, true)
      when 'finance' then coalesce(np.email_finance, true)
      when 'events'  then coalesce(np.email_events, true)
      when 'office'  then coalesce(np.email_announcements, true)
      when 'learning' then coalesce(np.email_learning, false)
      else true
    end into v_allowed
    from (select p_recipient_user as uid) x
    left join notification_prefs np on np.user_id = x.uid;
    if not coalesce(v_allowed, true) then return; end if;
  end if;

  insert into email_outbox (
    org_id, recipient_user_id, recipient_email, email_type, category,
    template_data, dedupe_key, related_entity_type, related_entity_id
  ) values (
    p_org, p_recipient_user, lower(v_email), p_email_type, p_category,
    coalesce(p_template_data, '{}'::jsonb), p_dedupe_key, p_related_type, p_related_id
  )
  on conflict (dedupe_key) do nothing;
end;
$$;
grant execute on function enqueue_email(uuid, uuid, text, text, jsonb, text, text, uuid, text) to authenticated;

-- ============================================================
-- Outbox worker helpers — service role / platform admin only
-- ============================================================
-- claim: atomically move up to p_limit due rows to 'processing' and
-- return them. Reclaims rows stuck in 'processing' > 15 min.
create or replace function email_outbox_claim(p_limit int default 25)
returns setof email_outbox language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() and current_setting('request.jwt.claims', true) is not null then
    -- authenticated non-platform caller: refuse. Service-role calls have
    -- no jwt claims and are allowed through.
    if (current_setting('request.jwt.claims', true))::jsonb ? 'sub' then
      raise exception 'not permitted';
    end if;
  end if;

  return query
  with due as (
    select id from email_outbox
    where (
      (status = 'pending' and scheduled_for <= now())
      or (status = 'processing' and locked_at < now() - interval '15 minutes')
    )
    and attempt_count < max_attempts
    order by scheduled_for
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  )
  update email_outbox o
  set status = 'processing', locked_at = now(), attempt_count = o.attempt_count + 1,
      updated_at = now()
  from due
  where o.id = due.id
  returning o.*;
end;
$$;
revoke all on function email_outbox_claim(int) from public;

-- mark: record the outcome of a send + write the email_log row.
create or replace function email_outbox_mark(
  p_id uuid, p_status text, p_provider_message_id text default null, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
declare o email_outbox;
begin
  if not is_platform_admin() then
    if (current_setting('request.jwt.claims', true))::jsonb ? 'sub' then
      raise exception 'not permitted';
    end if;
  end if;

  select * into o from email_outbox where id = p_id for update;
  if not found then return; end if;

  if p_status = 'sent' then
    update email_outbox set status = 'sent', sent_at = now(), last_error = null,
      locked_at = null, updated_at = now() where id = p_id;
  elsif o.attempt_count >= o.max_attempts then
    update email_outbox set status = 'failed', last_error = p_error,
      locked_at = null, updated_at = now() where id = p_id;
  else
    -- exponential backoff: 5min, 25min, 2h, ...
    update email_outbox set status = 'pending', last_error = p_error, locked_at = null,
      scheduled_for = now() + (interval '5 minutes' * power(5, greatest(o.attempt_count - 1, 0))),
      updated_at = now() where id = p_id;
  end if;

  insert into email_log (
    org_id, recipient_user_id, recipient_email, email_type, category, subject,
    provider, provider_message_id, status, dedupe_key, related_entity_type,
    related_entity_id, error_message, sent_at, failed_at
  ) values (
    o.org_id, o.recipient_user_id, o.recipient_email, o.email_type, o.category,
    o.template_data->>'subject', 'resend', p_provider_message_id,
    case when p_status = 'sent' then 'sent' else 'failed' end,
    o.dedupe_key, o.related_entity_type, o.related_entity_id, p_error,
    case when p_status = 'sent' then now() end,
    case when p_status <> 'sent' then now() end
  )
  on conflict (dedupe_key) do nothing;
end;
$$;
revoke all on function email_outbox_mark(uuid, text, text, text) from public;

-- log_email_send: used by the JWT-verified send-email Edge function
-- (client-triggered mail that does NOT go through the outbox) to record
-- its result. Service-role call; RLS-bypassing insert.
create or replace function log_email_send(
  p_org uuid, p_recipient_user uuid, p_recipient_email text, p_email_type text,
  p_category text, p_subject text, p_status text, p_provider_message_id text default null,
  p_dedupe_key text default null, p_related_type text default null,
  p_related_id uuid default null, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    if (current_setting('request.jwt.claims', true))::jsonb ? 'sub' then
      raise exception 'not permitted';
    end if;
  end if;
  insert into email_log (
    org_id, recipient_user_id, recipient_email, email_type, category, subject,
    provider, provider_message_id, status, dedupe_key, related_entity_type,
    related_entity_id, error_message, sent_at, failed_at
  ) values (
    p_org, p_recipient_user, lower(p_recipient_email), p_email_type, p_category, p_subject,
    'resend', p_provider_message_id, p_status, p_dedupe_key, p_related_type, p_related_id,
    p_error, case when p_status = 'sent' then now() end,
    case when p_status <> 'sent' then now() end
  )
  on conflict (dedupe_key) do nothing;
end;
$$;
revoke all on function log_email_send(uuid, uuid, text, text, text, text, text, text, text, text, uuid, text) from public;

-- recent_email_count: rate-limit helper for the send-email function.
create or replace function recent_email_count(
  p_email_type text, p_related_id uuid, p_since interval
) returns int language sql security definer set search_path = public as $$
  select count(*)::int from email_log
  where email_type = p_email_type
    and (p_related_id is null or related_entity_id = p_related_id)
    and created_at >= now() - p_since;
$$;
revoke all on function recent_email_count(text, uuid, interval) from public;

-- ============================================================
-- Bridge trigger: in-app notification  ->  email_outbox
-- ------------------------------------------------------------
-- Only a whitelist of notification types produces mail. enqueue_email
-- re-checks the preference + membership + suspension. dedupe_key ties
-- the email to the notification row so it can never double-send.
-- ============================================================
create or replace function notification_email_bridge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_category text;
  v_subject text;
  v_text text := coalesce(new.payload->>'text', '');
  v_link text := coalesce(new.payload->>'link', '/');
begin
  if new.channel is distinct from 'in_app' then return new; end if;

  case new.type
    when 'goal_setup_reminder' then v_category := 'goals'; v_subject := 'Set your goals for this month';
    when 'goal_deadline'       then v_category := 'goals'; v_subject := 'Goal deadline reminder';
    when 'goal_approved'       then v_category := 'goals'; v_subject := 'Your goal was approved';
    when 'goal_changes_requested' then v_category := 'goals'; v_subject := 'Changes requested on your goal';
    when 'goal_rejected'      then v_category := 'goals'; v_subject := 'Your goal was not approved';
    when 'goal_month_closed'  then v_category := 'goals'; v_subject := 'Your goals month has closed';
    else return new;
  end case;

  perform enqueue_email(
    new.org_id, new.user_id, 'notification:' || new.type, v_category,
    jsonb_build_object('subject', v_subject, 'headline', v_subject,
                       'message', v_text, 'cta_label', 'Open Bizzlivo', 'cta_path', v_link),
    'notif:' || new.id::text, 'notification', new.id
  );
  return new;
end;
$$;
drop trigger if exists notifications_email_bridge on notifications;
create trigger notifications_email_bridge
  after insert on notifications
  for each row execute function notification_email_bridge();

-- ============================================================
-- Finance: withdrawal state changes  ->  email_outbox
-- ------------------------------------------------------------
-- Direct trigger (not via notify) because the email needs amount,
-- currency, reference and a MASKED account tail — never the full number.
-- ============================================================
create or replace function withdrawal_email_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text := new.status;
  v_subject text;
  v_headline text;
  v_acct text;
  v_tail text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  -- mask the destination account: keep last 4 only
  v_acct := coalesce(
    new.payout_snapshot->>'account_number',
    new.payout_snapshot->>'account',
    new.payout_snapshot->>'number', ''
  );
  if length(v_acct) >= 4 then
    v_tail := '****' || right(v_acct, 4);
  else
    v_tail := null;
  end if;

  case v_status
    when 'requested'  then v_subject := 'Withdrawal request received';
                           v_headline := 'We received your withdrawal request';
    when 'approved'   then v_subject := 'Withdrawal approved';
                           v_headline := 'Your withdrawal has been approved';
    when 'processing' then v_subject := 'Withdrawal is processing';
                           v_headline := 'Your withdrawal is being processed';
    when 'paid'       then v_subject := 'Withdrawal paid';
                           v_headline := 'Your withdrawal has been paid';
    when 'rejected'   then v_subject := 'Withdrawal not approved';
                           v_headline := 'Your withdrawal request was not approved';
    else return new;   -- 'cancelled' — member did it themselves, no email
  end case;

  perform enqueue_email(
    new.org_id, new.member_id, 'withdrawal_update', 'finance',
    jsonb_build_object(
      'subject', v_subject, 'headline', v_headline,
      'amount', new.amount, 'currency', new.currency,
      'reference', new.reference, 'status', v_status,
      'account_tail', v_tail,
      'note', coalesce(new.decided_reason, new.admin_note),
      'cta_label', 'View wallet', 'cta_path', '/wallet'
    ),
    'wd:' || new.id::text || ':' || v_status, 'withdrawal_request', new.id
  );
  return new;
end;
$$;
drop trigger if exists withdrawal_requests_email on withdrawal_requests;
create trigger withdrawal_requests_email
  after insert or update on withdrawal_requests
  for each row execute function withdrawal_email_notify();

-- ============================================================
-- Office announcements: opt-in email fan-out
-- ------------------------------------------------------------
-- Replaces announcement_fanout() from 0050. Still calls notify() for
-- the in-app row (unchanged); additionally enqueues an email per
-- recipient when send_email = true.
-- ============================================================
create or replace function announcement_fanout()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.publish_at > now() then return new; end if;
  for u in
    select m.user_id from memberships m
    where m.org_id = new.org_id and m.status = 'active' and m.role = 'member'
      and (
        new.audience_type = 'all'
        or (new.audience_type = 'members' and m.user_id = any (new.audience_ids))
        or (new.audience_type = 'team' and exists (
          select 1 from group_members gm where gm.user_id = m.user_id and gm.group_id = any (new.audience_ids)))
        or (new.audience_type = 'rank' and exists (
          select 1 from member_rank_progress mp
          where mp.user_id = m.user_id and mp.org_id = new.org_id and mp.current_rank_id = any (new.audience_ids)))
      )
  loop
    perform notify(new.org_id, u, 'office', 'announcement',
      new.title, coalesce(new.link, '/updates'), 'ann:' || new.id::text);

    if new.send_email then
      perform enqueue_email(
        new.org_id, u, 'office_announcement', 'office',
        jsonb_build_object(
          'subject', new.title, 'headline', new.title,
          'message', new.body,
          'priority', new.priority,
          'cta_label', 'Open Bizzlivo', 'cta_path', coalesce(new.link, '/updates')
        ),
        'ann:' || new.id::text || ':' || u::text, 'office_announcement', new.id
      );
    end if;
  end loop;
  return new;
end;
$$;

-- ============================================================
-- grants
-- ============================================================
grant select on email_log_admin_v to authenticated;
