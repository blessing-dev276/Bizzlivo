-- ============================================================
-- Storage — `resources` bucket for uploaded PDFs
-- Path convention: org_id/resource_id.pdf
-- ============================================================

insert into storage.buckets (id, name, public)
values ('resources', 'resources', false)
on conflict (id) do nothing;

create policy "org members can read their org's resource files"
  on storage.objects for select
  using (
    bucket_id = 'resources'
    and is_org_member((storage.foldername(name))[1]::uuid)
  );

create policy "owners/admins/instructors can upload resource files"
  on storage.objects for insert
  with check (
    bucket_id = 'resources'
    and has_org_role((storage.foldername(name))[1]::uuid, array['owner','admin','instructor'])
  );

create policy "owners/admins/instructors can delete resource files"
  on storage.objects for delete
  using (
    bucket_id = 'resources'
    and has_org_role((storage.foldername(name))[1]::uuid, array['owner','admin','instructor'])
  );
