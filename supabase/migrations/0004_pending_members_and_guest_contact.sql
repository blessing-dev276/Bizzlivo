-- ============================================================
-- HQ360 — guest lead capture (name+email+whatsapp on public exam
-- links), pending-member approval queue, and public org lookup by
-- slug (needed for office-branded login pages).
-- ============================================================

-- Guests taking a public-link exam now leave contact info behind.
alter table attempts add column taker_email text;
alter table attempts add column taker_whatsapp text;

-- A guest who completes a public-link exam becomes a join request the
-- office admin has to approve — not an instant member. Approval flow
-- reuses the existing `invites` table (see submit-attempt Edge
-- Function + Team page): approving here creates a real invite.
create table pending_members (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  full_name         text not null,
  email             text not null,
  phone             text,
  source_exam_id    uuid references exams(id),
  source_attempt_id uuid references attempts(id),
  status            text not null default 'pending',   -- pending / approved / rejected
  reviewed_by       uuid references profiles(id),
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now()
);

alter table pending_members enable row level security;

create policy "owners/admins can read pending members"
  on pending_members for select
  using (has_org_role(org_id, array['owner','admin']));

create policy "owners/admins can update pending members"
  on pending_members for update
  using (has_org_role(org_id, array['owner','admin']));

-- No client insert policy: rows are only created by submit-attempt
-- (service role key), same boundary as the rest of the guest flow.

-- ============================================================
-- Public org lookup by slug — needed so an office-branded login page
-- (/o/:slug/login) can show the office's name/branding before the
-- visitor has authenticated (and therefore before is_org_member()
-- would pass). organizations has no sensitive per-member data, so a
-- second permissive SELECT policy (combined with the existing one via
-- OR) is an acceptable trade-off for this.
-- ============================================================

create policy "anyone can look up an org by slug for branded login"
  on organizations for select
  using (true);
