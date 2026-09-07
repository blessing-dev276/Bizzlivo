-- ============================================================
-- 0056 — fix ON CONFLICT dedupe for email tables
-- ------------------------------------------------------------
-- 0053 created PARTIAL unique indexes (WHERE dedupe_key IS NOT NULL).
-- Postgres can't reliably use a partial index as an ON CONFLICT
-- arbiter, so enqueue_email / email_outbox_mark / log_email_send were
-- raising 42P10 ("no unique or exclusion constraint matching the ON
-- CONFLICT specification") and nothing was being logged.
--
-- Plain UNIQUE constraints work here: Postgres allows multiple NULLs
-- in a UNIQUE column, so rows without a dedupe_key are unaffected and
-- non-null keys still dedupe.
-- ============================================================

drop index if exists email_outbox_dedupe_uq;
drop index if exists email_log_dedupe_uq;

-- de-dupe any rows that slipped in before the constraint (there
-- shouldn't be any, but be safe).
delete from email_outbox a using email_outbox b
  where a.dedupe_key is not null and a.dedupe_key = b.dedupe_key and a.ctid > b.ctid;
delete from email_log a using email_log b
  where a.dedupe_key is not null and a.dedupe_key = b.dedupe_key and a.ctid > b.ctid;

alter table email_outbox add constraint email_outbox_dedupe_key_uq unique (dedupe_key);
alter table email_log    add constraint email_log_dedupe_key_uq    unique (dedupe_key);
