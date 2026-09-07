-- ============================================================
-- 0052 — Help & Support (Phase 10).
--
-- One lightweight table. A ticket is a single record: the member files it,
-- an office admin works it and can leave an admin_note. No message thread
-- (deliberately not a Zendesk clone). Platform admins can read every
-- ticket for a future Super Admin → Support view.
-- ============================================================

create table support_tickets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  created_by  uuid not null references profiles(id) on delete cascade,
  category    text not null default 'question'
    check (category in ('bug', 'question', 'billing', 'feature_request', 'other')),
  subject     text not null,
  description text not null,
  priority    text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status      text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  admin_note  text,
  handled_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index support_tickets_org_idx on support_tickets (org_id, status, created_at desc);
create index support_tickets_creator_idx on support_tickets (created_by, created_at desc);

alter table support_tickets enable row level security;

-- creator: reads own always; may create; may edit only while 'open'
create policy "members read their own tickets"
  on support_tickets for select using (created_by = auth.uid());
create policy "members create their own tickets"
  on support_tickets for insert
  with check (created_by = auth.uid() and is_org_member(org_id) and status = 'open');
create policy "members edit their own open tickets"
  on support_tickets for update
  using (created_by = auth.uid() and status = 'open')
  with check (created_by = auth.uid());

-- office admin: full read + work tickets in their org
create policy "office admins read org tickets"
  on support_tickets for select using (has_org_role(org_id, array['admin']));
create policy "office admins work org tickets"
  on support_tickets for update
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

-- platform admin: read everything
create policy "platform admins read all tickets"
  on support_tickets for select using (is_platform_admin());
