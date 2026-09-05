-- ============================================================
-- Skill Development: Trainers. A class can have any number of
-- trainers, and the same trainer (any active org member — no
-- restriction to the 'instructor' role, since offices often have
-- members who train without holding that admin-ish role) can be
-- attached to any number of classes. Purely a join table; trainer
-- identity/contact info is whatever's already on `profiles`.
--
-- This is what powers "Meet your trainer" on the member-facing class
-- page, and the "ask your trainer a question" contact action, which
-- reuses the existing `notifications` table/policies (0011) rather
-- than introducing a messaging system — it's a one-off in-app ping
-- from a member to a trainer, not a live chat thread.
-- ============================================================

create table class_trainers (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references classes(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  added_by    uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  unique (class_id, user_id)
);

alter table class_trainers enable row level security;

create policy "org admins manage class trainers"
  on class_trainers for all
  using (exists (
    select 1 from classes c where c.id = class_trainers.class_id
      and has_org_role(c.org_id, array['owner', 'admin', 'instructor'])
  ))
  with check (exists (
    select 1 from classes c where c.id = class_trainers.class_id
      and has_org_role(c.org_id, array['owner', 'admin', 'instructor'])
  ));

create policy "org members read trainers of published classes"
  on class_trainers for select
  using (exists (
    select 1 from classes c where c.id = class_trainers.class_id
      and c.status = 'published' and is_org_member(c.org_id)
  ));
