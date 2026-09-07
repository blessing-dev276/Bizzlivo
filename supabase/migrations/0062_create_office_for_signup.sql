-- ============================================================
-- 0062 — atomic, race-free office creation for a brand-new signup.
--
-- The old flow created the org from the browser: loop over slug
-- candidates, INSERT each until one doesn't 23505. Two concurrent runs
-- for the same user — a re-opened confirmation link, two tabs, React
-- StrictMode's double-invoke, Supabase firing INITIAL_SESSION + SIGNED_IN
-- back to back — could BOTH pass the "does this user have a membership?"
-- check, then one takes slug `acme` and the other falls through to
-- `acme-2`. Result: the user is admin of two near-identical offices.
-- The client had a module-level in-flight guard, but it only covers one
-- JS runtime — not a second device/tab or a reloaded page.
--
-- create_office_for_signup() moves the whole thing server-side under a
-- per-user transaction advisory lock:
--   * take pg_advisory_xact_lock on the caller's uid — concurrent calls
--     for the same user serialize instead of racing;
--   * inside the lock, if the caller already has an active membership,
--     return that org id and do nothing (idempotent / resumable);
--   * otherwise derive the slug, INSERT the org (retrying the suffix on
--     unique_violation), INSERT the admin membership, return the id.
-- SECURITY DEFINER so it isn't blocked by the organizations SELECT
-- policy (a brand-new user is a member of nothing yet).
-- ============================================================

create or replace function create_office_for_signup(
  p_office_name text,
  p_full_name   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text := btrim(coalesce(p_office_name, ''));
  v_org_id uuid;
  v_root   text;
  v_slug   text;
  v_n      int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_name = '' then
    raise exception 'office name is required';
  end if;

  -- Serialize concurrent signups for the same user. Released at txn end.
  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  -- Already has an office (or a prior attempt got this far)? Hand it back.
  select m.org_id into v_org_id
  from memberships m
  where m.user_id = v_uid and m.status = 'active'
  order by m.joined_at
  limit 1;
  if v_org_id is not null then
    return v_org_id;
  end if;

  -- The membership FK needs a profile row. The client normally inserts it
  -- first; do it here too so this RPC stands on its own.
  insert into profiles (id, full_name, email)
  values (
    v_uid,
    coalesce(nullif(btrim(p_full_name), ''), v_name),
    (select email from auth.users where id = v_uid)
  )
  on conflict (id) do nothing;

  -- slugify(): lower, non-alphanumerics -> '-', trim leading/trailing '-',
  -- cap at 60 chars, fall back to 'office'. Mirrors src/lib/slug.ts.
  v_root := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_root := regexp_replace(v_root, '(^-+|-+$)', '', 'g');
  v_root := left(v_root, 60);
  if v_root = '' then
    v_root := 'office';
  end if;

  -- `acme`, then `acme-2`, `acme-3`, ... on collision.
  for v_n in 1..50 loop
    v_slug := case when v_n = 1 then v_root else v_root || '-' || v_n end;
    begin
      v_org_id := gen_random_uuid();
      insert into organizations (id, name, slug) values (v_org_id, v_name, v_slug);
      exit;                       -- inserted cleanly
    exception when unique_violation then
      v_org_id := null;          -- slug taken, try the next suffix
    end;
  end loop;

  if v_org_id is null then
    raise exception 'could not allocate a slug for office %', v_name;
  end if;

  insert into memberships (org_id, user_id, role, status)
  values (v_org_id, v_uid, 'admin', 'active')
  on conflict (org_id, user_id) do nothing;

  return v_org_id;
end;
$$;

grant execute on function create_office_for_signup(text, text) to authenticated;
