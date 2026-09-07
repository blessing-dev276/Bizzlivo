-- ============================================================
-- 0055 — email wiring for support tickets
-- ------------------------------------------------------------
-- Bridges support_tickets state -> email_outbox:
--   * new ticket   -> confirm to the creator + alert org admins
--   * admin reply   (admin_note changes) -> notify the creator
--   * resolved/closed -> notify the creator
-- Internal notes are never exposed to the creator: the reply/resolve
-- emails carry a generic "there's an update" message, not admin_note.
-- ============================================================

-- ------------------------------------------------------------
-- enqueue_email authz fix: also allow service-role callers (Edge
-- functions running with the service key — e.g. billing activation).
-- Those calls have no request.jwt.claims 'sub'. Authenticated users
-- still must be a member of the org (or a platform admin).
-- ------------------------------------------------------------
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
  v_is_service boolean;
begin
  v_is_service := not ((current_setting('request.jwt.claims', true))::jsonb ? 'sub');

  if not v_is_service
     and p_org is not null
     and not is_org_member(p_org)
     and not is_platform_admin() then
    return;
  end if;

  if p_recipient_user is not null then
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

  if p_org is not null and exists (
    select 1 from organizations where id = p_org and status <> 'active'
  ) then
    return;
  end if;

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

create or replace function support_ticket_email_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_admin_email text;
begin
  if tg_op = 'INSERT' then
    -- confirmation to the person who raised it
    perform enqueue_email(
      new.org_id, new.created_by, 'support_ticket_user', 'support',
      jsonb_build_object(
        'template_type', 'support_ticket_user',
        'subject', 'We received your support request',
        'headline', 'Your support request was received',
        'message', 'Thanks for reaching out. Your office admins can now see your request "'
                   || new.subject || '" and will follow up. You can track it on the support page.',
        'cta_label', 'View request', 'cta_path', '/support'
      ),
      'ticket:' || new.id::text || ':created', 'support_ticket', new.id
    );

    -- alert each active office admin
    for a in
      select m.user_id from memberships m
      where m.org_id = new.org_id and m.status = 'active' and m.role = 'admin'
    loop
      perform enqueue_email(
        new.org_id, a.user_id, 'support_ticket_staff', 'support',
        jsonb_build_object(
          'template_type', 'support_ticket_staff',
          'subject', 'New support ticket: ' || new.subject,
          'headline', 'A member raised a support ticket',
          'message', 'A new support ticket is waiting in your office.',
          'ticket_subject', new.subject,
          'category', new.category,
          'priority', new.priority,
          'cta_label', 'Open in Bizzlivo', 'cta_path', '/support'
        ),
        'ticket:' || new.id::text || ':staff:' || a.user_id::text, 'support_ticket', new.id
      );
    end loop;
    return new;
  end if;

  -- UPDATE ----------------------------------------------------
  if new.status is distinct from old.status
     and new.status in ('resolved', 'closed') then
    perform enqueue_email(
      new.org_id, new.created_by, 'support_ticket_user', 'support',
      jsonb_build_object(
        'template_type', 'support_ticket_user',
        'subject', 'Your support request was ' || new.status,
        'headline', 'Your support request was ' || new.status,
        'message', 'Your request "' || new.subject || '" has been marked ' || new.status
                   || '. If you still need help, reopen it or raise a new request from the support page.',
        'cta_label', 'View request', 'cta_path', '/support'
      ),
      'ticket:' || new.id::text || ':' || new.status, 'support_ticket', new.id
    );
    return new;
  end if;

  if new.admin_note is distinct from old.admin_note
     and coalesce(new.admin_note, '') <> '' then
    perform enqueue_email(
      new.org_id, new.created_by, 'support_ticket_user', 'support',
      jsonb_build_object(
        'template_type', 'support_ticket_user',
        'subject', 'Update on your support request',
        'headline', 'There''s an update on your support request',
        'message', 'Your office admins have added an update to your request "' || new.subject
                   || '". Open the support page to read it.',
        'cta_label', 'View request', 'cta_path', '/support'
      ),
      -- md5 so repeated replies each get their own email
      'ticket:' || new.id::text || ':reply:' || md5(coalesce(new.admin_note, '')), 'support_ticket', new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists support_tickets_email on support_tickets;
create trigger support_tickets_email
  after insert or update on support_tickets
  for each row execute function support_ticket_email_notify();
