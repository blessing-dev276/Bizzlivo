-- ============================================================
-- HQ360 — role model v2: exactly four roles going forward —
-- Member, Trainer, Team Leader, Admin.
--
-- - 'owner' collapses into 'admin' (org creator is just an Admin like
--   any other; billing/org-settings checks that were owner-only become
--   admin-only — there's no remaining "only the founder" tier).
-- - 'instructor' is renamed 'trainer' (the UI already labeled it
--   "Trainer" everywhere — see Invites.tsx's ROLE_LABEL — this just
--   makes the stored value match).
-- - 'team_leader' is a new, formally assignable role (promoted the same
--   way Trainer/Admin are, via the members role picker) rather than the
--   purely-derived-from-groups.leader_id status it was before. Existing
--   members who already lead a group are promoted here so nothing looks
--   demoted the moment this ships. Note this is additive to, not a
--   replacement for, 0015_team_leader_access.sql's group-scoped read
--   policies — those still key off `groups.leader_id`, which a Team
--   Leader still needs to be set as (via Team Performance) to actually
--   see their team's data; the role value alone is the org-wide label/
--   permission tier, same as how Trainer is a label plus (separately)
--   class_trainers assignment.
--
-- Every RLS policy that hard-coded 'owner'/'instructor' as a literal in
-- its role array is rewritten below via ALTER POLICY so the check still
-- matches real data post-rename. Policies whose array already included
-- 'admin' alongside 'owner' don't strictly need the ALTER (admin already
-- matches), but are included anyway for a single source of truth — no
-- policy is left referencing a role value that can no longer exist.
-- Policy *names* keep their original "owners/admins/instructors" wording
-- (renaming ~45 policies for a cosmetic label isn't worth the extra risk
-- in a single migration) — only the role arrays they check change.
-- ============================================================

-- ---------- data migration ----------
update memberships set role = 'admin' where role = 'owner';
update memberships set role = 'trainer' where role = 'instructor';

-- Anyone currently leading a group but still plain 'member' becomes a
-- formal Team Leader — matches what they already functionally are.
update memberships m
set role = 'team_leader'
where role = 'member'
  and exists (
    select 1 from groups g where g.leader_id = m.user_id and g.org_id = m.org_id
  );

alter table memberships add constraint memberships_role_check
  check (role in ('admin', 'trainer', 'team_leader', 'member'));

-- ---------- organizations ----------
alter policy "owners can update their org" on organizations
  using (has_org_role(id, array['admin']));

-- ---------- memberships ----------
alter policy "owners/admins can update memberships in their org" on memberships
  using (has_org_role(org_id, array['admin']));

-- ---------- invites ----------
alter policy "owners/admins can manage invites" on invites
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

-- ---------- groups / group_members ----------
alter policy "owners/admins/instructors can manage groups" on groups
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

alter policy "owners/admins/instructors can manage group membership" on group_members
  using (exists (
    select 1 from groups g where g.id = group_members.group_id
      and has_org_role(g.org_id, array['admin','trainer'])
  ))
  with check (exists (
    select 1 from groups g where g.id = group_members.group_id
      and has_org_role(g.org_id, array['admin','trainer'])
  ));

-- ---------- resources ----------
alter policy "owners/admins/instructors can manage resources" on resources
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

-- ---------- exams / exam_settings / questions / question_options ----------
alter policy "owners/admins/instructors can manage exams" on exams
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

alter policy "owners/admins/instructors can manage exam settings" on exam_settings
  using (exists (
    select 1 from exams e where e.id = exam_settings.exam_id
      and has_org_role(e.org_id, array['admin','trainer'])
  ))
  with check (exists (
    select 1 from exams e where e.id = exam_settings.exam_id
      and has_org_role(e.org_id, array['admin','trainer'])
  ));

alter policy "owners/admins/instructors can manage questions" on questions
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

alter policy "owners/admins/instructors can manage question options" on question_options
  using (exists (
    select 1 from questions q where q.id = question_options.question_id
      and has_org_role(q.org_id, array['admin','trainer'])
  ))
  with check (exists (
    select 1 from questions q where q.id = question_options.question_id
      and has_org_role(q.org_id, array['admin','trainer'])
  ));

-- ---------- exam_assignments ----------
alter policy "members can read their own or their group's assignments; admins read all" on exam_assignments
  using (
    has_org_role(org_id, array['admin','trainer'])
    or assigned_to_user = auth.uid()
    or exists (
      select 1 from group_members gm
      where gm.group_id = exam_assignments.assigned_to_group and gm.user_id = auth.uid()
    )
  );

alter policy "owners/admins/instructors can create/manage assignments" on exam_assignments
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

-- ---------- attempts / attempt_answers ----------
alter policy "members read own attempts; admins read all in org" on attempts
  using (user_id = auth.uid() or has_org_role(org_id, array['admin','trainer']));

alter policy "members update their own in-progress attempts" on attempts
  using (user_id = auth.uid() or has_org_role(org_id, array['admin','trainer']));

alter policy "org admins can create attempts for their org's members" on attempts
  with check (
    has_org_role(org_id, array['admin','trainer'])
    and exists (
      select 1 from memberships m
      where m.org_id = attempts.org_id and m.user_id = attempts.user_id and m.status = 'active'
    )
  );

alter policy "attempt owner or org admins can read answers" on attempt_answers
  using (exists (
    select 1 from attempts a where a.id = attempt_answers.attempt_id
      and (a.user_id = auth.uid() or has_org_role(a.org_id, array['admin','trainer']))
  ));

-- ---------- storage: resources bucket ----------
alter policy "owners/admins/instructors can upload resource files" on storage.objects
  with check (
    bucket_id = 'resources'
    and has_org_role((storage.foldername(name))[1]::uuid, array['admin','trainer'])
  );

alter policy "owners/admins/instructors can delete resource files" on storage.objects
  using (
    bucket_id = 'resources'
    and has_org_role((storage.foldername(name))[1]::uuid, array['admin','trainer'])
  );

-- ---------- pending_members ----------
alter policy "owners/admins can read pending members" on pending_members
  using (has_org_role(org_id, array['admin']));

alter policy "owners/admins can update pending members" on pending_members
  using (has_org_role(org_id, array['admin']));

-- ---------- coursework_assignments / targets / submissions ----------
alter policy "org admins manage coursework assignments" on coursework_assignments
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

alter policy "targeted members can read their assignment" on coursework_assignments
  using (
    has_org_role(org_id, array['admin','trainer'])
    or exists (
      select 1 from coursework_targets t
      where t.assignment_id = coursework_assignments.id
        and (t.assigned_to_user = auth.uid()
             or exists (select 1 from group_members gm where gm.group_id = t.assigned_to_group and gm.user_id = auth.uid()))
    )
  );

alter policy "org admins manage coursework targets" on coursework_targets
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

alter policy "members read their own or their group's coursework targets" on coursework_targets
  using (
    has_org_role(org_id, array['admin','trainer'])
    or assigned_to_user = auth.uid()
    or exists (select 1 from group_members gm where gm.group_id = coursework_targets.assigned_to_group and gm.user_id = auth.uid())
  );

alter policy "admins manage all coursework submissions" on coursework_submissions
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

alter policy "members read their own coursework submission" on coursework_submissions
  using (user_id = auth.uid() or has_org_role(org_id, array['admin','trainer']));

-- ---------- notifications ----------
alter policy "anyone can notify an org's admins of a join request" on notifications
  with check (
    type = 'join_request'
    and exists (
      select 1 from memberships m
      where m.org_id = notifications.org_id
        and m.user_id = notifications.user_id
        and m.status = 'active'
        and m.role in ('admin', 'trainer')
    )
  );

-- ---------- learning_paths / steps / progress ----------
alter policy "org admins manage learning paths" on learning_paths
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

alter policy "org admins manage learning path steps" on learning_path_steps
  using (exists (
    select 1 from learning_paths p where p.id = learning_path_steps.path_id
      and has_org_role(p.org_id, array['admin','trainer'])
  ))
  with check (exists (
    select 1 from learning_paths p where p.id = learning_path_steps.path_id
      and has_org_role(p.org_id, array['admin','trainer'])
  ));

alter policy "org admins read learning path progress" on learning_path_progress
  using (
    user_id = auth.uid()
    or exists (
      select 1 from learning_paths p where p.id = learning_path_progress.path_id
        and has_org_role(p.org_id, array['admin','trainer'])
    )
  );

-- ---------- events / event_attendees ----------
alter policy "owners/admins/instructors can manage events" on events
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

alter policy "org admins manage event attendees" on event_attendees
  using (exists (
    select 1 from events e where e.id = event_attendees.event_id
      and has_org_role(e.org_id, array['admin','trainer'])
  ))
  with check (exists (
    select 1 from events e where e.id = event_attendees.event_id
      and has_org_role(e.org_id, array['admin','trainer'])
  ));

-- ---------- onboarding_settings / onboarding_progress / onboarding_step_items ----------
alter policy "owners/admins manage onboarding settings" on onboarding_settings
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

alter policy "owners/admins read all onboarding progress in their org" on onboarding_progress
  using (has_org_role(org_id, array['admin']));

alter policy "owners/admins manage onboarding step items" on onboarding_step_items
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

-- ---------- storage: onboarding bucket ----------
alter policy "owners/admins can upload onboarding files" on storage.objects
  with check (
    bucket_id = 'onboarding'
    and has_org_role((storage.foldername(name))[1]::uuid, array['admin'])
  );

alter policy "owners/admins can update onboarding files" on storage.objects
  using (
    bucket_id = 'onboarding'
    and has_org_role((storage.foldername(name))[1]::uuid, array['admin'])
  );

alter policy "owners/admins can delete onboarding files" on storage.objects
  using (
    bucket_id = 'onboarding'
    and has_org_role((storage.foldername(name))[1]::uuid, array['admin'])
  );

-- ---------- personal_development ----------
alter policy "owners/admins manage required daily resources" on personal_development_resources
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

alter policy "owners/admins read all daily completions in their org" on personal_development_completions
  using (has_org_role(org_id, array['admin']));

-- ---------- skill development: classes / modules / items / progress ----------
alter policy "org admins manage classes" on classes
  using (has_org_role(org_id, array['admin','trainer']))
  with check (has_org_role(org_id, array['admin','trainer']));

alter policy "org admins manage class modules" on class_modules
  using (exists (
    select 1 from classes c where c.id = class_modules.class_id
      and has_org_role(c.org_id, array['admin','trainer'])
  ))
  with check (exists (
    select 1 from classes c where c.id = class_modules.class_id
      and has_org_role(c.org_id, array['admin','trainer'])
  ));

alter policy "org admins manage class module items" on class_module_items
  using (exists (
    select 1 from class_modules m where m.id = class_module_items.module_id
      and has_org_role(m.org_id, array['admin','trainer'])
  ))
  with check (exists (
    select 1 from class_modules m where m.id = class_module_items.module_id
      and has_org_role(m.org_id, array['admin','trainer'])
  ));

alter policy "owners/admins read all class progress in their org" on class_item_progress
  using (has_org_role(org_id, array['admin','trainer']));

-- ---------- class_trainers (0026) ----------
alter policy "org admins manage class trainers" on class_trainers
  using (exists (
    select 1 from classes c where c.id = class_trainers.class_id
      and has_org_role(c.org_id, array['admin','trainer'])
  ))
  with check (exists (
    select 1 from classes c where c.id = class_trainers.class_id
      and has_org_role(c.org_id, array['admin','trainer'])
  ));

-- ---------- income_development ----------
alter policy "owners/admins manage income skill catalog" on income_development_resources
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

alter policy "owners/admins read all income progress in their org" on income_development_progress
  using (has_org_role(org_id, array['admin']));

alter policy "owners/admins read all portfolio items in their org" on income_development_portfolio_items
  using (has_org_role(org_id, array['admin']));

alter policy "owners/admins read all income entries in their org" on income_development_income_entries
  using (has_org_role(org_id, array['admin']));

-- ---------- billing functions ----------
create or replace function public.start_trial(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['admin']) then
    raise exception 'Not authorized.';
  end if;

  if exists (select 1 from subscriptions where org_id = target_org_id) then
    return;
  end if;

  insert into subscriptions (org_id, plan, status, provider, trial_ends_at)
  values (target_org_id, 'growth', 'trialing', 'paystack', now() + interval '14 days');

  update organizations set plan_tier = 'growth' where id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'trial_started', 'organizations', target_org_id);
end;
$$;

create or replace function public.sync_subscription_status(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['admin', 'trainer', 'team_leader', 'member']) then
    raise exception 'Not authorized.';
  end if;

  update subscriptions
  set status = 'expired'
  where org_id = target_org_id
    and status = 'trialing'
    and trial_ends_at < now();

  update subscriptions
  set status = 'expired'
  where org_id = target_org_id
    and status = 'active'
    and current_period_end < now();

  update organizations
  set plan_tier = 'free'
  where id = target_org_id
    and plan_tier != 'free'
    and exists (
      select 1 from subscriptions
      where org_id = target_org_id and status = 'expired'
    );
end;
$$;

create or replace function public.request_cancel_subscription(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['admin']) then
    raise exception 'Not authorized.';
  end if;

  update subscriptions set cancel_at_period_end = true where org_id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'subscription_cancel_requested', 'organizations', target_org_id);
end;
$$;

create or replace function public.downgrade_to_free_now(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_org_role(target_org_id, array['admin']) then
    raise exception 'Not authorized.';
  end if;

  update subscriptions set status = 'canceled', cancel_at_period_end = true where org_id = target_org_id;
  update organizations set plan_tier = 'free' where id = target_org_id;

  insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'downgraded_to_free', 'organizations', target_org_id);
end;
$$;

create or replace function public.get_org_usage(target_org_id uuid)
returns table (
  plan                            text,
  status                          text,
  billing_cycle                   text,
  trial_ends_at                   timestamptz,
  current_period_end              timestamptz,
  cancel_at_period_end            boolean,
  max_members                     integer,
  member_count                    bigint,
  max_resources                   integer,
  resource_count                  bigint,
  max_published_exams             integer,
  published_exam_count            bigint,
  ai_exam_generations_per_month   integer,
  ai_exam_generations_used        bigint,
  ai_questions_per_month          integer,
  ai_questions_used               bigint,
  removes_badge                   boolean,
  custom_branding                 boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.plan_tier,
    s.status,
    s.billing_cycle,
    s.trial_ends_at,
    s.current_period_end,
    coalesce(s.cancel_at_period_end, false),
    pl.max_members,
    (select count(*) from memberships m where m.org_id = o.id and m.status = 'active'),
    pl.max_resources,
    (select count(*) from resources r where r.org_id = o.id),
    pl.max_published_exams,
    (select count(*) from exams e where e.org_id = o.id and e.status = 'published'),
    pl.ai_exam_generations_per_month,
    (select count(*) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())),
    pl.ai_questions_per_month,
    (select coalesce(sum(u.question_count), 0) from ai_usage_events u where u.org_id = o.id and u.created_at >= date_trunc('month', now())),
    pl.removes_badge,
    pl.custom_branding
  from organizations o
  join plan_limits pl on pl.plan = o.plan_tier
  left join subscriptions s on s.org_id = o.id
  where o.id = target_org_id
    and has_org_role(o.id, array['admin', 'trainer', 'team_leader', 'member']);
$$;
