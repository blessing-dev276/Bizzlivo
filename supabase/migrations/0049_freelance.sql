-- ============================================================
-- 0049 — Freelance Workspace (Phase 1 of the "connected OS" work).
--
-- The Network Marketing side has My Network (contacts / follow-ups /
-- downline). Freelancing had only Learning Center + Finance. This adds the
-- member-facing operational CRM: freelance prospects → clients → projects.
--
-- Deliberately SEPARATE from network_marketing_contacts — different
-- domain (platform / service / order value / links to a real Finance
-- order), different RLS shape not worth overloading a stage enum for.
--
-- Money stays in Finance: freelance_projects.finance_order_id is an
-- OPTIONAL link to an admin-verified finance_orders row. Nothing here
-- creates withdrawable funds; finance_record_order (admin-only, 0043)
-- remains the single path for that.
--
-- RLS mirrors goals v2: member manages own rows, admin reads org-wide,
-- team leader reads their own team's members' rows.
-- ============================================================

-- ---------- clients ----------
create table freelance_clients (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  member_id    uuid not null references profiles(id) on delete cascade,
  name         text not null,
  company      text,
  platform     text,
  contact_link text,
  services     text[] not null default '{}',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index freelance_clients_owner_idx on freelance_clients (org_id, member_id);

-- ---------- prospects (potential clients) ----------
create table freelance_prospects (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  member_id           uuid not null references profiles(id) on delete cascade,
  name                text not null,
  company             text,
  platform            text,                       -- free text; UI suggests Fiverr/Upwork/Contra/LinkedIn/Instagram/Direct/Referral/Other
  service             text,
  contact_link        text,
  status              text not null default 'lead'
    check (status in ('lead','contacted','replied','negotiating','proposal_sent','won','lost')),
  expected_value      numeric(14,2) check (expected_value >= 0),
  currency            text,
  source              text,
  last_contacted_at   timestamptz,
  next_follow_up_at   timestamptz,
  notes               text,
  converted_client_id uuid references freelance_clients(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index freelance_prospects_owner_idx on freelance_prospects (org_id, member_id, status);
create index freelance_prospects_followup_idx on freelance_prospects (org_id, member_id, next_follow_up_at);

-- ---------- projects / orders (actual work) ----------
create table freelance_projects (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  member_id         uuid not null references profiles(id) on delete cascade,
  client_id         uuid references freelance_clients(id) on delete set null,
  prospect_id       uuid references freelance_prospects(id) on delete set null,
  title             text not null,
  service           text,
  platform          text,
  order_value       numeric(14,2) check (order_value >= 0),
  currency          text,
  start_date        date,
  due_date          date,
  status            text not null default 'new'
    check (status in ('new','in_progress','delivered','revision','completed','cancelled')),
  notes             text,
  next_follow_up_at timestamptz,
  follow_up_note    text,
  finance_order_id  uuid references finance_orders(id) on delete set null,  -- optional link to the admin-verified earning
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index freelance_projects_owner_idx on freelance_projects (org_id, member_id, status);
create index freelance_projects_client_idx on freelance_projects (client_id);
create index freelance_projects_due_idx on freelance_projects (org_id, member_id, due_date);

-- ---------- lightweight per-record activity / follow-up log ----------
create table freelance_activities (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  member_id   uuid not null references profiles(id) on delete cascade,
  prospect_id uuid references freelance_prospects(id) on delete cascade,
  client_id   uuid references freelance_clients(id) on delete cascade,
  project_id  uuid references freelance_projects(id) on delete cascade,
  kind        text not null default 'note',   -- note | contact | status_change | follow_up | proposal
  note        text not null,
  created_at  timestamptz not null default now()
);
create index freelance_activities_owner_idx on freelance_activities (org_id, member_id, created_at desc);
create index freelance_activities_prospect_idx on freelance_activities (prospect_id, created_at desc);
create index freelance_activities_project_idx on freelance_activities (project_id, created_at desc);

-- ============================================================
-- RLS
-- ============================================================
alter table freelance_clients    enable row level security;
alter table freelance_prospects  enable row level security;
alter table freelance_projects   enable row level security;
alter table freelance_activities enable row level security;

do $$
declare t text;
begin
  foreach t in array array['freelance_clients','freelance_prospects','freelance_projects','freelance_activities']
  loop
    execute format($f$
      create policy "members manage their own %1$s"
        on %1$s for all
        using (member_id = auth.uid())
        with check (member_id = auth.uid());
    $f$, t);

    execute format($f$
      create policy "admins read %1$s in their org"
        on %1$s for select
        using (has_org_role(org_id, array['admin']));
    $f$, t);

    execute format($f$
      create policy "team leaders read their team's %1$s"
        on %1$s for select
        using (
          has_org_role(org_id, array['team_leader'])
          and exists (
            select 1 from groups g
            join group_members gm on gm.group_id = g.id
            where g.org_id = %1$s.org_id and g.leader_id = auth.uid() and gm.user_id = %1$s.member_id
          )
        );
    $f$, t);
  end loop;
end $$;
