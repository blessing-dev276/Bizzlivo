-- ============================================================
-- HQ360 — in-app notification read-tracking, and a profile-photo
-- storage bucket for the new top-right header (bell + avatar).
-- ============================================================

-- The existing status/sent_at/channel columns (0001_init.sql) look built
-- for an outbound dispatch queue, not "has the viewer seen this in the
-- bell dropdown" — read_at is a separate, additive concept so we don't
-- overload that existing meaning.
alter table notifications add column read_at timestamptz;

create policy "members read their own notifications"
  on notifications for select
  using (user_id = auth.uid());

create policy "members mark their own notifications read"
  on notifications for update
  using (user_id = auth.uid());

-- Deliberately permissive: any active member of an org can write a
-- notification for any other active member of the same org. This is what
-- lets e.g. a member submitting coursework notify the org's admins, and an
-- admin assigning an exam notify the assignees, all client-side (mirrors
-- how coursework_submissions/exam_assignments are already inserted
-- directly by the client, not via an edge function).
create policy "org members can notify other org members"
  on notifications for insert
  with check (
    is_org_member(org_id)
    and exists (
      select 1 from memberships m
      where m.org_id = notifications.org_id and m.user_id = notifications.user_id and m.status = 'active'
    )
  );

-- Office-branded login's "request to join" form (OfficeLogin.tsx join
-- mode) is filled out by an anonymous, not-yet-authenticated visitor —
-- same trust level as the existing anonymous pending_members insert policy
-- (0005_public_join_request.sql). Scoped narrowly to type='join_request'
-- targeting an actual admin of that org, so an anonymous caller can only
-- ever create "someone wants to join" notifications, nothing else.
create policy "anyone can notify an org's admins of a join request"
  on notifications for insert
  with check (
    type = 'join_request'
    and exists (
      select 1 from memberships m
      where m.org_id = notifications.org_id
        and m.user_id = notifications.user_id
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'instructor')
    )
  );

-- Storage — `avatars` bucket for profile photos. Public (unlike `resources`):
-- avatar images are low-sensitivity and rendered constantly across the app
-- (topbar, team roster), so serving them via public URL avoids needing a
-- signed-URL round trip on every render. Path convention:
-- {user_id}/{random-filename} — a fresh random filename per upload (rather
-- than a fixed name) sidesteps browser image-caching showing a stale photo
-- after a re-upload; old files are simply orphaned (small images, low
-- volume, not worth a cleanup job yet).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "anyone can view avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users can replace their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
