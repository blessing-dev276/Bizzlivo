# Bizzlivo — Phase 1

Multi-tenant CBT/exam platform. Office admins upload a skill/service PDF, AI
generates an MCQ/True-False exam, admin reviews and approves it, configures
settings, assigns it to members, and members take the exam online with
instant auto-grading. See `Bizzlivo_Phase1_Spec.md` for the full scope.

Stack: React (Vite) + TypeScript, React Router, Supabase (Postgres, Auth,
Storage, Edge Functions), Claude API for question generation.

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Install the CLI: `npm install -g supabase` (or `brew install supabase/tap/supabase`).
3. `supabase login`, then from this directory: `supabase link --project-ref <your-project-ref>`.

## 2. Apply the database schema

```bash
supabase db push
```

This runs everything in `supabase/migrations/`:
- `0001_init.sql` — all Phase 1 tables (plus Phase 2+ tables kept schema-only)
  and Row Level Security policies for every tenant-scoped table.
- `0002_storage.sql` — the `resources` storage bucket (private) and its RLS
  policies, keyed off the `org_id/resource_id.pdf` path convention.

## 3. Deploy the Edge Functions

```bash
supabase functions deploy generate-questions
supabase functions deploy accept-invite
supabase functions deploy paystack-webhook
supabase functions deploy verify-paystack-transaction
```

`generate-questions` currently calls **Groq** (OpenAI-compatible chat
completions, `llama-3.3-70b-versatile`) as an interim, cheaper provider —
swap to Claude post-launch by pointing the fetch call in
`supabase/functions/generate-questions/index.ts` at Anthropic's Messages API
(the request/response shape differs from Groq's OpenAI-style format, so it's
a small edit, not just an env var swap). Set the key as a function secret
(never put this in the frontend):

```bash
supabase secrets set GROQ_API_KEY=gsk_...
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically by the Supabase runtime — nothing to configure there.

## 4. Configure the frontend

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Project
Settings → API in the Supabase dashboard.

## 5. Run it

```bash
npm install
npm run dev
```

## 6. Deploy

Hosted on **Vercel** — the repo is connected to the Vercel dashboard, so every
push to `main` deploys automatically and pull requests get preview URLs. Set
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PAYSTACK_PUBLIC_KEY` as
Environment Variables in Vercel Project Settings; they're baked into the build at
build time. Edge Function and migration changes deploy separately via `supabase`
as described above.

`vercel.json` rewrites all paths to `/index.html` so React Router's client-side
routes work on hard refresh/deep links, and sets asset caching / security headers.

## 7. Billing (Paystack)

Free / Growth / Business plans, monthly or yearly, checked out via
Paystack's inline popup. Pricing and limits live in the `plan_limits` table
(migration `0010_billing.sql`), not hardcoded in the frontend — change a
price or a cap with a single `UPDATE`, no redeploy needed.

1. Create a Paystack account (test mode is fine to start) and grab your
   **Public Key** and **Secret Key** from Settings → API Keys & Webhooks.
2. Frontend: set `VITE_PAYSTACK_PUBLIC_KEY` in `.env`.
3. Edge Functions: set the secret key (also used to verify the webhook's
   HMAC-SHA512 signature — no separate hash to invent, unlike some other
   providers):
   ```bash
   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...
   ```
4. In Paystack's dashboard (Settings → API Keys & Webhooks), set the
   webhook URL to your deployed `paystack-webhook` function's URL.

### Notes on billing scope

- **Renewal is manual, not auto-recurring.** Checkout is a one-off Paystack
  charge per billing cycle, not their auto-recurring Plans/subscriptions
  product — an admin checks out again before `current_period_end` to renew.
  Wiring true auto-recurring billing is a follow-up: create four Paystack
  Plans (growth/business × monthly/yearly) via the Plans API and pass a
  `plan` code in the checkout call so Paystack auto-charges the saved card
  each cycle; `subscriptions.provider_plan_code` and
  `provider_subscription_id` already exist in the schema for this.
- **Trial/period expiry is checked lazily**, on next login (`AuthContext`
  calls `sync_subscription_status()` for each org the user belongs to) —
  there's no `pg_cron` job wired up. Fine for a lapse measured in days.
- **Limits are enforced twice, deliberately**: `get_org_usage()` drives the
  quiet usage meters and upsell prompts in the UI, but the actual gate is a
  set of Postgres triggers on `resources`, `exams`, and `memberships` — a
  request straight to the table (bypassing the UI) still gets rejected.
- The 14-day trial sets `organizations.plan_tier = 'growth'` directly
  (rather than a separate `'trial'` tier) so every existing plan check just
  works; `subscriptions.status = 'trialing'` is what actually marks it as a
  trial.

## Notes on Phase 1 scope

- **Invite emails aren't sent** — creating an invite generates a shareable
  link (`/invite/:token`) that the admin copies and sends manually. Wiring a
  transactional email provider (Resend, Postmark) is a small follow-up: call
  it from a new step in `accept-invite`'s POST-adjacent invite-creation path,
  or a dedicated `send-invite` function.
- **Grading is client-side.** The CBT screen fetches `question_options`
  (including `is_correct`) to render the exam and grades on submit via
  direct table writes. This is consistent with anti-cheat being explicitly
  out of scope for Phase 1 (see the spec) — a determined user could read the
  answer key from network traffic. Fine for MVP; if that ever matters, move
  grading into a `submit-attempt` Edge Function that only returns the score.
- **Shuffled option order isn't persisted** across a hard page reload
  mid-attempt (the question *set* is — it's pinned via `attempt_answers` rows
  created at attempt start — only the on-screen order of options reshuffles).
  Answers already selected aren't lost since they're tracked by option id.
- Tables in `schema.sql` beyond Phase 1 scope (certificates, learning paths,
  notifications, audit log) are created with RLS enabled and no policies
  (default-deny) so nothing leaks if touched before Phase 2 policies are
  written. Billing (`subscriptions`, `payment_events`) is no longer in that
  bucket — see §7.

## Acceptance checklist (from the spec)

- [ ] Two separate test offices can each sign up, and neither can see the
      other's exams, questions, or members
- [ ] PDF upload → AI generates at least 10 usable MCQ questions
- [ ] Admin can edit/approve/reject and exam won't publish until the gate clears
- [ ] Member can be invited, accepts, sees assigned exam
- [ ] Member takes exam, timer counts down, auto-submits on expiry
- [ ] Score and pass/fail shown instantly and correctly
- [ ] Retake works and respects `max_attempts`
