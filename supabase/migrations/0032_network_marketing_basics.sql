-- ============================================================
-- NeoLife Basics (Network Marketing pillar): the office-curated list of
-- foundational NeoLife training resources (e.g. Sound Health, Cool Wealth,
-- Fact About Life…) members work through before/alongside Products.
-- Same shape and RLS as network_marketing_products — see 0028.
--
-- Guarded with IF NOT EXISTS / exception-swallowed DO blocks: a prior,
-- unrecorded migration run already created this table on the linked
-- project (discovered via migration history drift — see 0030's repair to
-- "reverted" in the same session), so this needs to be safe to (re-)apply
-- without erroring on objects that already exist.
-- ============================================================

create table if not exists network_marketing_basics (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  title        text not null,
  description  text,
  link_url     text,
  added_by     uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);

alter table network_marketing_basics enable row level security;

do $$ begin
  create policy "org members can read basics"
    on network_marketing_basics for select
    using (is_org_member(org_id));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "owners/admins manage basics"
    on network_marketing_basics for all
    using (has_org_role(org_id, array['admin']))
    with check (has_org_role(org_id, array['admin']));
exception when duplicate_object then null;
end $$;
