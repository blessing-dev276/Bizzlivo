-- ============================================================
-- 0073 — Events Phase D: per-office Google Calendar / Meet integration
-- ============================================================
-- Inert until GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET /
-- INTEGRATION_ENC_KEY are set as edge-function secrets. Every online
-- event type (external link, physical, one-time, recurring) keeps working
-- with Google disconnected.
--
-- The OAuth refresh token is encrypted in the EDGE RUNTIME (AES-GCM,
-- INTEGRATION_ENC_KEY) and only its base64 ciphertext is stored here —
-- Postgres never sees the key or the plaintext token. Sync is one-way
-- (Bizzlivo -> Google) for v1.

create table if not exists organization_integrations (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  provider                 text not null default 'google' check (provider in ('google')),
  connected_by             uuid references profiles(id),
  google_account_email     text,
  google_account_id        text,
  calendar_id              text not null default 'primary',
  encrypted_refresh_token  text,                 -- base64(AES-GCM iv||ciphertext), edge-encrypted
  scopes                   text[] not null default '{}',
  status                   text not null default 'disconnected'
                           check (status in ('connected', 'attention', 'disconnected')),
  connected_at             timestamptz,
  last_sync_at             timestamptz,
  last_error               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (org_id, provider)
);

drop trigger if exists trg_org_integrations_touch on organization_integrations;
create trigger trg_org_integrations_touch before update on organization_integrations
  for each row execute function public.touch_updated_at();

alter table organization_integrations enable row level security;
-- The table itself is service-role only (it holds the ciphertext column).
-- Admins read status through the redacted view below.
create policy "integrations: no direct authenticated access"
  on organization_integrations for all
  using (false) with check (false);

create or replace view public.org_integration_status as
  select id, org_id, provider, connected_by, google_account_email,
         calendar_id, scopes, status, connected_at, last_sync_at, last_error, updated_at
  from organization_integrations;

grant select on public.org_integration_status to authenticated;

-- View RLS follows the base table's, which we just locked to false, so add
-- a security_invoker view guarded by org-admin membership instead.
alter view public.org_integration_status set (security_invoker = off);
create or replace function public.can_read_org_integration(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select has_org_role(p_org, array['admin']);
$$;
-- Wrap the view read in a function admins call.
create or replace function public.get_org_integration(p_org uuid)
returns setof public.org_integration_status
language sql stable security definer set search_path = public as $$
  select * from public.org_integration_status
  where org_id = p_org and has_org_role(p_org, array['admin']);
$$;
grant execute on function public.get_org_integration(uuid) to authenticated;

-- ---------- oauth_states — short-lived CSRF tokens ----------
create table if not exists oauth_states (
  state       text primary key,
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  provider    text not null default 'google',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes'
);
alter table oauth_states enable row level security;
create policy "oauth_states: service role only"
  on oauth_states for all using (false) with check (false);
