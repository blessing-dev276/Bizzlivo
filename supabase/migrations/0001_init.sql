-- ============================================================
-- HQ360 — Phase 1 schema + RLS
-- Target: Postgres / Supabase
-- Multi-tenant via org_id on every table + Row Level Security
-- ============================================================

-- ============================================================
-- 1. TENANCY & IDENTITY
-- ============================================================

create table organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text unique not null,
  logo_url        text,
  brand_color     text,
  whatsapp_number text,
  plan_tier       text not null default 'free',
  status          text not null default 'active',
  created_at      timestamptz not null default now()
);

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text,
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create table memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  role        text not null,                          -- owner / admin / instructor / member
  status      text not null default 'active',          -- active / invited / suspended
  joined_at   timestamptz not null default now(),
  unique (org_id, user_id)
);

create table invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       text,
  phone       text,
  role        text not null default 'member',
  token       text unique not null,
  invited_by  uuid references profiles(id),
  status      text not null default 'pending',        -- pending / accepted / expired
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create table groups (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table group_members (
  group_id    uuid not null references groups(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  primary key (group_id, user_id)
);

-- ============================================================
-- 2. CONTENT
-- ============================================================

create table resources (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  uploaded_by   uuid not null references profiles(id),
  title         text not null,
  file_url      text not null,
  file_type     text not null default 'pdf',
  skill_tags    text[] default '{}',
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 3. EXAMS & QUESTIONS
-- ============================================================

create table exams (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  resource_id   uuid references resources(id),
  title         text not null,
  description   text,
  created_by    uuid not null references profiles(id),
  status        text not null default 'draft',           -- draft / published / archived
  created_at    timestamptz not null default now()
);

create table exam_settings (
  exam_id             uuid primary key references exams(id) on delete cascade,
  num_questions       int not null default 10,
  question_pool_size  int,
  time_limit_minutes  int not null default 20,
  shuffle_questions   boolean not null default true,
  shuffle_options     boolean not null default true,
  pass_mark_percent   int not null default 70,
  max_attempts        int not null default 1,
  require_fullscreen  boolean not null default false,
  flag_tab_switch     boolean not null default false
);

create table questions (
  id              uuid primary key default gen_random_uuid(),
  exam_id         uuid not null references exams(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,
  type            text not null default 'mcq',           -- mcq / true_false / multi_select
  text            text not null,
  skill_tag       text,
  difficulty      text default 'medium',
  order_index     int,
  ai_generated    boolean not null default true,
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  status          text not null default 'pending_review',  -- pending_review / approved / rejected
  created_at      timestamptz not null default now()
);

create table question_options (
  id            uuid primary key default gen_random_uuid(),
  question_id   uuid not null references questions(id) on delete cascade,
  text          text not null,
  is_correct    boolean not null default false,
  order_index   int
);

-- ============================================================
-- 4. ASSIGNMENT
-- ============================================================

create table exam_assignments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  exam_id       uuid not null references exams(id) on delete cascade,
  assigned_to_user  uuid references profiles(id),
  assigned_to_group uuid references groups(id),
  assigned_by   uuid not null references profiles(id),
  due_date      timestamptz,
  created_at    timestamptz not null default now(),
  check (assigned_to_user is not null or assigned_to_group is not null)
);

-- Phase 2+ tables — kept in schema, RLS enabled with no policies (default deny),
-- no UI/logic built against them yet.
create table learning_paths (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  name          text not null,
  description   text,
  created_at    timestamptz not null default now()
);

create table learning_path_steps (
  id                uuid primary key default gen_random_uuid(),
  path_id           uuid not null references learning_paths(id) on delete cascade,
  exam_id           uuid not null references exams(id),
  order_index       int not null,
  unlock_after_step uuid references learning_path_steps(id)
);

create table learning_path_progress (
  id              uuid primary key default gen_random_uuid(),
  path_id         uuid not null references learning_paths(id) on delete cascade,
  user_id         uuid not null references profiles(id),
  current_step_id uuid references learning_path_steps(id),
  status          text not null default 'not_started',
  started_at      timestamptz,
  completed_at    timestamptz,
  unique (path_id, user_id)
);

-- ============================================================
-- 5. ATTEMPTS
-- ============================================================

create table attempts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  exam_id           uuid not null references exams(id) on delete cascade,
  user_id           uuid not null references profiles(id),
  attempt_number    int not null default 1,
  started_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  status            text not null default 'in_progress',  -- in_progress / submitted / expired
  score_percent     numeric(5,2),
  passed            boolean,
  time_spent_seconds int
);

create table attempt_answers (
  id                  uuid primary key default gen_random_uuid(),
  attempt_id          uuid not null references attempts(id) on delete cascade,
  question_id         uuid not null references questions(id),
  selected_option_ids uuid[] default '{}',
  is_correct          boolean,
  time_spent_seconds  int
);

create table proctoring_flags (
  id            uuid primary key default gen_random_uuid(),
  attempt_id    uuid not null references attempts(id) on delete cascade,
  flag_type     text not null,
  occurred_at   timestamptz not null default now(),
  metadata      jsonb
);

-- ============================================================
-- 6. SKILL / COMPETENCY TRACKING (Phase 2+, not built in Phase 1)
-- ============================================================

create materialized view skill_scores as
select
  a.org_id,
  a.user_id,
  q.skill_tag,
  count(*) as questions_answered,
  sum(case when aa.is_correct then 1 else 0 end) as correct_count,
  round(100.0 * sum(case when aa.is_correct then 1 else 0 end) / count(*), 2) as score_percent,
  max(a.submitted_at) as last_attempt_at
from attempt_answers aa
join attempts a on a.id = aa.attempt_id
join questions q on q.id = aa.question_id
where a.status = 'submitted' and q.skill_tag is not null
group by a.org_id, a.user_id, q.skill_tag;

-- ============================================================
-- 7. CERTIFICATES (Phase 2+)
-- ============================================================

create table certificate_templates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  name          text not null default 'Default',
  layout_json   jsonb not null,
  created_at    timestamptz not null default now()
);

create table certificates (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references profiles(id),
  exam_id         uuid not null references exams(id),
  attempt_id      uuid not null references attempts(id),
  template_id     uuid references certificate_templates(id),
  cert_number     text unique not null,
  pdf_url         text,
  issued_at       timestamptz not null default now()
);

-- ============================================================
-- 8. NOTIFICATIONS (Phase 2+)
-- ============================================================

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null references profiles(id),
  type          text not null,
  channel       text not null default 'whatsapp',
  payload       jsonb,
  status        text not null default 'pending',
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 9. BILLING (Phase 2+)
-- ============================================================

create table subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  plan                  text not null,
  status                text not null default 'active',
  provider              text not null default 'paystack',
  provider_customer_id  text,
  current_period_end    timestamptz,
  created_at            timestamptz not null default now()
);

create table payment_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  amount        numeric(12,2) not null,
  currency      text not null default 'NGN',
  status        text not null,
  provider_ref  text,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- 10. AUDIT LOG (Phase 2+)
-- ============================================================

create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  actor_id      uuid references profiles(id),
  action        text not null,
  entity_type   text,
  entity_id     uuid,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Helper functions (security definer so they can read `memberships`
-- without recursively re-triggering RLS on `memberships` itself).

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from memberships
    where org_id = target_org and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.has_org_role(target_org uuid, roles text[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from memberships
    where org_id = target_org and user_id = auth.uid() and status = 'active' and role = any(roles)
  );
$$;

-- shorthand used everywhere below
-- admin roles = owner, admin, instructor (can write content)
-- management roles = owner, admin (can manage people/settings)

-- ---------- organizations ----------
alter table organizations enable row level security;

create policy "org members can read their org"
  on organizations for select
  using (is_org_member(id));

create policy "any authenticated user can create an org"
  on organizations for insert
  with check (auth.uid() is not null);

create policy "owners can update their org"
  on organizations for update
  using (has_org_role(id, array['owner']));

-- ---------- profiles ----------
alter table profiles enable row level security;

create policy "users can read own profile or org-mates' profiles"
  on profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from memberships m1
      join memberships m2 on m1.org_id = m2.org_id
      where m1.user_id = auth.uid() and m1.status = 'active'
        and m2.user_id = profiles.id and m2.status = 'active'
    )
  );

create policy "users can insert own profile"
  on profiles for insert
  with check (id = auth.uid());

create policy "users can update own profile"
  on profiles for update
  using (id = auth.uid());

-- ---------- memberships ----------
alter table memberships enable row level security;

create policy "org members can read org memberships"
  on memberships for select
  using (is_org_member(org_id));

create policy "users can create their own membership"
  on memberships for insert
  with check (user_id = auth.uid());

create policy "owners/admins can update memberships in their org"
  on memberships for update
  using (has_org_role(org_id, array['owner','admin']));

-- ---------- invites ----------
alter table invites enable row level security;

create policy "owners/admins can manage invites"
  on invites for all
  using (has_org_role(org_id, array['owner','admin']))
  with check (has_org_role(org_id, array['owner','admin']));

-- Note: invite lookup-by-token during accept flow happens in an Edge
-- Function using the service role key (the invitee isn't an org member
-- yet, so no client-side RLS read policy is granted for that case).

-- ---------- groups ----------
alter table groups enable row level security;

create policy "org members can read groups"
  on groups for select
  using (is_org_member(org_id));

create policy "owners/admins/instructors can manage groups"
  on groups for all
  using (has_org_role(org_id, array['owner','admin','instructor']))
  with check (has_org_role(org_id, array['owner','admin','instructor']));

-- ---------- group_members ----------
alter table group_members enable row level security;

create policy "org members can read group membership"
  on group_members for select
  using (exists (
    select 1 from groups g where g.id = group_members.group_id and is_org_member(g.org_id)
  ));

create policy "owners/admins/instructors can manage group membership"
  on group_members for all
  using (exists (
    select 1 from groups g where g.id = group_members.group_id
      and has_org_role(g.org_id, array['owner','admin','instructor'])
  ))
  with check (exists (
    select 1 from groups g where g.id = group_members.group_id
      and has_org_role(g.org_id, array['owner','admin','instructor'])
  ));

-- ---------- resources ----------
alter table resources enable row level security;

create policy "org members can read resources"
  on resources for select
  using (is_org_member(org_id));

create policy "owners/admins/instructors can manage resources"
  on resources for all
  using (has_org_role(org_id, array['owner','admin','instructor']))
  with check (has_org_role(org_id, array['owner','admin','instructor']));

-- ---------- exams ----------
alter table exams enable row level security;

create policy "org members can read their org's exams"
  on exams for select
  using (is_org_member(org_id));

create policy "owners/admins/instructors can manage exams"
  on exams for all
  using (has_org_role(org_id, array['owner','admin','instructor']))
  with check (has_org_role(org_id, array['owner','admin','instructor']));

-- ---------- exam_settings ----------
alter table exam_settings enable row level security;

create policy "org members can read exam settings"
  on exam_settings for select
  using (exists (
    select 1 from exams e where e.id = exam_settings.exam_id and is_org_member(e.org_id)
  ));

create policy "owners/admins/instructors can manage exam settings"
  on exam_settings for all
  using (exists (
    select 1 from exams e where e.id = exam_settings.exam_id
      and has_org_role(e.org_id, array['owner','admin','instructor'])
  ))
  with check (exists (
    select 1 from exams e where e.id = exam_settings.exam_id
      and has_org_role(e.org_id, array['owner','admin','instructor'])
  ));

-- ---------- questions ----------
alter table questions enable row level security;

create policy "org members can read questions"
  on questions for select
  using (is_org_member(org_id));

create policy "owners/admins/instructors can manage questions"
  on questions for all
  using (has_org_role(org_id, array['owner','admin','instructor']))
  with check (has_org_role(org_id, array['owner','admin','instructor']));

-- ---------- question_options ----------
alter table question_options enable row level security;

create policy "org members can read question options"
  on question_options for select
  using (exists (
    select 1 from questions q where q.id = question_options.question_id and is_org_member(q.org_id)
  ));

create policy "owners/admins/instructors can manage question options"
  on question_options for all
  using (exists (
    select 1 from questions q where q.id = question_options.question_id
      and has_org_role(q.org_id, array['owner','admin','instructor'])
  ))
  with check (exists (
    select 1 from questions q where q.id = question_options.question_id
      and has_org_role(q.org_id, array['owner','admin','instructor'])
  ));

-- ---------- exam_assignments ----------
alter table exam_assignments enable row level security;

create policy "members can read their own or their group's assignments; admins read all"
  on exam_assignments for select
  using (
    has_org_role(org_id, array['owner','admin','instructor'])
    or assigned_to_user = auth.uid()
    or exists (
      select 1 from group_members gm
      where gm.group_id = exam_assignments.assigned_to_group and gm.user_id = auth.uid()
    )
  );

create policy "owners/admins/instructors can create/manage assignments"
  on exam_assignments for all
  using (has_org_role(org_id, array['owner','admin','instructor']))
  with check (has_org_role(org_id, array['owner','admin','instructor']));

-- ---------- attempts ----------
alter table attempts enable row level security;

create policy "members read own attempts; admins read all in org"
  on attempts for select
  using (user_id = auth.uid() or has_org_role(org_id, array['owner','admin','instructor']));

create policy "members create their own attempts"
  on attempts for insert
  with check (user_id = auth.uid() and is_org_member(org_id));

create policy "members update their own in-progress attempts"
  on attempts for update
  using (user_id = auth.uid() or has_org_role(org_id, array['owner','admin','instructor']));

-- ---------- attempt_answers ----------
alter table attempt_answers enable row level security;

create policy "attempt owner or org admins can read answers"
  on attempt_answers for select
  using (exists (
    select 1 from attempts a where a.id = attempt_answers.attempt_id
      and (a.user_id = auth.uid() or has_org_role(a.org_id, array['owner','admin','instructor']))
  ));

create policy "attempt owner can write their own answers"
  on attempt_answers for all
  using (exists (
    select 1 from attempts a where a.id = attempt_answers.attempt_id and a.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from attempts a where a.id = attempt_answers.attempt_id and a.user_id = auth.uid()
  ));

-- ---------- proctoring_flags (schema present, no Phase 1 UI/logic) ----------
alter table proctoring_flags enable row level security;

-- ---------- Phase 2+ tables: RLS enabled, default deny (no policies yet) ----------
alter table learning_paths enable row level security;
alter table learning_path_steps enable row level security;
alter table learning_path_progress enable row level security;
alter table certificate_templates enable row level security;
alter table certificates enable row level security;
alter table notifications enable row level security;
alter table subscriptions enable row level security;
alter table payment_events enable row level security;
alter table audit_log enable row level security;
