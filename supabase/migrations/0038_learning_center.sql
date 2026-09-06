-- ============================================================
-- Learning Center v2 — one consistent Area → Section → Module → Item model
-- across four of the five areas, reusing classes / class_modules /
-- class_module_items (0022). Content is still a pointer at existing
-- resources / exams / coursework_assignments — nothing is duplicated.
--
-- Onboarding keeps its own tables (its own `onboarding` storage bucket,
-- step-gated onboarding_progress, and 0036's onboarding_item_progress) but
-- gains a Module grouping layer. Network Marketing Products keep their own
-- table (the network_marketing_contacts.interested_product_id FK is
-- load-bearing for the CRM) and gain Video / PDF / Quiz slots.
--
-- Nothing is dropped. `classes.purpose`, `onboarding_step_items.step`, and
-- `network_marketing_basics` all stay for rollback; a later migration
-- removes them once this is verified. NeoLife Basics rows are NOT migrated
-- in SQL — the NeoLife Basics builder offers a one-click import instead
-- (safer, reversible, visible), so the legacy table keeps working until
-- an admin imports.
-- ============================================================

-- ---------- classes: an area label + section ordering ----------
alter table classes add column area text;
alter table classes add column section_order int not null default 0;

-- Existing classes carry `purpose`. Per the redesign spec's own suggested
-- mapping, skill-development classes become Freelancing; income-development
-- classes stay Income Development. An admin can reclassify from the UI.
update classes set area = case purpose
  when 'skill_development'  then 'freelancing'
  when 'income_development' then 'income_development'
  else 'freelancing'
end
where area is null;

alter table classes
  add constraint classes_area_check
  check (area is null or area in ('onboarding', 'network_marketing', 'freelancing', 'personal_development', 'income_development'));

create index classes_org_area_idx on classes (org_id, area, section_order);

-- ---------- class_modules: description + module-level publish ----------
alter table class_modules add column description text;
alter table class_modules add column status text not null default 'published';
alter table class_modules
  add constraint class_modules_status_check check (status in ('draft', 'published'));

-- ---------- class_module_items: link + podcast content kinds ----------
alter table class_module_items add column link_url text;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'class_module_items'::regclass and contype = 'c'
  loop
    execute format('alter table class_module_items drop constraint %I', c.conname);
  end loop;
end $$;

alter table class_module_items
  add constraint class_module_items_type_check
    check (type in ('video', 'pdf', 'article', 'test', 'quiz', 'assignment', 'link', 'podcast')),
  add constraint class_module_items_pointer_check check (
    (type in ('video', 'pdf', 'podcast')
       and resource_id is not null and body is null and exam_id is null and coursework_assignment_id is null and link_url is null)
    or (type = 'article'
       and body is not null and resource_id is null and exam_id is null and coursework_assignment_id is null and link_url is null)
    or (type in ('test', 'quiz')
       and exam_id is not null and resource_id is null and body is null and coursework_assignment_id is null and link_url is null)
    or (type = 'assignment'
       and coursework_assignment_id is not null and resource_id is null and body is null and exam_id is null and link_url is null)
    or (type = 'link'
       and link_url is not null and resource_id is null and body is null and exam_id is null and coursework_assignment_id is null)
  );

-- Member reads also respect module-level draft/publish now.
alter policy "org members read modules of published classes" on class_modules
  using (
    status = 'published'
    and exists (
      select 1 from classes c where c.id = class_modules.class_id
        and c.status = 'published' and is_org_member(c.org_id)
    )
  );

alter policy "org members read items of published classes" on class_module_items
  using (exists (
    select 1 from class_modules m join classes c on c.id = m.class_id
    where m.id = class_module_items.module_id
      and c.status = 'published' and m.status = 'published' and is_org_member(c.org_id)
  ));

-- ---------- network_marketing_products: content slots + ordering ----------
alter table network_marketing_products add column video_resource_id uuid references resources(id) on delete set null;
alter table network_marketing_products add column pdf_resource_id   uuid references resources(id) on delete set null;
alter table network_marketing_products add column exam_id           uuid references exams(id) on delete set null;
alter table network_marketing_products add column order_index       int not null default 0;
alter table network_marketing_products add column is_active         boolean not null default true;
-- RLS unchanged (0028): org members read, admins manage.

-- ---------- onboarding_modules: the grouping layer ----------
create table onboarding_modules (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  title        text not null,
  description  text,
  order_index  int not null default 0,
  status       text not null default 'published' check (status in ('draft', 'published')),
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);
create index onboarding_modules_org_idx on onboarding_modules (org_id, order_index);

alter table onboarding_step_items add column module_id uuid references onboarding_modules(id) on delete cascade;

alter table onboarding_modules enable row level security;

create policy "org members read onboarding modules"
  on onboarding_modules for select using (is_org_member(org_id));

create policy "admins manage onboarding modules"
  on onboarding_modules for all
  using (has_org_role(org_id, array['admin']))
  with check (has_org_role(org_id, array['admin']));

-- ---------- backfill: one onboarding module per legacy step ----------
insert into onboarding_modules (org_id, title, order_index, created_by)
select s.org_id,
       case s.step
         when 'business_explanation' then 'Business Explanation'
         when 'network_varsity'      then 'Network Varsity'
         when 'office_policy'        then 'Office Policy'
         else initcap(replace(s.step, '_', ' '))
       end,
       case s.step
         when 'business_explanation' then 0
         when 'network_varsity'      then 1
         when 'office_policy'        then 2
         else 3
       end,
       (select p.id from profiles p
          join memberships m on m.user_id = p.id
         where m.org_id = s.org_id and m.role = 'admin' and m.status = 'active'
         limit 1)
from (select distinct org_id, step from onboarding_step_items) s
where exists (select 1 from memberships m where m.org_id = s.org_id and m.role = 'admin' and m.status = 'active');

update onboarding_step_items i
set module_id = m.id
from onboarding_modules m
where m.org_id = i.org_id
  and m.title = case i.step
    when 'business_explanation' then 'Business Explanation'
    when 'network_varsity'      then 'Network Varsity'
    when 'office_policy'        then 'Office Policy'
    else initcap(replace(i.step, '_', ' '))
  end;
