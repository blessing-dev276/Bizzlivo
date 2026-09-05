-- ============================================================
-- Network Marketing (Training pillar, v1 slice): the day-to-day work of
-- a distributor — working contacts through a pipeline from first prospect
-- to a won customer or a recruited (won) distributor. Matches the shape of
-- the other Training pillars: admin manages a shared catalog (here,
-- Products) and reads an office-wide rollup; each member owns their own
-- pipeline data.
--
-- A "distributor" here is a CRM record on network_marketing_contacts, not
-- an actual HQ360 login/membership — recruiting someone in real life
-- doesn't create an org member, it's just a contact whose stage is
-- 'won_distributor'. "Team Building" (planned section) is simply that
-- member's own contacts filtered to won_distributor — unrelated to
-- groups/Team Performance, which tracks the *office's* internal teams.
--
-- Deferred to a later pass (per the Training.tsx roadmap note for this
-- pillar): Leadership, Recognition, detailed Reports, Settings, Academy
-- Integration, AI Mentor, Events/Notifications wiring.
-- ============================================================

create table network_marketing_products (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null,
  description  text,
  link_url     text,
  added_by     uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);

create table network_marketing_contacts (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organizations(id) on delete cascade,
  user_id                 uuid not null references profiles(id) on delete cascade,
  full_name               text not null,
  phone                   text,
  email                   text,
  stage                   text not null default 'prospect',
  interested_product_id   uuid references network_marketing_products(id) on delete set null,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (stage in ('prospect', 'invited', 'presented', 'followed_up', 'won_customer', 'won_distributor', 'lost'))
);
create index network_marketing_contacts_user_idx on network_marketing_contacts (org_id, user_id);

-- A timestamped log per contact — stage changes and free-form follow-up
-- notes both land here, which is what powers "Recent Activities" and a
-- readable follow-up history per contact (rather than overwriting a
-- single notes field every time).
create table network_marketing_activities (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  contact_id  uuid not null references network_marketing_contacts(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  note        text not null,
  stage       text,
  created_at  timestamptz not null default now(),
  check (stage is null or stage in ('prospect', 'invited', 'presented', 'followed_up', 'won_customer', 'won_distributor', 'lost'))
);
create index network_marketing_activities_contact_idx on network_marketing_activities (contact_id, created_at desc);

alter table network_marketing_products enable row level security;
alter table network_marketing_contacts enable row level security;
alter table network_marketing_activities enable row level security;

create policy "org members can read products"
  on network_marketing_products for select
  using (is_org_member(org_id));

create policy "owners/admins manage products"
  on network_marketing_products for all
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

create policy "members manage their own contacts"
  on network_marketing_contacts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owners/admins read all contacts in their org"
  on network_marketing_contacts for select
  using (has_org_role(org_id, array['admin']));

create policy "members manage their own contact activities"
  on network_marketing_activities for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owners/admins read all contact activities in their org"
  on network_marketing_activities for select
  using (has_org_role(org_id, array['admin']));
