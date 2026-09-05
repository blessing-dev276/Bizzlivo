-- ============================================================
-- Onboarding rework: the office's real flow is Business Explanation ->
-- Network Varsity -> Office Policy -> Registration Link (not the
-- Policy-first order 0020 shipped with), and every step except
-- Registration can hold *several* resources — any mix of PDFs, videos,
-- and external links — instead of exactly one file.
--
-- Replaces onboarding_settings' one-file-per-step columns with
-- onboarding_step_items (many rows per org+step). Checked the only live
-- org's onboarding_settings row before writing this: policy/business/
-- varsity file paths were all still null (nothing uploaded yet under the
-- old model), so there's nothing to backfill — the columns are dropped
-- outright. registration_link is untouched; Registration stays a single
-- link, same as before. onboarding_progress is untouched too — it's
-- still one self-reported timestamp per step, just reordered on screen.
-- ============================================================

create table onboarding_step_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  step         text not null, -- business_explanation / network_varsity / office_policy
  type         text not null, -- pdf / video / link
  title        text not null,
  file_path    text, -- storage path in the `onboarding` bucket, for pdf/video
  link_url     text, -- external url, for type = 'link'
  order_index  int not null default 0,
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  check (step in ('business_explanation', 'network_varsity', 'office_policy')),
  check (
    (type in ('pdf', 'video') and file_path is not null and link_url is null)
    or (type = 'link' and link_url is not null and file_path is null)
  )
);

alter table onboarding_settings drop column policy_file_path;
alter table onboarding_settings drop column business_explanation_type;
alter table onboarding_settings drop column business_explanation_file_path;
alter table onboarding_settings drop column network_varsity_file_path;

alter table onboarding_step_items enable row level security;

create policy "org members can read onboarding step items"
  on onboarding_step_items for select
  using (is_org_member(org_id));

create policy "owners/admins manage onboarding step items"
  on onboarding_step_items for all
  using (has_org_role(org_id, array['owner', 'admin']))
  with check (has_org_role(org_id, array['owner', 'admin']));

-- Storage bucket/policies from 0020 are unchanged — still keyed off the
-- org_id first path segment, which every item's file_path still starts
-- with (now org_id/{step}/{item_id}.{ext} instead of a fixed filename,
-- since a step can have more than one file now).
