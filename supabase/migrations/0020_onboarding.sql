-- ============================================================
-- HQ360 — Onboarding (Training > Onboarding pillar), built for real per
-- the office's actual process: Policy (PDF) -> Business Explanation
-- (PDF or video, office's choice) -> Network Varsity (video) ->
-- Registration (an external link the office pastes in, not a form built
-- here — NeoLife/the office's own registration system owns that step).
-- Content is uploaded per-office (not global), owner/admin only. Progress
-- is self-reported per step (no way to verify "watched the whole video"
-- or "actually registered" — a member just marks each step done, which is
-- consistent with a guided checklist, not a proctored gate).
-- ============================================================

create table onboarding_settings (
  org_id                          uuid primary key references organizations(id) on delete cascade,
  policy_file_path                text,
  business_explanation_type       text check (business_explanation_type in ('pdf', 'video')),
  business_explanation_file_path  text,
  network_varsity_file_path       text,
  registration_link               text,
  updated_at                      timestamptz not null default now()
);

create table onboarding_progress (
  org_id                          uuid not null references organizations(id) on delete cascade,
  user_id                         uuid not null references profiles(id) on delete cascade,
  policy_acknowledged_at          timestamptz,
  business_explanation_viewed_at  timestamptz,
  network_varsity_completed_at    timestamptz,
  registered_at                   timestamptz,
  primary key (org_id, user_id)
);

alter table onboarding_settings enable row level security;
alter table onboarding_progress enable row level security;

create policy "org members can read onboarding settings"
  on onboarding_settings for select
  using (is_org_member(org_id));

create policy "owners/admins manage onboarding settings"
  on onboarding_settings for all
  using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

create policy "members manage their own onboarding progress"
  on onboarding_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owners/admins read all onboarding progress in their org"
  on onboarding_progress for select
  using (has_org_role(org_id, array['owner', 'admin']));

-- ============================================================
-- Storage — `onboarding` bucket for the office-uploaded policy PDF,
-- business explanation file, and Network Varsity video.
-- Path convention: org_id/policy.pdf, org_id/business-explanation.(pdf|mp4),
-- org_id/network-varsity.mp4
-- ============================================================

insert into storage.buckets (id, name, public)
values ('onboarding', 'onboarding', false)
on conflict (id) do nothing;

create policy "org members can read their org's onboarding files"
  on storage.objects for select
  using (
    bucket_id = 'onboarding'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy "owners/admins can upload onboarding files"
  on storage.objects for insert
  with check (
    bucket_id = 'onboarding'
    and has_org_role((storage.foldername(name))[1]::uuid, array['owner', 'admin'])
  );

create policy "owners/admins can update onboarding files"
  on storage.objects for update
  using (
    bucket_id = 'onboarding'
    and has_org_role((storage.foldername(name))[1]::uuid, array['owner', 'admin'])
  );

create policy "owners/admins can delete onboarding files"
  on storage.objects for delete
  using (
    bucket_id = 'onboarding'
    and has_org_role((storage.foldername(name))[1]::uuid, array['owner', 'admin'])
  );
