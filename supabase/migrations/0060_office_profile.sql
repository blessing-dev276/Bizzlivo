-- ============================================================
-- 0060 — Office profile: more identity fields + a logo bucket
-- ============================================================
-- The Office settings screen only stored name / logo_url / brand_color /
-- whatsapp_number. This rounds out the office profile with a tagline,
-- an about blurb, a support email, a website and a location, and adds a
-- public `org-logos` storage bucket so admins upload a logo image
-- instead of pasting a URL.
--
-- No RLS change needed on `organizations` — its UPDATE policy is
-- row-level (has_org_role(id, array['admin'])) and column-agnostic, so
-- admins can already write these new columns.

alter table organizations add column if not exists tagline       text;
alter table organizations add column if not exists about          text;
alter table organizations add column if not exists support_email  text;
alter table organizations add column if not exists website_url    text;
alter table organizations add column if not exists address        text;
alter table organizations add column if not exists country        text;
alter table organizations add column if not exists timezone       text;

-- ---------- org-logos bucket ----------
-- Public-read (logos show on login/onboarding screens for logged-out
-- visitors). Writes are restricted to admins of the org whose id is the
-- first path segment: {org_id}/{uuid}.{ext}. A fresh random filename per
-- upload sidesteps stale image caching; old files are orphaned (tiny,
-- low volume — no cleanup job yet), matching the `avatars` bucket.
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

create policy "anyone can view org logos"
  on storage.objects for select
  using (bucket_id = 'org-logos');

create policy "org admins can upload their logo"
  on storage.objects for insert
  with check (
    bucket_id = 'org-logos'
    and has_org_role(((storage.foldername(name))[1])::uuid, array['admin'])
  );

create policy "org admins can replace their logo"
  on storage.objects for update
  using (
    bucket_id = 'org-logos'
    and has_org_role(((storage.foldername(name))[1])::uuid, array['admin'])
  );

create policy "org admins can delete their logo"
  on storage.objects for delete
  using (
    bucket_id = 'org-logos'
    and has_org_role(((storage.foldername(name))[1])::uuid, array['admin'])
  );
