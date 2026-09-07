-- ============================================================
-- 0057 — email_log_admin_v must respect the caller's RLS
-- ------------------------------------------------------------
-- A normal view runs as its owner and bypasses RLS on email_log,
-- which would expose every org's delivery log to any authenticated
-- user. security_invoker makes the view evaluate email_log's policies
-- as the querying user (office admin = own org, platform admin = all).
-- ============================================================
alter view email_log_admin_v set (security_invoker = true);
