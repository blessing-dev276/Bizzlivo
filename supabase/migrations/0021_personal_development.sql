-- ============================================================
-- Personal Development (Training pillar): the office links required
-- resources — books/PDFs, podcasts, videos, all pulled from the existing
-- `resources` library — that every member is expected to consume daily.
-- The required list is org-wide (one shared list, not per-member
-- targeting), matching onboarding_settings' one-row-per-org shape.
-- Completion resets daily: personal_development_completions is keyed by
-- calendar day, so a resource marked done today needs marking again
-- tomorrow — that's what makes this a recurring task instead of a
-- one-time onboarding-style checklist.
-- ============================================================

create table personal_development_resources (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  resource_id  uuid not null references resources(id) on delete cascade,
  added_by     uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  unique (org_id, resource_id)
);

create table personal_development_completions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  resource_id   uuid not null references resources(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  completed_on  date not null,
  created_at    timestamptz not null default now(),
  unique (resource_id, user_id, completed_on)
);

alter table personal_development_resources enable row level security;
alter table personal_development_completions enable row level security;

create policy "org members can read required daily resources"
  on personal_development_resources for select
  using (is_org_member(org_id));

create policy "owners/admins manage required daily resources"
  on personal_development_resources for all
  using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members manage their own daily completions"
  on personal_development_completions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owners/admins read all daily completions in their org"
  on personal_development_completions for select
  using (has_org_role(org_id, array['owner', 'admin']));
