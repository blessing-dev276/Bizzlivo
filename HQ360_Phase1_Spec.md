# HQ360 — Phase 1 Build Spec

## What this is
HQ360 is a multi-tenant CBT/exam platform. Each customer is an "office" (tenant).
Office admins upload a skill/service PDF, AI generates an MCQ/True-False exam,
admin reviews and approves it, configures settings, assigns it to members, and
members take the exam online with instant auto-grading.

Phase 1 = MVP. No certificates, no analytics dashboard, no payments, no
WhatsApp, no anti-cheat. Ship the core loop end to end, well, before adding
anything else.

## Tech stack
- React (Vite) + TypeScript, React Router for navigation
- Supabase: Postgres, Auth, Storage, Edge Functions, `@supabase/supabase-js`
  client SDK
- Claude API (Sonnet) for question generation from PDF text
- Row Level Security on every tenant-scoped table — non-negotiable

Note: mobile is not covered by this stack. If you want native mobile later,
that's a separate React Native build or a wrapped web app — decide that when
Phase 1 is stable, not now.

## Scope — build in this exact order

### 1. Auth + org creation
- Supabase email/password auth (magic link acceptable as alternative)
- On signup: create `profiles` row, create `organizations` row, create
  `memberships` row with `role = 'owner'`
- Slug auto-generated from office name, auto-suffix on collision (`office`,
  `office-2`, `office-3`)
- Land on an onboarding checklist screen, not a blank dashboard:
  1. Upload your first resource
  2. Generate your first exam
  3. Invite your team

### 2. Resource upload
- Screen: title field + PDF upload (Supabase Storage bucket `resources`,
  path `org_id/resource_id.pdf`)
- Insert row into `resources` table
- No processing yet — just storage and a list view of uploaded resources

### 3. AI question generation
- Supabase Edge Function (Deno/TypeScript): extract text from PDF (use a
  PDF text extraction lib server-side), send to Claude API
- Prompt Claude to return **only JSON**, no preamble, in this shape:
```json
{
  "questions": [
    {
      "text": "string",
      "type": "mcq",
      "skill_tag": "string",
      "options": [
        {"text": "string", "is_correct": true},
        {"text": "string", "is_correct": false}
      ]
    }
  ]
}
```
- Parse response, insert into `questions` (`status = 'pending_review'`,
  `ai_generated = true`) and `question_options`
- Admin picks how many questions to generate per batch (e.g. 10, 20, 50)
- Wrap the Claude call in try/catch — if JSON parsing fails, surface an error
  and let the admin retry, don't silently drop questions

### 4. Review screen
- List all `pending_review` questions for an exam
- Admin can: edit question text, edit/add/remove options, mark correct
  answer, approve (`status = 'approved'`), reject (`status = 'rejected'`)
- Exam cannot be published until all questions are approved or rejected —
  this gate is the whole point, do not let it be skipped

### 5. Exam configuration
- Screen: `exam_settings` fields — number of questions per attempt, time
  limit (minutes), pass mark (%), shuffle questions (on/off), shuffle
  options (on/off), max attempts
- Publish button flips `exams.status` to `published` (only enabled once
  step 4's gate is satisfied)

### 6. Invite + assign
- Invite by email: creates `invites` row with token, sends email (Supabase
  built-in email or a simple transactional email service — WhatsApp comes
  in Phase 4)
- On accept: creates `profiles` (if new) + `memberships` (`role = 'member'`)
- Assign screen: pick exam, pick individual member(s) or a group, optional
  due date — `exam_assignments` row(s)

### 7. CBT screen (member-facing)
- Member sees list of assigned, unstarted exams
- Start exam: create `attempts` row (`status = 'in_progress'`), pull
  `num_questions` from the approved pool, shuffle per `exam_settings`
- One question per screen or scrollable single page — pick one, don't
  build both for Phase 1
- Countdown timer visible at all times; auto-submit on expiry
- Submit button available once all questions answered (or allow partial
  submit — decide and be consistent)

### 8. Auto-grade + result
- On submit: compare `attempt_answers.selected_option_ids` against
  `question_options.is_correct`, compute `score_percent`, set
  `passed = score_percent >= exam_settings.pass_mark_percent`
- Update `attempts.status = 'submitted'`
- Show result screen immediately: score, pass/fail, correct vs total
- If `attempt_number < max_attempts` and failed, show a retake option

### 9. Public exam link (guest takers, no invite needed)
- Every published exam gets a `public_token` automatically. Admin toggles
  `public_link_enabled` on/off and copies the URL: `hq360.app/take/{token}`
- Add a "Regenerate link" action — rotates the token, invalidates any
  previously shared link. Needed for when a link leaks further than intended
- Landing page at `/take/{token}`: exam title + single "Your name" field +
  Start button. No login, no signup.
- Build the two Edge Functions in `schema.sql` section 12
  (`start-attempt`, `submit-attempt`) — this is the only path guests use.
  Do not give the public/anon Supabase role direct table access to
  `questions` or `question_options`; the correct answer must never reach
  the browser before grading.
- On submit, show the guest their score/pass-fail immediately — same
  result screen as a logged-in member, just no account behind it.

### 10. Platform admin (minimal — no UI yet)
- Run the `platform_admins`, `is_platform_admin()`, `admin_list_offices()`,
  `admin_get_office_detail()`, `admin_set_office_status()`,
  `admin_set_plan_tier()` block from `schema.sql`
- Manually insert yourself into `platform_admins` via the Supabase SQL
  editor after your own signup
- No admin panel screens yet — query `admin_list_offices()` and
  `admin_get_office_detail()` directly in Supabase's SQL editor or table
  editor while you only have a handful of pilot offices
- **Do not** query `organizations`/`memberships`/etc. directly with the
  service role key from client code as a shortcut — always go through
  these functions, even for yourself. Bad habits here leak into Phase 3
  when the real admin panel gets built on top of the same functions

### 11. Basic analytics (pulled forward from Phase 2 — minimal only)
- One screen per exam: total attempts, pass rate, average score, a
  simple list of attempts (name, score, pass/fail, guest or member,
  submitted date)
- Separate the guest count from the member count in the summary —
  don't blend "23 public link takers" and "5 real team members" into
  one number, they answer different questions for the office admin
- This is NOT the full Phase 2 analytics (no skill-tag trends, no
  per-topic breakdown, no time-series charts) — just enough for an
  admin to see "did people take it, did they pass"

## Explicitly out of scope for Phase 1
Certificates, skill-tag analytics/dashboard, learning paths, payments,
white-label branding, WhatsApp notifications, offline autosave, anti-cheat
(fullscreen lock, tab-switch flagging).

## Tables needed for Phase 1
From `schema.sql`: `organizations`, `profiles`, `memberships`, `invites`,
`groups`, `group_members`, `resources`, `exams`, `exam_settings`,
`questions`, `question_options`, `exam_assignments`, `attempts`,
`attempt_answers`, `platform_admins` (plus the `admin_*` functions —
functions only, no admin UI).
Skip for now: `certificates`, `certificate_templates`, `learning_paths`,
`learning_path_steps`, `learning_path_progress`, `skill_scores`,
`notifications`, `subscriptions`, `payment_events`, `proctoring_flags` —
tables can exist in the schema file but don't build UI/logic for them yet.
`audit_log` is written to by the admin functions above, so it needs to
exist, but nothing else writes to it in Phase 1.

## RLS — minimum required before any real data goes in
Enable and write policies for: `organizations`, `memberships`, `exams`,
`questions`, `attempts` at minimum. These five are the ones that leak data
across offices if skipped. Pattern is in `schema.sql` under the `exams`
table — replicate for each.

## Acceptance criteria for Phase 1 to be "done"
- [ ] Two separate test offices can each sign up, and neither can see the
      other's exams, questions, or members (test this explicitly)
- [ ] PDF upload → AI generates at least 10 usable MCQ questions
- [ ] Admin can edit/approve/reject and exam won't publish until gate clears
- [ ] Member can be invited, accepts, sees assigned exam
- [ ] Member takes exam, timer counts down, auto-submits on expiry
- [ ] Score and pass/fail shown instantly and correctly
- [ ] Retake works and respects `max_attempts`
- [ ] Public link: a guest with no account can open `/take/{token}`,
      type a name, take the exam, and see their score
- [ ] Guest cannot see `is_correct` in any network request before
      submitting (check this in browser dev tools, not just visually)
- [ ] Regenerating a public link invalidates the old token immediately
- [ ] Analytics screen shows attempt count, pass rate, and average score,
      with guest and member attempts counted separately
