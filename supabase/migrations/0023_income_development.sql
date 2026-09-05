-- ============================================================
-- Income Development (Training pillar): helps members go from "learning a
-- digital skill" to "earning first income" before they move on to Network
-- Marketing. Follows the same shape as the other pillars:
--   - income_development_resources: org-wide skill/learning catalog, linked
--     from the existing `resources` library (same pattern as
--     personal_development_resources).
--   - income_development_progress: one row per org+user, nullable
--     timestamp per milestone — a linear checklist like onboarding_progress.
--   - income_development_portfolio_items: member-owned portfolio entries
--     (freeform, no admin approval needed to start freelancing).
--   - income_development_income_entries: member-owned income log used to
--     derive "first income" and running totals.
-- ============================================================

create table income_development_resources (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  resource_id  uuid not null references resources(id) on delete cascade,
  added_by     uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  unique (org_id, resource_id)
);

create table income_development_progress (
  org_id                 uuid not null references organizations(id) on delete cascade,
  user_id                uuid not null references profiles(id) on delete cascade,
  skill_selected_at      timestamptz,
  skill_name             text,
  portfolio_built_at     timestamptz,
  freelancing_started_at timestamptz,
  first_income_at        timestamptz,
  consistency_at         timestamptz,
  updated_at             timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table income_development_portfolio_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  title        text not null,
  description  text,
  link_url     text,
  created_at   timestamptz not null default now()
);

create table income_development_income_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  amount       numeric(12, 2) not null check (amount > 0),
  source       text,
  earned_on    date not null,
  note         text,
  created_at   timestamptz not null default now()
);

alter table income_development_resources enable row level security;
alter table income_development_progress enable row level security;
alter table income_development_portfolio_items enable row level security;
alter table income_development_income_entries enable row level security;

create policy "org members can read income skill catalog"
  on income_development_resources for select
  using (is_org_member(org_id));

create policy "owners/admins manage income skill catalog"
  on income_development_resources for all
  using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members manage their own income progress"
  on income_development_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owners/admins read all income progress in their org"
  on income_development_progress for select
  using (has_org_role(org_id, array['owner', 'admin']));

create policy "members manage their own portfolio items"
  on income_development_portfolio_items for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owners/admins read all portfolio items in their org"
  on income_development_portfolio_items for select
  using (has_org_role(org_id, array['owner', 'admin']));

create policy "members manage their own income entries"
  on income_development_income_entries for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owners/admins read all income entries in their org"
  on income_development_income_entries for select
  using (has_org_role(org_id, array['owner', 'admin']));
