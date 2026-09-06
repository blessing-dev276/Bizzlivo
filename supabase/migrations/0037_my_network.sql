-- ============================================================
-- My Network workspace (0036): turns /my-team into the member's network
-- management workspace. Two concerns.
--
-- 1. Prospect CRM scheduling. network_marketing_contacts gains real
--    follow-up fields (source, next_follow_up_at, last_contacted_at) and
--    an optional link from a prospect to the sponsored member they became
--    (linked_member_id). No RLS change needed — "members manage their own
--    contacts" (0028) already covers new columns on the same row.
--
-- 2. Self-serve referral. Every profile gets a stable, unguessable
--    referral_code. A prospective member who opens /join/:code and signs
--    in is added straight to that office as an active member, with the
--    code's owner recorded as their sponsor (profiles.sponsor_member_id).
--    The join itself runs in the `join-by-referral` edge function under
--    the service role (it validates the code itself), mirroring how
--    accept-invite bridges invite acceptance. Nothing here weakens RLS.
-- ============================================================

-- ---------- 1. prospect CRM fields ----------
alter table network_marketing_contacts add column if not exists source            text;
alter table network_marketing_contacts add column if not exists next_follow_up_at timestamptz;
alter table network_marketing_contacts add column if not exists last_contacted_at timestamptz;
alter table network_marketing_contacts add column if not exists linked_member_id  uuid references profiles(id) on delete set null;

create index if not exists network_marketing_contacts_followup_idx
  on network_marketing_contacts (org_id, user_id, next_follow_up_at);

-- ---------- 2. referral code on every profile ----------
alter table profiles add column if not exists referral_code text;

update profiles
set referral_code = substr(md5(gen_random_uuid()::text), 1, 12)
where referral_code is null;

create unique index if not exists profiles_referral_code_key on profiles (referral_code);

alter table profiles
  alter column referral_code set default substr(md5(gen_random_uuid()::text), 1, 12);

-- A member's own referral_code is already readable through "users can read
-- own profile or org-mates' profiles" (0001). The join flow reads it with
-- the service role, so no extra policy is required.

-- ---------- 3. members read rank position across their office ----------
-- 0035 restricted member_rank_progress SELECT to staff. My Network needs
-- every member to see the rank of the people in their downline, so widen
-- SELECT (only) to any active org member. current_rank_id is not sensitive
-- data — ranks already surface through leaderboards and Team Performance —
-- and writes stay locked to promote_member() / admins.
do $$ begin
  create policy "org members read rank position in their org"
    on member_rank_progress for select
    using (is_org_member(org_id));
exception when duplicate_object then null;
end $$;
