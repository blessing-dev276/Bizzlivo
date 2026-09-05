# HQ360 — Project Context & AI Handoff Document

> **Purpose of this file**: This is the single source of truth for continuing development on HQ360 without re-inspecting the codebase from scratch. It documents every module, feature, database table, route, component, edge function, workflow, business rule, dependency, and folder that exists as of the date below. If you are a future Claude session picking up this project, read this document fully before touching code — it should answer "how does X work" and "why was X built this way" for nearly everything in the repo.
>
> **Last updated**: 2026-07-23 (after: coursework assignments feature, exam-link auto-registration + scheduled windows, and role-editing/Trainer rename).
>
> **Keep this file current.** Whenever a future session adds a table, route, edge function, or changes a business rule, update the relevant section of this document in the same changeset.

---

## 1. What HQ360 is

HQ360 is a multi-tenant B2B SaaS platform for small offices/training businesses ("Synergy Office" is the one real tenant seen in this session) to run internal training and competency assessment. Each tenant is called an **office** (DB term: **organization**). An office can:

- Upload PDF training resources.
- Auto-generate multiple-choice/true-false exam questions from a resource via an LLM (Groq), then have a human review/approve/reject/edit each question before publishing.
- Assign published exams to members or groups, optionally with a scheduled date+time window (e.g. "4–6pm on July 24"), and share a public no-login-required link that self-registers whoever opens it.
- Track exam attempts, scores, pass/fail, and missed/expired attempts (self-healing status, not cron-based).
- Assign free-form coursework tasks ("design a poster," "set up this GHL workflow") to members/groups, collect text/link submissions, and approve/reject/request changes.
- Manage team membership and roles (Member / Trainer / Admin, plus an immutable Owner for whoever created the office).
- Invite people directly, or let them self-request to join via a branded office login page or by taking a public exam link.

There is also a **platform-admin** layer (HQ360's own internal staff, not tied to any one office) with schema/RPC support for listing/managing all offices — this exists in the database but has **no frontend UI built for it yet** (see §14).

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19.2, TypeScript ~6.0, Vite 8, react-router-dom 7 |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) |
| Edge Functions runtime | Deno, via `supabase functions deploy` |
| Hosting | Firebase Hosting (static SPA build of `dist/`, project id `hq360-cbt`) |
| Linter | `oxlint` (not ESLint) |
| Email | Resend (used in exactly one edge function) |
| AI | Groq (OpenAI-compatible chat completions API), model `llama-3.3-70b-versatile` |

**No** CSS framework, state-management library, form library, charting library, or test runner is present. Charts and gauges on the Dashboard are hand-rolled CSS/SVG. There is no automated test suite in this repo as of this writing.

### package.json — exact dependencies

```
dependencies:
  @supabase/supabase-js  ^2.110.7
  react                  ^19.2.7
  react-dom              ^19.2.7
  react-router-dom       ^7.18.1

devDependencies:
  @types/node            ^24.13.2
  @types/react           ^19.2.17
  @types/react-dom       ^19.2.3
  @vitejs/plugin-react    ^6.0.3
  oxlint                 ^1.71.0
  typescript              ~6.0.2
  vite                    ^8.1.1

scripts:
  dev:     vite
  build:   tsc -b && vite build
  lint:    oxlint
  preview: vite preview
```

### Supabase project

- Project ref: `rbzkinczddgsjvuofntq`, region `eu-west-2`, Postgres 17.
- CLI is linked directly (`supabase link`); there is **no `supabase/config.toml`** in the repo, so per-function settings (like `verify_jwt`) are **dashboard-only** and not version-controlled. Every edge function does its own internal auth handling (see §11) — `verify_jwt` must be `false` at the project/dashboard level for every function, since several branches (e.g. `start-attempt` GET, `check-exam-link-account` GET, `confirm-exam-signup` POST, `confirm-invite-signup` POST, `submit-attempt` POST) are called with **no** `Authorization` header at all.
- Secrets configured (via `supabase secrets set`): `GROQ_API_KEY`, `RESEND_API_KEY`, plus the auto-provided `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/etc.

### Firebase

- `firebase.json`: static hosting, `public: "dist"`, catch-all rewrite `**` → `/index.html` (SPA client-side routing support).
- `.firebaserc`: `{ "projects": { "default": "hq360-cbt" } }`.
- Deploy command: `npm run build && firebase deploy --only hosting`.

### Environment variables (`.env`, not committed; `.env.example` documents the shape)

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Only these two are used client-side (Vite exposes anything prefixed `VITE_`). No service-role key ever reaches the client. Edge functions read their own env vars server-side via `Deno.env.get(...)` (see §11 for exactly which vars each function needs).

### vite.config.ts / tsconfig

- `vite.config.ts`: bare minimum, just the `@vitejs/plugin-react` plugin. No aliases, no custom server/build options.
- `tsconfig.json` is a references-only shell pointing at `tsconfig.app.json` (the actual app config) and `tsconfig.node.json` (scoped to `vite.config.ts`).
- Notable `tsconfig.app.json` options: `target: es2023`, `moduleResolution: bundler`, `verbatimModuleSyntax: true`, `erasableSyntaxOnly: true` (no TS `enum`, no parameter properties — this is why the codebase uses plain `type X = 'a' | 'b'` unions everywhere instead of `enum`), `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch` all on.

---

## 3. Repository structure (full file tree)

```
/Users/synergy/Development/HQ360/
├── PROJECT_CONTEXT.md                          — this file
├── package.json / firebase.json / .firebaserc / vite.config.ts / tsconfig*.json / .env / .env.example
├── src/
│   ├── main.tsx                                — React entry point (ReactDOM.createRoot mount)
│   ├── App.tsx                                 — root component; the entire route table (§8)
│   ├── index.css                                — full design system (§13), ~1148 lines
│   ├── components/
│   │   ├── Layout.tsx                          — app shell: sidebar nav (role-gated), topbar, sign-out
│   │   ├── ProtectedRoute.tsx                   — session-gate wrapper (redirects to /login if no session)
│   │   └── ThemeToggle.tsx                      — light/dark toggle button (uses ThemeContext)
│   ├── lib/
│   │   ├── AuthContext.tsx                      — session/profile/memberships/currentOrg React context (§9)
│   │   ├── ThemeContext.tsx                     — light/dark theme state + persistence
│   │   ├── completeSignup.ts                    — completeOfficeSignup(): idempotent org/profile/membership bootstrap (§9)
│   │   ├── slug.ts                              — slugify() / slugCandidates() for unique org slugs (§9)
│   │   ├── shuffle.ts                            — generic Fisher–Yates array shuffle (used for exam question/option order)
│   │   ├── examLifecycle.ts                     — shared lazy self-heal + status-derivation helpers (§10.3)
│   │   └── supabase.ts                          — Supabase client instantiation from env vars
│   ├── types/
│   │   └── database.ts                          — hand-written TS row types for every table (§6.1 lists them all)
│   └── pages/
│       ├── Dashboard.tsx                        — role-branched home page (§10.6)
│       ├── auth/
│       │   ├── Signup.tsx                       — new-office signup (§9)
│       │   ├── Login.tsx                        — generic org-agnostic login (§9)
│       │   └── OfficeLogin.tsx                  — slug-branded login + join-request dual mode (§9)
│       ├── onboarding/
│       │   └── Onboarding.tsx                   — read-only 3-step post-signup checklist (§9)
│       ├── resources/
│       │   └── Resources.tsx                    — PDF upload/list/delete (§10.1)
│       ├── exams/
│       │   ├── Exams.tsx                        — exam list (admin), create/duplicate/archive/delete (§10.2)
│       │   ├── ExamDetail.tsx                   — exam hub: links to generate/review/settings/roster/analytics, public-link toggle
│       │   ├── GenerateQuestions.tsx            — AI question-generation trigger UI (§10.2)
│       │   ├── review/
│       │   │   ├── ReviewQuestions.tsx          — question review list, filters, bulk-approve (§10.2)
│       │   │   └── QuestionCard.tsx             — per-question inline edit/approve/reject (§10.2)
│       │   ├── ExamSettings.tsx                 — settings form + publish gate (§10.2)
│       │   ├── ExamAnalytics.tsx                — submitted-attempts table/filters/CSV export
│       │   ├── AttemptDetail.tsx                — single-attempt read-only breakdown (member or guest)
│       │   └── ExamRoster.tsx                   — per-assignment-member status roster (built this session, §10.3)
│       ├── cbt/  (Computer-Based Test — the exam-taking experience)
│       │   ├── MyExams.tsx                      — member's assigned exams list (§10.3)
│       │   ├── TakeExam.tsx                     — authenticated member exam-taking (client-graded) (§10.3)
│       │   ├── PublicTakeExam.tsx               — public exam-link taking (server-graded, auto-registers) (§10.3)
│       │   └── Result.tsx                       — post-exam score screen (member path)
│       ├── invites/
│       │   ├── Invites.tsx                      — "Team" page: member roster, role editing, invites, join requests (§10.4)
│       │   ├── AcceptInvite.tsx                 — invite-token acceptance page (login-or-signup gate)
│       │   └── Assign.tsx                       — assign an exam to members/groups, incl. optional scheduled window (§10.3)
│       └── assignments/  (Coursework Assignments feature, built this session, §10.5)
│           ├── Assignments.tsx                  — admin list of coursework assignments
│           ├── NewAssignment.tsx                — admin create form
│           ├── AssignmentDetail.tsx             — admin roster + inline review panel
│           ├── MyAssignments.tsx                — member list
│           └── SubmitAssignment.tsx             — member view/submit/resubmit page
└── supabase/
    ├── functions/  (Deno Edge Functions, §11)
    │   ├── accept-invite/index.ts
    │   ├── approve-pending-member/index.ts
    │   ├── check-exam-link-account/index.ts
    │   ├── confirm-exam-signup/index.ts
    │   ├── confirm-invite-signup/index.ts
    │   ├── generate-questions/index.ts
    │   ├── start-attempt/index.ts
    │   └── submit-attempt/index.ts
    └── migrations/  (applied in order via `supabase db push`, §6.2)
        ├── 0001_init.sql
        ├── 0002_storage.sql
        ├── 0003_platform_admin_and_public_link.sql
        ├── 0004_pending_members_and_guest_contact.sql
        ├── 0005_public_join_request.sql
        ├── 0006_one_exam_per_resource.sql
        ├── 0007_resource_file_size.sql
        ├── 0008_assignment_windows_and_attempt_self_heal.sql
        └── 0009_coursework_assignments.sql
```

---

## 4. Roles & permissions model

### 4.1 The four membership roles

Stored in `memberships.role` as plain text (no Postgres enum — see §6.1). **Four** values exist in the database; **three** are user-assignable via the UI:

| DB value | UI label | Assignable via role editor? | Notes |
|---|---|---|---|
| `owner` | **Owner** | No | Exactly one per org, set automatically at office-signup time (`completeOfficeSignup`, §9). Cannot be reassigned via the Team page's role editor — that would require a separate "transfer ownership" feature, which does not exist. |
| `admin` | **Admin** | Yes | Full admin permissions, equivalent to owner for almost everything except (per RLS) only owner can `UPDATE organizations` (see `"owners can update their org"` policy). |
| `instructor` | **Trainer** | Yes | **The DB/RLS value is still `'instructor'`** — only the user-facing label was changed to "Trainer" (see §4.3 for why). Has the same `has_org_role` permissions as admin nearly everywhere in the app (both appear together in almost every `array['owner','admin','instructor']` check) — the practical distinction between Trainer and Admin today is thin; the only place they diverge is memberships-update (role editing) and organizations-update, both admin/owner-only. |
| `member` | **Member** | Yes | Default role. Can only read/act on their own data. |

`ADMIN_ROLES` (as a set of `['owner','admin','instructor']`) is checked **client-side** in exactly two places, both duplicated (no shared constant/hook exists): `src/components/Layout.tsx` and `src/pages/Dashboard.tsx`. This determines nav visibility and Dashboard's admin-vs-member branch. **This is nav-gating only, not route-guarding** — `ProtectedRoute` only checks for a session, not a role, so a plain member who directly navigates to an admin URL (e.g. `/exams`) is not blocked by the router itself; they'd only be blocked by RLS if the page tries to read/write something they don't have permission for. This is a pre-existing, accepted gap in the app, not something introduced by any single feature.

### 4.2 Editing a member's role

Added this session. Location: **Team page** (`/invites` → `Invites.tsx`) → click a member row to open the right-side drawer → a "Role" `<select>` appears above the KPIs, editable only when the *current viewer* is `owner` or `admin` (`canEditRoles` computed from `currentMembership.role`), and never shown as editable for a row whose role is `owner` (that role can't be reassigned through this control). Selecting a new role calls:

```ts
supabase.from('memberships').update({ role: newRole }).eq('id', member.id)
```

**No new migration was needed for this** — the RLS policy `"owners/admins can update memberships in their org"` (from `0001_init.sql`, `using (has_org_role(org_id, array['owner','admin']))`) already permitted this; only the frontend UI was missing. Note this policy deliberately excludes `instructor`/Trainer from being able to change roles — only owner/admin can.

### 4.3 Why "Trainer" isn't a new DB value

The word `instructor` is hardcoded into `array['owner','admin','instructor']` RLS-policy literals across **most** of the migration files (0001, 0002, 0004, 0008, 0009 all reference it). Renaming the actual stored value to `'trainer'` would require rewriting every one of those RLS policies in a new migration — a wide-blast-radius change for what is fundamentally a cosmetic rename. The decision made this session: **keep the stored value `'instructor'` everywhere in the schema/RLS**, and only relabel it to "Trainer" in the two user-facing spots where a role name is displayed: the invite-role `<select>` and the `ROLE_LABEL` map in `Invites.tsx` (`{ owner: 'Owner', admin: 'Admin', instructor: 'Trainer', member: 'Member' }`). If a future session wants to fully rename it at the DB level, budget for a migration that updates every RLS policy referencing `'instructor'`, not just a column value swap.

### 4.4 Platform admins (separate, unrelated role system)

`platform_admins` (table, `0003_platform_admin_and_public_link.sql`) is **not** part of the org membership/role system at all — it's a separate flag for HQ360's own internal staff, checked via `is_platform_admin()` (a security-definer function). This has full schema + RPC support (`admin_list_offices`, `admin_get_office_detail`, `admin_set_office_status`, `admin_set_plan_tier`, all granted to `authenticated` but self-guarding via `is_platform_admin()` inside the function body) but **no frontend page consumes any of this** — it's backend-only, unused by the React app as of this writing. See §14.

---

## 5. Authentication & account lifecycle (`src/pages/auth/`, `src/lib/completeSignup.ts`, `src/lib/slug.ts`, `src/lib/AuthContext.tsx`)

### 5.1 Three distinct ways to end up with an account

1. **Office creation** (`Signup.tsx`, route `/signup`) — the *only* self-service "create a brand-new org" path. Collects full name, office name, email, password. Calls `supabase.auth.signUp({ email, password, options: { data: { full_name, office_name } } })` — note `full_name`/`office_name` are stashed as **auth user metadata**, not written to any app table at this point. If Supabase's project-level "confirm email" setting is on (the default), no session comes back immediately; the user is redirected to `/login` with an on-screen message to confirm their email first. If a session *is* returned immediately, `completeOfficeSignup(user)` runs inline, then `refresh()` (AuthContext) + `setCurrentOrgId(orgId)` + navigate to `/onboarding`.

2. **Admin-issued invite** (`approve-pending-member` edge function or the Team page's "+ Invite a member" form → `invites` table row → `/invite/:token` → `AcceptInvite.tsx` → `accept-invite` edge function). Full chain:
   - Admin fills the invite modal in `Invites.tsx` (email + role) → inserts directly into `invites` (client-side, RLS-permitted for owner/admin) with a 7-day expiry token. **No email is sent for this path** — the admin copies the link manually (there's a note in the UI about this).
   - *Or* someone submits a join request (guest exam-taker's old flow, or OfficeLogin's "join" mode) → lands in `pending_members` → an admin clicks Approve on the Team page → calls `approve-pending-member` edge function, which creates the real `invites` row **and emails it via Resend**.
   - Recipient opens `/invite/:token` → `AcceptInvite.tsx` shows org name + role, has a login/signup toggle. New-user signup path calls `confirm-invite-signup` (admin-confirms their email, scoped strictly to that one pending invite's email) then signs in; existing-user path just logs in. Either way, finally calls `accept-invite` POST with the now-valid session, which creates the `profiles` row (if missing), creates the `memberships` row (`role` = whatever the invite specified, `status: 'active'`), re-links any prior guest exam attempts matching that email, and marks the invite `accepted`.

3. **Public exam link, self-registering** (`/take/:token` → `PublicTakeExam.tsx`). See §10.3 for the full flow — this is the "register the moment they start the exam" feature built this session. Uses `check-exam-link-account` + `confirm-exam-signup` + `start-attempt` POST, entirely separate from the invite system, with **no admin approval gate** at all (deliberate).

There is a fourth, non-account-creating path: **OfficeLogin's "join" mode** (`/o/:slug/login`, mode toggle) — this does *not* create an auth user; it just inserts a `pending_members` row for an admin to later approve via path #2 above.

### 5.2 `completeOfficeSignup(user)` (`src/lib/completeSignup.ts`)

Called from Signup.tsx inline, and **re-invoked by `AuthContext` on every login** if the user has office-signup metadata but no active membership yet (this is what makes it resumable/self-healing across interrupted signups — e.g. a dropped connection between the profile insert and the org insert). Exact steps:

1. Read `full_name`/`office_name` off `user.user_metadata`. If either is missing, return `null` immediately (guards against being called for someone who joined an *existing* org via invite).
2. Check `memberships` for an existing active row for this user — if found, return that `org_id` immediately (idempotency/resume guard).
3. Insert a `profiles` row (tolerates `23505` unique-violation — meaning a prior partial run already created it — re-throws any other error).
4. Generate `orgId` **client-side** via `crypto.randomUUID()` (not DB-generated + read-back, because `organizations` SELECT RLS requires membership, which doesn't exist yet at insert time).
5. Try inserting `organizations` with each candidate slug from `slugCandidates(officeName)` in turn (`office`, `office-2`, `office-3`, ... up to 20 attempts) until one succeeds; a `23505` on the slug unique constraint moves to the next candidate, any other error throws immediately.
6. Insert `memberships` row: `{ org_id: orgId, user_id: user.id, role: 'owner', status: 'active' }`.
7. Return `orgId`.

`src/lib/slug.ts`: `slugify(name)` (lowercase, strip to `[a-z0-9-]`, max 60 chars, falls back to `'office'` if empty) + `slugCandidates(base, maxAttempts=20)` (generator: `base`, `base-2`, `base-3`, ...). Comment explains why a pre-check SELECT can't be used instead of attempt-insert-catch-23505: RLS on `organizations` hides orgs you're not a member of, so a brand-new signup would see zero rows regardless of real slug collisions.

### 5.3 `AuthContext.tsx` (`src/lib/AuthContext.tsx`)

React context providing `{ session, profile, memberships, currentMembership, loading, refresh, signOut, setCurrentOrgId }`. Key behaviors:
- Listens to `supabase.auth.onAuthStateChange` plus an initial `refresh()` on mount.
- `currentOrgId` is persisted in `localStorage` (`hq360.currentOrgId`) so a multi-org user's last-viewed org survives reload; `currentMembership = memberships.find(m => m.org_id === currentOrgId) ?? memberships[0] ?? null`.
- Uses a **module-level** (not component-level) `Map` (`officeSignupInFlight`) to dedupe concurrent `completeOfficeSignup` calls keyed by user id — needed because React StrictMode's dev double-mount plus Supabase firing `onAuthStateChange` multiple times right after login could otherwise trigger multiple simultaneous office-creation attempts for the same brand-new user, creating duplicate orgs.

### 5.4 `ProtectedRoute.tsx`

Trivial session gate: `loading` → spinner; `!session` → `<Navigate to="/login" replace />`; else render children. **No role checking here** (see §4.1's note on nav-gating vs route-guarding).

### 5.5 `Onboarding.tsx` (`/onboarding`)

Read-only 3-step checklist shown right after office signup: has the org uploaded a resource (`resources` count), created an exam (`exams` count), invited anyone (`memberships` count `> 1`)? No `onboarding_completed` flag is persisted anywhere — it's purely derived from live counts each time the page loads, with a "Skip to dashboard →" escape hatch.

---

## 6. Data model — complete schema reference

### 6.1 Every table (final state, after all 9 migrations)

For each table: columns in declaration order, with type/default/nullability. "P2" = Phase-2/reserved, schema exists with RLS enabled but **no policies** (default-deny) and **no application code reads/writes it** — see §14.

#### `organizations`
| column | type | default | null? |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK |
| name | text | — | not null |
| slug | text | — | not null, **unique** |
| logo_url | text | — | null |
| brand_color | text | — | null |
| whatsapp_number | text | — | null |
| plan_tier | text | 'free' | not null |
| status | text | 'active' | not null |
| created_at | timestamptz | now() | not null |

#### `profiles`
id (PK, FK→auth.users.id ON DELETE CASCADE) · full_name (not null) · email (null) · phone (null) · avatar_url (null) · created_at (now())

#### `memberships`
id (PK) · org_id (FK→organizations, cascade) · user_id (FK→profiles, cascade) · role (text: owner/admin/instructor/member) · status (text default 'active': active/invited/suspended) · joined_at (now()). **unique(org_id, user_id)**.

#### `invites`
id (PK) · org_id (FK→organizations, cascade) · email (null) · phone (null) · role (text default 'member') · token (text, **unique**) · invited_by (FK→profiles, no cascade) · status (text default 'pending': pending/accepted/expired) · expires_at (not null) · created_at (now())

#### `groups`
id (PK) · org_id (FK→organizations, cascade) · name (not null) · created_at (now())

#### `group_members`
group_id (FK→groups, cascade) · user_id (FK→profiles, cascade) — **composite PK `(group_id, user_id)`, no surrogate id column**

#### `resources` (0001; altered 0007)
id (PK) · org_id (FK→organizations, cascade) · uploaded_by (FK→profiles, no cascade) · title (not null) · file_url (not null — this is the **storage path**, e.g. `org_id/resource_id.pdf`, not a public URL) · file_type (text default 'pdf') · skill_tags (text[] default '{}') · created_at (now()) · **file_size_bytes** (bigint, nullable, added 0007 — populated client-side from the File object, null for pre-0007 rows)

#### `exams` (0001; altered 0003, 0006)
id (PK) · org_id (FK→organizations, cascade) · resource_id (FK→resources, nullable, no cascade) · title (not null) · description (null) · created_by (FK→profiles, no cascade) · status (text default 'draft': draft/published/archived) · created_at (now()) · **public_link_enabled** (boolean default false, added 0003) · **public_token** (uuid default gen_random_uuid(), added 0003, **unique index** `exams_public_token_idx`).
Also: `exams_resource_id_unique_idx` — **partial unique index** `on exams(resource_id) where resource_id is not null` (0006) — enforces at most one exam per resource; manually-created exams (`resource_id IS NULL`) are unrestricted.

#### `exam_settings`
exam_id (PK, FK→exams, cascade) · num_questions (int, default **10**) · question_pool_size (int, null) · time_limit_minutes (int, default **20**) · shuffle_questions (bool, default true) · shuffle_options (bool, default true) · pass_mark_percent (int, default **70**) · max_attempts (int, default **1** — `0` means unlimited, checked explicitly in code as `!== 0`) · require_fullscreen (bool, default false) · flag_tab_switch (bool, default false)

#### `questions`
id (PK) · exam_id (FK→exams, cascade) · org_id (FK→organizations, cascade) · type (text default 'mcq': mcq/true_false/multi_select — **multi_select is schema-only, never surfaced in any exam-taking UI**, both TakeExam.tsx and PublicTakeExam.tsx are single-select only) · text (not null) · skill_tag (null) · difficulty (text default 'medium', null-able) · order_index (null) · ai_generated (bool default true) · reviewed_by (FK→profiles, null) · reviewed_at (null) · status (text default 'pending_review': pending_review/approved/rejected) · created_at (now())

#### `question_options`
id (PK) · question_id (FK→questions, cascade) · text (not null) · is_correct (bool default false) · order_index (null)

#### `exam_assignments` (0001; altered 0008)
id (PK) · org_id (FK→organizations, cascade) · exam_id (FK→exams, cascade) · assigned_to_user (FK→profiles, null) · assigned_to_group (FK→groups, null) · assigned_by (FK→profiles, not null) · due_date (timestamptz, null, **informational only, never enforced**) · created_at (now()) · **starts_at** (timestamptz, null, added 0008) · **ends_at** (timestamptz, null, added 0008).
Check `check (assigned_to_user is not null or assigned_to_group is not null)`. Check `exam_assignments_window_check` (0008): `(starts_at is null) = (ends_at is null) and (starts_at is null or ends_at > starts_at)` — both-or-neither, and end must be after start.

#### `attempts` (0001; altered 0003, 0004, 0008)
id (PK) · org_id (FK→organizations, cascade) · exam_id (FK→exams, cascade) · user_id (FK→profiles, **nullable** — originally NOT NULL, relaxed in 0003 for guest attempts) · attempt_number (int default 1) · started_at (timestamptz default now()) · submitted_at (null) · status (text default 'in_progress': **in_progress/submitted/expired**) · score_percent (numeric(5,2), null) · passed (bool, null) · time_spent_seconds (int, null) · **taker_name** (text, null, added 0003) · **is_guest** (bool default false, added 0003) · **taker_email** (text, null, added 0004) · **taker_whatsapp** (text, null, added 0004).
Check (0003) `attempts_user_or_taker_check`: `user_id is not null or taker_name is not null`.
Unique index (0008) `attempts_exam_user_attempt_number_idx`: `on attempts (exam_id, user_id, attempt_number) where user_id is not null` — race-safety so two concurrent "start exam" calls can't create duplicate attempt rows for the same person/exam/slot.

#### `attempt_answers`
id (PK) · attempt_id (FK→attempts, cascade) · question_id (FK→questions, no cascade) · selected_option_ids (uuid[] default '{}') · is_correct (bool, null) · time_spent_seconds (int, null)

#### `proctoring_flags` (P2 — schema present, RLS on, no policies, no app code touches it)
id (PK) · attempt_id (FK→attempts, cascade) · flag_type (not null) · occurred_at (now()) · metadata (jsonb, null)

#### `learning_paths`, `learning_path_steps`, `learning_path_progress` (all P2)
- `learning_paths`: id (PK) · org_id (FK, cascade) · name (not null) · description (null) · created_at
- `learning_path_steps`: id (PK) · path_id (FK→learning_paths, cascade) · exam_id (FK→exams) · order_index (not null) · unlock_after_step (FK→learning_path_steps, self-referential, null)
- `learning_path_progress`: id (PK) · path_id (FK, cascade) · user_id (FK) · current_step_id (FK, null) · status (default 'not_started') · started_at (null) · completed_at (null). **unique(path_id, user_id)**.

#### `certificate_templates`, `certificates` (both P2)
- `certificate_templates`: id (PK) · org_id (FK, cascade) · name (default 'Default') · layout_json (jsonb, not null) · created_at
- `certificates`: id (PK) · org_id (FK, cascade) · user_id (FK) · exam_id (FK) · attempt_id (FK) · template_id (FK, null) · cert_number (text, **unique**) · pdf_url (null) · issued_at (now())

#### `notifications` (P2)
id (PK) · org_id (FK, cascade) · user_id (FK) · type (not null) · channel (text default **'whatsapp'** — suggests an intended WhatsApp integration that was never built) · payload (jsonb, null) · status (default 'pending') · sent_at (null) · created_at

#### `subscriptions`, `payment_events` (both P2, billing)
- `subscriptions`: id (PK) · org_id (FK, cascade) · plan (not null) · status (default 'active') · provider (default **'paystack'**) · provider_customer_id (null) · current_period_end (null) · created_at
- `payment_events`: id (PK) · org_id (FK, cascade) · amount (numeric(12,2)) · currency (default 'NGN') · status (not null) · provider_ref (null) · created_at

#### `audit_log` (P2, though it IS written to by the platform-admin RPC functions — see below)
id (PK) · org_id (FK, cascade) · actor_id (FK, null) · action (not null) · entity_type (null) · entity_id (null) · metadata (jsonb, null) · created_at

#### `platform_admins` (0003)
id (PK, FK→profiles, no cascade) · role (text default 'admin' — convention: super_admin/support/billing_admin) · created_at. RLS on, no client policy — reachable only via the security-definer functions.

#### `pending_members` (0004)
id (PK) · org_id (FK, cascade) · full_name (not null) · email (not null) · phone (null) · source_exam_id (FK→exams, null) · source_attempt_id (FK→attempts, null) · status (default 'pending': pending/approved/rejected) · reviewed_by (FK, null) · reviewed_at (null) · created_at

#### `coursework_assignments`, `coursework_targets`, `coursework_submissions` (0009 — new this session, see §10.5 for the feature walkthrough)
- `coursework_assignments`: id (PK) · org_id (FK, cascade) · title (not null) · instructions (not null) · reference_link (null) · require_note (bool default true) · require_link (bool default false) · due_date (null) · created_by (FK) · created_at. Check: `require_note or require_link`.
- `coursework_targets`: id (PK) · assignment_id (FK→coursework_assignments, cascade) · org_id (FK, cascade) · assigned_to_user (FK, null) · assigned_to_group (FK→groups, null) · created_at. Check: `assigned_to_user is not null or assigned_to_group is not null`.
- `coursework_submissions`: id (PK) · assignment_id (FK, cascade) · org_id (FK, cascade) · user_id (FK, not null) · note (null) · link (null) · status (default 'submitted': submitted/approved/rejected/changes_requested) · review_note (null) · reviewed_by (FK, null) · reviewed_at (null) · submitted_at (default now()). **unique(assignment_id, user_id)** — one row per member per assignment; resubmission updates it in place.

#### Materialized view `skill_scores` (0001)
```sql
select a.org_id, a.user_id, q.skill_tag,
  count(*) as questions_answered,
  sum(case when aa.is_correct then 1 else 0 end) as correct_count,
  round(100.0 * sum(...) / count(*), 2) as score_percent,
  max(a.submitted_at) as last_attempt_at
from attempt_answers aa
join attempts a on a.id = aa.attempt_id
join questions q on q.id = aa.question_id
where a.status = 'submitted' and q.skill_tag is not null
group by a.org_id, a.user_id, q.skill_tag;
```
**No refresh trigger/schedule exists anywhere** — this view is static since creation unless someone manually runs `REFRESH MATERIALIZED VIEW skill_scores`. No application code reads it either (P2, unused).

**No custom Postgres `enum` types exist** anywhere (blocked by `erasableSyntaxOnly` TS convention carried into the DB design too — every "enum-like" column is plain `text`, documented only via SQL comments). **No triggers** exist anywhere (no `updated_at` auto-touch on any table — only `created_at` plus feature-specific timestamps). **No custom sequences** (everything uses `uuid` + `gen_random_uuid()`).

### 6.2 Postgres helper functions

- **`is_org_member(target_org uuid) returns boolean`** — `security definer`, `stable`. `exists(select 1 from memberships where org_id=target_org and user_id=auth.uid() and status='active')`.
- **`has_org_role(target_org uuid, roles text[]) returns boolean`** — same shape, plus `and role = any(roles)`. This is the single most-used building block in every RLS policy in the app.
- **`is_platform_admin() returns boolean`** (0003) — `exists(select 1 from platform_admins where id=auth.uid())`.
- **`admin_list_offices()`** (0003) — returns every org with member/exam counts + last attempt time; silently returns zero rows for non-platform-admins (doesn't error).
- **`admin_get_office_detail(target_org_id uuid) returns json`** (0003) — raises `'not authorized'` if not platform admin; else returns `{org, members, exams, recent_attempts}`.
- **`admin_set_office_status(target_org_id uuid, new_status text)`** / **`admin_set_plan_tier(target_org_id uuid, new_plan text)`** (0003) — mutate `organizations`, then insert an `audit_log` row. Both `grant execute ... to authenticated` (self-guard is inside the function body via `is_platform_admin()`).

### 6.3 RLS policy inventory (by table)

Every table with RLS enabled and its exact policies. `ALL` means the policy applies to every command (select/insert/update/delete) via `for all`.

- **organizations**: SELECT `is_org_member(id)`; INSERT `auth.uid() is not null` (any authenticated user can create an org — this is what lets Signup.tsx work); UPDATE `has_org_role(id, ['owner'])` (owner-only, not admin); SELECT `using (true)` (0004, second permissive policy — anyone, including anonymous, can look up an org by slug/name for branded login pages).
- **profiles**: SELECT own row or any org-mate's row (via a self-join across `memberships`); INSERT own row only; UPDATE own row only.
- **memberships**: SELECT if `is_org_member(org_id)`; INSERT `user_id = auth.uid()` (self-service — used by `completeOfficeSignup` and `accept-invite`/`start-attempt` to insert their own membership); UPDATE `has_org_role(org_id, ['owner','admin'])` (this is what powers §4.2's role editor — instructor/Trainer excluded).
- **invites**: ALL `has_org_role(org_id, ['owner','admin'])` — no client SELECT-by-token policy (that's why `accept-invite`'s GET branch exists, using the service-role key).
- **groups**: SELECT if org member; ALL for owner/admin/instructor.
- **group_members**: SELECT if org member (via join to groups); ALL for owner/admin/instructor (via join to groups).
- **resources**: SELECT if org member; ALL for owner/admin/instructor.
- **exams**: SELECT if org member; ALL for owner/admin/instructor.
- **exam_settings**: SELECT/ALL scoped via a join to `exams` checking membership/role.
- **questions** / **question_options**: same pattern (SELECT if org member, ALL for owner/admin/instructor; question_options checks via join to `questions`).
- **exam_assignments**: SELECT if admin, or `assigned_to_user = auth.uid()`, or member of the assigned group; ALL for owner/admin/instructor.
- **attempts**: SELECT own or admin; INSERT `user_id = auth.uid() and is_org_member(org_id)` (self); UPDATE own-or-admin; **second INSERT policy** (0008) letting owner/admin/instructor create an attempt row *for another active member of their org* (powers the self-heal "missed" row creation in `examLifecycle.ts` — see §10.3).
- **attempt_answers**: SELECT if attempt-owner or admin; ALL if attempt-owner (self only, no admin write here — admins never edit answer rows).
- **proctoring_flags**, **learning_paths/steps/progress**, **certificate_templates**, **certificates**, **notifications**, **subscriptions**, **payment_events**, **audit_log**: RLS on, **zero policies** — fully inaccessible via the API (P2 reserved).
- **platform_admins**: RLS on, no client policy (only reachable inside the security-definer functions).
- **pending_members**: SELECT/UPDATE for owner/admin only; INSERT (0005) `with check (status = 'pending')` — open to anyone (anonymous join requests / guest post-exam requests), but they can only ever insert a `pending` row, never a pre-approved one.
- **coursework_assignments**: ALL for owner/admin/instructor; SELECT for a targeted member (direct or via group, checked via `coursework_targets`).
- **coursework_targets**: ALL for owner/admin/instructor; SELECT for the targeted member/group member.
- **coursework_submissions**: ALL for owner/admin/instructor (approve/reject/read-all); INSERT for the member themself, only for an assignment that actually targets them, and **only ever with `status = 'submitted'`** (can never self-approve); SELECT own row; UPDATE own row but `with check (status = 'submitted')` (resubmission can only ever land back at `submitted`, never bump itself to `approved`).

### 6.4 Storage

One bucket: `resources` (private, `public: false`). Path convention: `{org_id}/{resource_id}.pdf`. Three RLS policies on `storage.objects`, all keyed off `(storage.foldername(name))[1]::uuid` (the org id, first path segment): SELECT if org member; INSERT/DELETE if owner/admin/instructor. **No UPDATE policy** — uploads are treated as immutable (replace = delete + re-insert). This is the **only** storage bucket in the entire app — the coursework-assignments feature deliberately has **no file upload** (see §10.5, a considered design decision).

---

## 7. Frontend routes (complete table)

All routes are declared in `src/App.tsx`. `Protected` = wrapped in `<ProtectedRoute><Layout>...</Layout></ProtectedRoute>` (requires a session; renders inside the sidebar-nav shell). Unprotected routes render standalone (no sidebar).

| Route | Component | Protected? | Who sees a nav link to it |
|---|---|---|---|
| `/signup` | Signup | No | — (entry point) |
| `/login` | Login | No | — |
| `/o/:slug/login` | OfficeLogin | No | — (shared as a branded link) |
| `/invite/:token` | AcceptInvite | No | — (shared link) |
| `/take/:token` | PublicTakeExam | No | — (shared public exam link) |
| `/` | Dashboard | Yes | Everyone ("Dashboard") |
| `/onboarding` | Onboarding | Yes | (no persistent nav link — landed on right after signup) |
| `/resources` | Resources | Yes | Admins only |
| `/exams` | Exams | Yes | Admins only |
| `/exams/:examId` | ExamDetail | Yes | (linked from Exams list) |
| `/exams/:examId/generate` | GenerateQuestions | Yes | (linked from ExamDetail) |
| `/exams/:examId/review` | ReviewQuestions | Yes | (linked from ExamDetail) |
| `/exams/:examId/settings` | ExamSettingsPage | Yes | (linked from ExamDetail) |
| `/exams/:examId/analytics` | ExamAnalytics | Yes | (linked from ExamDetail) |
| `/exams/:examId/analytics/:attemptId` | AttemptDetail | Yes | (linked from ExamAnalytics/ExamRoster) |
| `/exams/:examId/roster` | ExamRoster | Yes | (linked from ExamDetail) |
| `/invites` | Invites | Yes | Admins only ("Team") |
| `/invites/assign` | Assign | Yes | (linked from ExamDetail) |
| `/assignments` | Assignments | Yes | Admins only ("Assignments") |
| `/assignments/new` | NewAssignment | Yes | (linked from Assignments list) |
| `/assignments/:assignmentId` | AssignmentDetail | Yes | (linked from Assignments list) |
| `/my-assignments` | MyAssignments | Yes | Everyone ("My Assignments") |
| `/my-assignments/:assignmentId` | SubmitAssignment | Yes | (linked from MyAssignments) |
| `/cbt` | MyExams | Yes | Everyone ("My Exams") |
| `/cbt/:assignmentId/take` | TakeExam | Yes | (linked from MyExams — note the param here is an `exam_assignments.id`, unrelated to coursework assignments) |
| `/cbt/attempts/:attemptId/result` | Result | Yes | (linked after submitting) |
| `*` | — | — | Redirects to `/` |

---

## 8. Feature walkthroughs

### 8.1 Resources (`src/pages/resources/Resources.tsx`)

Admin-only PDF upload/management. `RESOURCE_LIMIT = 10` per org (a plan-tier-style gate unrelated to storage itself), `MAX_FILE_BYTES = 20 * 1024 * 1024` (20MB), MIME type hard-locked to `application/pdf`. Upload path: `supabase.storage.from('resources').upload(\`${orgId}/${resourceId}.pdf\`, file, { contentType: 'application/pdf' })`, then a `resources` row is inserted with `file_url` = that **path** (not a signed/public URL — a signed URL must be generated on demand wherever a resource is actually viewed, not at upload time). Delete removes both the storage object and the DB row.

### 8.2 Exams — creation, AI generation, review, publish

**Creation** (`Exams.tsx`): pick an optional source resource (only resources without an existing exam are offered, per the one-exam-per-resource unique index) or none (manual exam), creates an `exams` row (`status: 'draft'`) plus a default `exam_settings` row, then navigates to `/exams/:id/generate`.

**AI generation** (`GenerateQuestions.tsx` → `generate-questions` edge function, §11.6): pick a question count (10/20/50 quick-picks or custom up to 100), calls the edge function which downloads the resource PDF, extracts text via `unpdf`, prompts Groq, and inserts `pending_review` questions + options. **Token-budget history worth knowing**: this function originally requested a flat `max_tokens: 8000` regardless of question count, which alone exceeded Groq's free-tier 12,000-tokens/minute cap before the prompt was even counted — this was debugged and fixed this session by (a) shrinking `MAX_SOURCE_CHARS` from 20,000 to 12,000 and (b) scaling `max_tokens` dynamically as `Math.min(7000, 400 + numQuestions * 140)`. A 429 from Groq now returns a friendly "rate-limited, try fewer questions or wait a minute" message instead of a raw error dump.

**Review** (`ReviewQuestions.tsx` + `QuestionCard.tsx`): filter tabs by status, per-question inline edit (text + options, enforcing exactly one correct option and a minimum of 2 options), individual Approve/Reject (which first auto-saves any pending inline edits), or a bulk "Approve all pending" action.

**Publish gate** (`ExamSettings.tsx`): `gateClear = pendingCount === 0 && approvedCount > 0` — can't publish with anything still pending review, and need at least one approved question. Publishing sets `status: 'published'` **and auto-enables `public_link_enabled: true`** (can be toggled back off afterward from ExamDetail if the office wants assign-only, no public link).

### 8.3 Exam-taking — two entirely separate pipelines

This is one of the most important things to understand about this codebase: **there are two independent exam-taking code paths that share tables but never share logic**, and this was a deliberate choice preserved across this session's changes (not unified).

**Pipeline A — authenticated member** (`TakeExam.tsx`, route `/cbt/:assignmentId/take`, `assignmentId` = an `exam_assignments.id`): requires an existing session + membership. Grading happens **client-side** in the browser (`submit()` computes `is_correct` locally and writes it directly to `attempt_answers`/`attempts` via the regular Supabase client, relying on RLS self-ownership policies). On submit, navigates to `/cbt/attempts/:attemptId/result` (`Result.tsx`).

**Pipeline B — public exam link** (`PublicTakeExam.tsx`, route `/take/:token`, `token` = `exams.public_token`): no pre-existing account required to *start*. Grading happens **server-side** in the `submit-attempt` edge function using the service-role key, so `question_options.is_correct` never reaches the guest's browser. This pipeline was substantially rebuilt this session (see §8.3.1 below).

Both pipelines write to the same `attempts`/`attempt_answers` tables, but a `TakeExam.tsx`-created attempt is never `is_guest`, and `submit-attempt` will happily grade either a legacy `is_guest:true` row or a new registered-member row created via the rebuilt `start-attempt` POST branch — but it **never** touches an attempt created by `TakeExam.tsx`'s own insert path (that one is graded and submitted entirely client-side, bypassing the edge function).

#### 8.3.1 The public exam link now auto-registers (built this session)

**Old behavior** (before this session): the link collected name/email/whatsapp and created an anonymous `attempts` row (`is_guest: true`, `user_id: null`). Only *after* submission did `submit-attempt` insert a `pending_members` row — a request an admin had to manually approve before the person became a real member. An abandoned exam left **no trace at all**.

**New behavior**: starting the exam now creates a real, **active** `memberships` row immediately — no admin approval — replacing the old post-submission `pending_members` insert for this path entirely (that insert block was deleted from `submit-attempt`). Flow:

1. `PublicTakeExam.tsx` shows an email-first form. On blur, it calls **`check-exam-link-account`** (anon-callable) to see if that email already has a `profiles` row, and switches the form to a login layout (password only) or a signup layout (name + password + WhatsApp) accordingly — auto-detected, with a manual "log in instead / sign up instead" override link as a fallback.
2. Signup calls `supabase.auth.signUp(...)` client-side. If Supabase requires email confirmation (no session returned), the client calls **`confirm-exam-signup`** (admin-confirms the just-created user via `auth.admin.updateUserById`, scoped only to "is this exam link still valid" — **there is no invite-email matching here**, unlike the invite-acceptance flow; this is a deliberate, documented trust-model tradeoff: "register them immediately" means anyone can self-service-signup with any email as long as the link is public), then signs in.
3. Login calls `supabase.auth.signInWithPassword(...)` directly.
4. Either way, the client now has an access token and calls **`start-attempt` POST** (not the old anonymous GET-with-querystring branch, which was deleted). This is where the actual registration happens server-side: profile upsert, `memberships` insert (`role: 'member'`, `status: 'active'`) if missing, guest-history carryover (re-links any prior `is_guest:true` attempts matching that email), and attempt resume-or-create respecting `max_attempts`.
5. If already logged in when the link is opened (e.g. an office member clicking their own org's exam link), the auth gate is skipped entirely and `start-attempt` is called immediately with the existing session.
6. On the result screen, a "Go to your dashboard" button now appears (previously this was a dead end with zero navigation) — same addition was made to `Result.tsx` for pipeline A.

**Non-obvious edge case**: the served question set is never persisted ahead of answering — `submit-attempt` validates each submitted `question_id` against real `question_options` directly, not against a pre-recorded set. So if someone resumes an in-progress attempt (e.g. by reopening the link), they get a **freshly re-drawn** random question selection tied to the same `attempt_id`, which may differ in subset/order from what they originally saw. This was an accepted tradeoff, not a bug — grading doesn't care what was originally shown, only what's submitted.

#### 8.3.2 Scheduled assignment windows + self-healing "missed"/"expired" status

Also built this session, entirely separate from the exam-link work above but sharing the same underlying mechanism (`src/lib/examLifecycle.ts`).

**Admin side** (`Assign.tsx`): optional date + start-time + end-time fields alongside the existing (still-unenforced) due date. All-or-nothing validated client-side; combined into `starts_at`/`ends_at` ISO timestamps, one shared window per assignment row (applies to every target of that row — one user or a whole group; if different members need different windows, the admin creates separate assignment rows, same as `Assign.tsx` already did for individual targeting).

**Enforcement** (`TakeExam.tsx`): before `starts_at` → blocked with an "opens at {time}" screen, no attempt created. After `ends_at` with nothing ever submitted → blocked with a "window closed — marked as missed" screen. Within the window, the effective countdown deadline is `min(started_at + time_limit_minutes, ends_at)` — a hard window close pre-empts a longer personal time limit (e.g. a 20-minute exam started at 5:58pm in a 4–6pm window is force-submitted at 6:00pm, not 6:18pm).

**No cron job exists for any of this** — it's a deliberate design decision (confirmed with the user) to avoid pg_cron/pg_net infrastructure. Instead, `src/lib/examLifecycle.ts` exports:
- `getEffectiveStatus(assignment, attempts, now)` — pure/sync, returns one of `'too_early' | 'not_started' | 'in_progress' | 'passed' | 'failed' | 'missed'`, for instant rendering.
- `reconcileStaleAttempt(attempt, timeLimitMinutes, assignmentEndsAt)` — async **write**: if an `in_progress` attempt is past its deadline, flips it to `status: 'expired', passed: false` — idempotent via a trailing `.eq('status','in_progress')` filter so a concurrent call is a no-op.
- `reconcileMissedAssignment(...)` — async **write**: if a window elapsed with zero attempts ever created, inserts a synthetic `attempts` row with `status: 'expired', passed: false` (this is what the 0008 migration's second admin-INSERT policy on `attempts` exists for — an admin viewing the roster may need to write a "missed" row on behalf of someone else, not just their own).
- `healUserAttempts(orgId, userId)` / `healOrgExamAttempts(orgId, examId)` — orchestrators that fetch the relevant assignments/attempts and call the two reconcile functions above.

These heal functions are called at the top of `TakeExam.tsx`'s init, `MyExams.tsx`'s load, `Dashboard.tsx`'s member-stats load, and `ExamRoster.tsx`'s load — i.e., **status becomes accurate the next time any relevant page is opened**, not on a fixed schedule. `attempts.status = 'expired'` (an enum value that existed in the schema since 0001 but was never actually written by any code before this session) is now the shared value for both "abandoned mid-exam" and "missed window entirely."

`Dashboard.tsx`'s member completed/pass-rate query was widened from `.eq('status','submitted')` to `.in('status', ['submitted','expired'])` so a self-healed expired attempt (which may have no `exam_assignments` row at all, in the exam-link case) still counts toward the member's stats instead of being invisible.

### 8.4 Team / Invites (`Invites.tsx`, route `/invites`, admin-only, labeled "Team" in nav)

One page combining: a KPI strip (member count, team completion %, team avg score, not-started count), a "Join requests" section (approve/decline `pending_members` rows — approve calls `approve-pending-member` edge function, decline just updates the row to `rejected` client-side), a **Members table** (click a row → right-side drawer with per-member exam history + KPIs + the role editor from §4.2), a **Pending invites** list (copy-link action), and the "+ Invite a member" modal (email + role select, creates an `invites` row directly).

### 8.5 Coursework Assignments (`src/pages/assignments/`, built this session)

A free-form task system, deliberately distinct from `exam_assignments` (quiz scheduling) — internal DB/TS names are prefixed `coursework_`/`Coursework*` specifically to avoid confusion; the user-facing tab is just called "Assignments."

**Confirmed product decisions** (do not re-litigate without checking with the user first):
- **Submission format is text note and/or an external link — no file upload.** The admin picks, per-assignment, which of `require_note`/`require_link` is required (at least one, enforced by a DB check constraint and mirrored client-side). Large files (videos, hi-res designs) are expected to live on Google Drive/Canva/YouTube/etc., linked rather than uploaded. This is why **no new Storage bucket was created** for this feature.
- **Review outcomes are Approve / Reject / Request changes** (three states, `coursework_submissions.status`), each optionally with an admin feedback note (`review_note`).

**Flow**: Admin creates via `NewAssignment.tsx` (title, instructions, optional reference link, due date, the two requirement checkboxes, then the same member/group picker pattern as `Assign.tsx`) — this inserts one `coursework_assignments` row + N `coursework_targets` rows (one per selected user/group) in a single form submission. Member sees it in `MyAssignments.tsx`, opens `SubmitAssignment.tsx` to fill in the required fields; submitting does a Postgres `upsert` keyed on `(assignment_id, user_id)`. Admin reviews via `AssignmentDetail.tsx`'s roster table (expands group targets to individual members via `group_members`, same dedup pattern as `ExamRoster.tsx`) — clicking a submitted row opens a modal showing their note/link plus Approve/Reject/Request-changes buttons and a feedback textarea. If rejected or changes-requested, the member sees the admin's feedback prominently above the resubmit form on `SubmitAssignment.tsx`; once approved, the form is replaced with a read-only "Approved ✓" confirmation and can no longer be edited through the normal UI (though RLS technically still allows the member to write their own row back to `status:'submitted'` — see the RLS note in §6.3, an accepted minor gap, not a real security hole since they can only affect their own row and can never self-approve).

A 5th activity-feed entry kind (`'coursework'`) was added to `Dashboard.tsx`'s existing admin activity merge (alongside resources/exams/invites/attempts) for submission/approval/rejection events.

### 8.6 Dashboard (`Dashboard.tsx`, route `/`)

Branches entirely on role. **Admin view**: hero banner + office-branded login link (copies `/o/:slug/login`), a 4-KPI strip (team members, published exams, resources, pending-review count), a "setup progress" gauge (resource uploaded / exam published / team invited — same three checks as `Onboarding.tsx`), a 7-day attempts bar chart, a recent-exams list, a team-avatars tile linking to `/invites`, and an activity feed merging resources/exams/invites/attempts/coursework-submissions (6 most recent, sorted by timestamp). **Member view**: welcome banner + 3-KPI strip (assigned exam count from `exam_assignments.assigned_to_user` only — **does not count group assignments**, a known simplification also present in the roster/list pages — completed count, pass rate) + a single CTA tile linking to `/cbt`.

---

## 9. Edge Functions — complete reference

All 8 live in `supabase/functions/*/index.ts`, share identical CORS headers (`Access-Control-Allow-Origin: '*'`) and a `jsonResponse(body, status=200)` helper, and wrap their entire handler in try/catch → 500 on unexpected exceptions. **None of them are declared in a `config.toml`** (doesn't exist) — `verify_jwt` must be `false` at the Supabase dashboard level for all of them, since several branches take no `Authorization` header at all.

| Function | Auth model | Purpose |
|---|---|---|
| `accept-invite` | GET anon / POST requires JWT | GET previews an invite by token (service-role, bypasses RLS since invitee isn't a member yet); POST finalizes profile+membership creation and re-links prior guest attempts by email |
| `approve-pending-member` | POST requires JWT + manual owner/admin check | Approves a `pending_members` row → creates an `invites` row → emails it via Resend (non-fatally — DB writes already committed even if email send fails) |
| `check-exam-link-account` | GET anon | `{hasAccount: boolean}` — does this email already have a `profiles` row? Powers the login-vs-signup auto-detect on the public exam link |
| `confirm-exam-signup` | POST anon (uses admin API) | Admin-confirms a just-signed-up user's email, scoped only to "is this exam link still public/published" — **no email-matching against any invite**, deliberate self-service trust model |
| `confirm-invite-signup` | POST anon (uses admin API) | Admin-confirms a just-signed-up user's email, scoped to a specific pending/unexpired invite **and** requires the account's email to match that invite's email exactly |
| `generate-questions` | POST requires JWT + manual role check | Downloads a resource PDF, extracts text (`unpdf`), prompts Groq, inserts `pending_review` questions/options. See §8.2 for the token-budget history |
| `start-attempt` | GET anon (preview) / POST requires JWT | GET returns exam title/office/time-limit only. POST registers the caller as an active member (if not already) and creates/resumes their attempt, respecting `max_attempts`, returning a freshly-shuffled question set (without `is_correct`) |
| `submit-attempt` | POST anon — access control is knowledge of the unguessable `attempt_id` | Grades server-side (exact-set-match per question, no partial credit), writes `attempt_answers` + updates the `attempts` row to `submitted`. Works for both legacy guest rows and new registered-member rows from `start-attempt` |

**Cross-cutting notes**:
- Two near-identical "carry guest history into a real account" blocks exist independently in `accept-invite` POST and `start-attempt` POST (both run the same `UPDATE attempts SET user_id=... WHERE is_guest=true AND user_id IS NULL AND taker_email ILIKE <email>` pattern) — if this logic ever needs to change, update both places.
- `generate-questions` is the only function calling an external LLM and the only one touching Storage.
- `confirm-exam-signup`/`confirm-invite-signup` are the only functions calling `auth.admin.*` (privileged Supabase Auth API).
- `approve-pending-member` is the only function calling Resend.
- `submit-attempt`'s grading is **exact-set match only** — a partially-correct multi-select answer scores zero, not partial credit. An unrecognized `question_id` in the submitted answers is silently dropped from the denominator (`total`) rather than erroring — worth checking first if a score ever looks off relative to the exam's configured question count.

---

## 10. Design system (`src/index.css`, ~1148 lines)

### Tokens
Dark is the default (`:root`), overridden by `:root[data-theme='light']`. Surface: `--bg`/`--panel`/`--panel-hi`/`--line`/`--line-soft`. Text: `--text`/`--text-dim`/`--text-faint`. Accents: `--gold` (primary/active-nav/attention), `--teal` (success/passed), `--coral` (danger/failed) — each with a `-soft` background variant. Fonts: `--font-display` (Space Grotesk, headings), `--font-body` (Inter), `--font-mono` (JetBrains Mono — badges/labels/timers/KPIs). A "legacy remap" layer (`--text-h`, `--accent`, `--danger`, `--success`, etc.) exists so both old and new token names work interchangeably across the codebase — you will see both `var(--accent)` and `var(--gold)` used for the same purpose in different files.

### Key reusable class families
- `.badge` — status pill. Green group: `.approved/.published/.passed/.active`. Red group: `.rejected/.failed/.missed`. Amber group: `.pending_review/.draft/.in_progress/.pending/.submitted/.changes_requested`. (The last two, `submitted`/`changes_requested`, were added this session for coursework-assignment statuses.)
- `.exam-card`/`.exam-list`/`.exam-top`/`.exam-meta`/`.meta-item` — the rich card-list style used by `Exams.tsx` and reused as-is (no new CSS) for `Assignments.tsx`'s admin list.
- `.modal-backdrop`/`.modal` — centered dialog, used for the invite modal, question review, and the coursework review panel.
- `.drawer`/`.drawer-overlay` — right-side slide-in panel (Team page's member detail).
- `.kpi-strip`/`.kpi`, `.bento`, `.chart-bars`, `.gauge-*` — Dashboard's hand-rolled stat/chart tiles.
- `.chip`/`.chips`/`.toolbar`/`.search` — filter-chip + search-box pattern (Exams list, Assignments list).
- `.table-card`/`.t-row`/`.t-head`/`.t-body`/`.role-pill` — the Team page's member roster table.
- `.toggle-row` — label+checkbox row (ExamSettings' shuffle toggles, NewAssignment's requirement checkboxes, Assign.tsx's member/group checklists).
- `.auth-page`/`.auth-card`/`.blob-a`/`.blob-b` — full-page centered auth layout with decorative background blobs (Login/Signup/OfficeLogin/PublicTakeExam all share this).
- `.exam-question`/`.exam-option`/`.timer` — the actual exam-taking UI (shared between TakeExam.tsx and PublicTakeExam.tsx).
- `.result-hero`/`.result-score`/`.result-pass`/`.result-fail` — post-exam score display (Result.tsx, SubmitAssignment.tsx's approved state, PublicTakeExam.tsx's result stage).

Responsive breakpoints at 980px/900px/860px/640px/480px; sidebar collapses to a slide-in mobile drawer below 860px.

---

## 11. Known gaps, Phase-2 placeholders, and things a future session should NOT assume exist

- **No admin route guarding**, only nav-link hiding (§4.1). A determined member could navigate directly to an admin URL; RLS is the only real backstop.
- **Platform-admin console has zero frontend** (§4.4) — full schema/RPC support, no page consumes it.
- **`assignedCount` on the member Dashboard only counts direct `exam_assignments`, not group assignments** — a known, small, carried-over simplification (also present in `MyExams.tsx`'s dedup-by-exam logic, which collapses multiple assignment rows for the same exam into one, first-match-wins).
- **`multi_select` question type is schema-only** — never offered in question creation UI in a way that changes the exam-taking UI; both exam-taking pipelines are single-select only.
- **`skill_scores` materialized view is never refreshed or read** — dead schema.
- **`notifications`/`certificates`/`certificate_templates`/`subscriptions`/`payment_events`/`audit_log`/`learning_paths`/`learning_path_steps`/`learning_path_progress`/`proctoring_flags`** — all schema-only, RLS-enabled-with-no-policies, zero application code. `audit_log` is the one exception that IS written to, but only by the unused platform-admin RPC functions.
- **No cron/pg_cron/scheduled edge functions exist anywhere** — this was an explicit, confirmed design decision for the "missed exam" feature (§8.3.2); all "time passed, do X" logic is lazy/on-read self-healing, not time-triggered.
- **Grading is exact-set-match, no partial credit**, and is implemented **twice** independently (client-side in `TakeExam.tsx`, server-side in `submit-attempt`) — if scoring logic ever needs to change, both places need updating, and they could drift out of sync since nothing enforces they stay identical.
- **The `instructor`/Trainer DB-vs-label split (§4.3)** — don't assume `role === 'instructor'` means the UI ever displays the word "instructor" to a user; check `ROLE_LABEL` in `Invites.tsx` instead.
- **No automated tests exist** in this repo.
- **`supabase/config.toml` does not exist** — function-level settings like `verify_jwt` live only in the Supabase dashboard, not in version control. If a function starts rejecting anon calls after a fresh `supabase functions deploy`, check the dashboard's per-function JWT-verification toggle first.

---

## 12. Migration changelog (chronological, one line each)

| # | File | What it did |
|---|---|---|
| 0001 | `0001_init.sql` | Full initial schema: tenancy, exams engine, attempts, RLS, helper functions, Phase-2 reserved tables, `skill_scores` view |
| 0002 | `0002_storage.sql` | `resources` storage bucket + RLS |
| 0003 | `0003_platform_admin_and_public_link.sql` | Public exam-link columns on `exams`; nullable `attempts.user_id` + guest columns; platform-admin schema/RPCs |
| 0004 | `0004_pending_members_and_guest_contact.sql` | Guest email/whatsapp columns; `pending_members` table (select/update only); permissive org-lookup-by-slug policy |
| 0005 | `0005_public_join_request.sql` | `pending_members` INSERT policy (anonymous join requests) |
| 0006 | `0006_one_exam_per_resource.sql` | Partial unique index: one exam per resource |
| 0007 | `0007_resource_file_size.sql` | `resources.file_size_bytes` column |
| 0008 | `0008_assignment_windows_and_attempt_self_heal.sql` | `exam_assignments.starts_at/ends_at`; attempt race-safety unique index; admin-can-insert-attempt-for-member RLS policy |
| 0009 | `0009_coursework_assignments.sql` | New coursework-assignments feature: 3 tables + full RLS |

**Same-session, no-migration-needed change**: role editing (§4.2) — used an RLS policy that already existed from 0001.

---

## 13. Local development & deployment

```bash
npm run dev              # Vite dev server
npm run build             # tsc -b && vite build → dist/
npm run lint               # oxlint

# Database changes:
supabase db push --linked                     # apply pending migrations/*.sql to the linked project
supabase db query --linked "SELECT ..."       # ad-hoc query against the linked remote DB

# Edge functions:
supabase functions deploy <name1> <name2> ...  # deploy one or more functions
supabase functions list --project-ref rbzkinczddgsjvuofntq

# Frontend:
firebase deploy --only hosting                 # deploy dist/ to hq360-cbt.web.app
```

No CI/CD pipeline exists in this repo — deployments are manual, run from a developer's machine, and require explicit confirmation before touching the live linked Supabase project (per this session's working convention: never run `db push`/`functions deploy`/`firebase deploy` without the user's explicit go-ahead first).
