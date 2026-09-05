# HQ360 — Learning Center / Training Structure & Flow

A platform-agnostic spec of how the **Learning Center** and the **Training**
journey work in HQ360, extracted from the running codebase (React + Supabase).
Use it to rebuild the same structure elsewhere.

> Everything is **multi-tenant**: every table is scoped by `org_id`
> (an "office"). Every query below is implicitly `where org_id = <current office>`.

---

## 1. Mental model

```
Learning Center  (admin-only nav group — a container, not a page)
├── Exams          → CBT engine (question bank, timed attempts, grading)
├── Assignments    → coursework (instructions → submit note/link → review)
└── Training       → the member growth journey (the subject of this doc)
        │
        └── 5 ordered stages (a horizontal stepper):
            1. Onboarding            — one-time gated checklist
            2. Personal Development  — recurring daily list (resets each day)
            3. Skill Development     — office-authored Classes › Modules › Items
            4. Income Development    — milestones + portfolio + income log + Skill Catalog
            5. Network Marketing     — CRM pipeline (destination stage, v1 slice)

Tasks  (separate top-level nav item, for everyone)
└── One office-wide ordered flow; each step points at existing Learning
    Center content; one step unlocks per day.
```

Two cross-cutting ideas make the whole thing hang together:

1. **Thin-pointer / "don't duplicate content".** Skill Development items,
   Task steps, etc. never re-implement video/quiz/submission handling — they
   store a foreign key into whichever subsystem already owns that content
   type (`resources`, `exams`, `coursework_assignments`).
2. **Derived completion.** Wherever possible there is *no* dedicated progress
   table. "Did this member finish?" is computed live from the signal the
   underlying subsystem already records (`attempts`, `coursework_submissions`,
   `class_item_progress`).

---

## 2. Navigation & routing

| Route | Component | Who sees it |
|---|---|---|
| `/training` | `Training` (stage stepper + active stage view) | Everyone. Admins reach it under the **Learning Center** nav group; members get a top-level **Training** link. |
| `/training/classes/:classId` | `ClassDetail` → `ClassEditor` (managers) or `ClassPlayer` (members) | Everyone; view differs by role |
| `/tasks` | `TasksHub` → `TasksAdmin` or `TasksMember` | Everyone (top-level nav) |
| `/reports/training` | `TrainingAnalytics` | Admin/Trainer — mostly roadmap today, wired to a dormant `learning_paths` scaffold; **not** required to rebuild the flow |
| `/exams`, `/assignments` | Exam & coursework managers | Admin/Trainer/Team Leader |

The **Learning Center** group in the sidebar is purely a visual grouping of
`/exams`, `/assignments`, `/training`. It has no page of its own.

### `Training` page composition

```
<Training>
  <h1>Training</h1>
  <JourneyStepper>              // 5 buttons, click to switch active stage
    1 Onboarding  2 Personal Development  3 Skill Development
    4 Income Development  5 Network Marketing
  </JourneyStepper>

  {activeStage === 'Onboarding'}            → <OnboardingHub/>
  {activeStage === 'Personal Development'}  → <PersonalDevelopmentHub/>
  {activeStage === 'Skill Development'}     → <SkillDevelopmentHub/>
  {activeStage === 'Income Development'}    → <IncomeDevelopmentHub/>
  {activeStage === 'Network Marketing'}    → <NetworkMarketingHub/>
```

Each `*Hub` inspects the current user's role and renders either the **manage**
view or the **member** view of that stage.

---

## 3. Roles & permission model

Four roles: `admin`, `trainer`, `team_leader`, `member`
(there is no "owner"/"instructor" any more).

| Stage | Who can manage/author | Who consumes |
|---|---|---|
| Onboarding | `admin` | everyone else |
| Personal Development | `admin` | everyone else |
| Skill Development | `admin`, `trainer`, `team_leader` | `member` |
| Income Development | `admin` (milestones/log are per-member) · Skill Catalog: `admin`, `trainer`, `team_leader` | `member` |
| Network Marketing | `admin` (products/basics) · pipeline is per-member | `member` |
| Tasks | `admin`, `trainer`, `team_leader` | `member` |

"Manage" access must be enforced **server-side** (HQ360 uses Postgres RLS).
A manager building a Skill Development class also needs write access to
`resources`, `coursework_assignments`, and `coursework_targets`, because the
class editor creates those inline.

---

## 4. Shared infrastructure (the subsystems everything points into)

### 4.1 `resources` — the file/link library

```
resources
  id            uuid pk
  org_id        uuid
  uploaded_by   uuid
  title         text
  file_url      text          -- storage path (pdf) OR external URL (podcast/video)
  file_type     text          -- app writes 'pdf' | 'podcast' | 'video'
  purpose       text  NOT NULL default 'skill_set'
                      -- 'book'       → Personal Development
                      -- 'skill_set'  → Skill Development classes
                      -- 'freelancing'→ Income Development classes
  skill_tags    text[]
  created_at    timestamptz
```

`purpose` is what keeps each pillar's picker from showing every file in the
office. `file_type` (the *kind*) is orthogonal — a purpose can hold any kind.
PDFs live in a private bucket and are served via short-lived signed URLs
(1 h TTL); podcast/video just store an external link in `file_url`.

### 4.2 `exams` + attempts — the CBT engine

```
exams(id, org_id, title, description, status['draft'|'published'|'archived'],
      public_link_enabled bool, public_token uuid, ...)
exam_settings(exam_id pk, num_questions, time_limit_minutes, pass_mark_percent,
              max_attempts, shuffle_*, ...)
questions / question_options            -- MCQ / true-false / multi-select
attempts(id, org_id, exam_id, user_id, attempt_number, started_at,
         submitted_at, status['in_progress'|'submitted'|'expired'],
         score_percent, passed bool, time_spent_seconds)
attempt_answers(...)
```

An exam is consumed elsewhere via its **public link**
(`/take/<public_token>`), which requires `public_link_enabled = true`.
**Pass = `attempts.status='submitted' AND passed=true`.**

### 4.3 `coursework_assignments` — submit / review tasks

```
coursework_assignments
  id, org_id, title, instructions, reference_link,
  require_note bool default true, require_link bool default false,
  due_date, created_by, created_at        -- CHECK (require_note OR require_link)

coursework_targets                        -- who the assignment is for
  id, assignment_id, org_id,
  assigned_to_user uuid | assigned_to_group uuid   -- one of the two

coursework_submissions                    -- one row per (assignment, user)
  id, assignment_id, org_id, user_id,
  note, link,
  status ['submitted'|'approved'|'rejected'|'changes_requested'],
  review_note, reviewed_by, reviewed_at, submitted_at
  UNIQUE (assignment_id, user_id)
```

Members can only ever *write* `status='submitted'` (insert or resubmit).
Only a manager sets approved/rejected/changes_requested.
**Done = a `coursework_submissions` row with `status='approved'`.**

Targeting is a **one-time snapshot** of active members — people who join later
are not retroactively added (except where a step explicitly backfills, see §9).

### 4.4 Dormant: `learning_paths` / `learning_path_steps` / `learning_path_progress`

A Phase-2 scaffold with RLS but effectively no UI. `TrainingAnalytics` reads
counts from it. **Ignore it for a rebuild** — the live Training flow does not
use it.

---

## 5. Stage 1 — Onboarding

**Shape:** a one-time, linear, self-reported checklist. Order:
**Business Explanation → Network Varsity → Office Policy → Registration Link.**
Every step except Registration can hold *several* items (any mix of PDF / video /
external link).

### 5.1 Data model

```
onboarding_settings                       -- one row per office
  org_id pk
  registration_link  text | null
  updated_at

onboarding_step_items                     -- content for the first 3 steps
  id, org_id,
  step  text  CHECK IN ('business_explanation','network_varsity','office_policy'),
  type  text  CHECK IN ('pdf','video','link'),
  title,
  file_path  text | null,   -- storage path in the private `onboarding` bucket (pdf/video)
  link_url   text | null,   -- external URL (link)
  order_index int,
  created_by, created_at
  -- CHECK ( (type in ('pdf','video') AND file_path is not null AND link_url is null)
  --      OR (type = 'link'          AND link_url  is not null AND file_path is null) )

onboarding_progress                       -- one row per (office, member)
  org_id, user_id  (composite pk)
  business_explanation_viewed_at  timestamptz | null
  network_varsity_completed_at    timestamptz | null
  policy_acknowledged_at          timestamptz | null
  registered_at                   timestamptz | null
```

Storage path convention: `onboarding/<org_id>/<step>/<item_id>.<ext>`.
Files are private; served via signed URLs.

### 5.2 Admin flow (`OnboardingAdmin`)

1. For each of the 3 content steps: **+ Add item** → choose type
   (PDF upload / Video upload / Link) → title → save. Items list with Remove.
2. **Registration Link** step: paste a URL, Save → upsert `onboarding_settings`.
3. **Member Progress** table: every active member × 4 columns
   (Business Explanation / Network Varsity / Office Policy / Registered),
   each showing the timestamp or `—`.

### 5.3 Member flow (`OnboardingMember`)

- Steps render in order; **the next unlocks only when the previous is done**:
  - `business_explanation` — always available
  - `network_varsity` — available once `business_explanation_viewed_at` set
  - `office_policy` — available once `network_varsity_completed_at` set
  - Registration — available once `policy_acknowledged_at` set
- Each unlocked step shows its items (inline `<video>` for videos, links for
  PDFs/links) and an **"I've completed this step"** button that stamps the
  matching `*_at` column (`upsert onboarding_progress`).
- Registration step shows a "Go to registration →" link and an
  **"I've completed registration"** button → stamps `registered_at`.
- Completion is **self-reported** — no verification that a video was watched.

```
[Business Explanation] --done--> [Network Varsity] --done--> [Office Policy] --done--> [Registration]
      (always open)                (locked until)              (locked until)           (locked until)
```

---

## 6. Stage 2 — Personal Development

**Shape:** a recurring **daily** list of books / podcasts / videos every member
is expected to consume. One shared org-wide list. **Completion resets every
calendar day.**

### 6.1 Data model

```
personal_development_resources            -- the required daily list (org-wide)
  id, org_id,
  resource_id  → resources(id)            -- must have resources.purpose = 'book'
  added_by, created_at
  UNIQUE (org_id, resource_id)

personal_development_completions          -- per member per day per resource
  id, org_id, resource_id, user_id,
  completed_on  date  NOT NULL            -- calendar day
  created_at
  UNIQUE (resource_id, user_id, completed_on)
```

### 6.2 Admin flow (`PersonalDevelopmentAdmin`)

- Grouped view of the required list by kind: **Books / Podcasts / Videos**.
- **Add a resource:** pick kind → title → PDF file *or* podcast/video link →
  this both `createResource({ purpose:'book' })` **and** inserts the
  `personal_development_resources` link row.
- Remove unlinks (deletes the link row).
- **Today's Progress** table: each active member → `doneToday / totalRequired`
  (counts distinct `personal_development_completions` rows for `completed_on =
  today`).

### 6.3 Member flow (`PersonalDevelopmentMember`)

- "Your office's daily growth list — get through everything below today. It
  resets tomorrow."
- Header badges: `X of N done today` and a **streak** count.
- Each resource: Open → link, then **"Mark done today"** (inserts a completion
  row for today) / **Undo** (deletes today's row).
- **Streak algorithm:** walk backwards day by day from today; a day counts if
  the member completed **≥ every required resource** that day; stop at the
  first gap. If today isn't fully done yet, start counting from yesterday.
  (Lookback window in the UI: 60 days.)

---

## 7. Stage 3 — Skill Development  ★ the richest stage

**Shape:** the office authors its own curriculum as **Classes**. A Class has an
ordered list of **Modules** (free-text names — "Module 1", "Week 1", "Basics"),
each Module holds an ordered list of **Items**. An Item is one of six types,
each a thin pointer into an existing subsystem.

> The **same** schema + editor is reused by Income Development's "Skill
> Catalog", distinguished by `classes.purpose`.

### 7.1 Data model

```
classes
  id, org_id, title, description,
  status  text default 'draft'   -- 'draft' | 'published' | 'archived'
  purpose text default 'skill_development'
          CHECK IN ('skill_development','income_development')
  created_by, created_at

class_modules
  id, class_id, org_id, title, order_index, created_at

class_module_items
  id, module_id, org_id,
  type  text CHECK IN ('video','pdf','article','test','quiz','assignment'),
  title, order_index,
  resource_id               → resources(id)               -- video | pdf
  body                      text                          -- article (inline content)
  exam_id                   → exams(id)                    -- test | quiz
  coursework_assignment_id  → coursework_assignments(id)   -- assignment
  created_by, created_at
  -- CHECK: exactly ONE content pointer, matching `type`:
  --   video|pdf   → resource_id set, others null
  --   article     → body set, others null
  --   test|quiz   → exam_id set, others null   ("test" vs "quiz" is just a label)
  --   assignment  → coursework_assignment_id set, others null

class_item_progress                       -- ONLY for video / pdf / article items
  id, item_id, org_id, user_id,
  status text default 'not_started'       -- 'not_started'|'in_progress'|'completed'
  completed_at timestamptz | null
  created_at
  UNIQUE (item_id, user_id)
  -- test/quiz/assignment completion is NEVER stored here — it's derived from
  -- attempts / coursework_submissions.

class_trainers                            -- many trainers per class, many classes per trainer
  id, class_id, org_id, user_id, added_by, created_at
  UNIQUE (class_id, user_id)
```

Which `resources.purpose` the video/PDF picker draws from:
`class.purpose = 'income_development'` → `'freelancing'` resources, otherwise
`'skill_set'`. (Personal Development's `'book'` resources never appear.)

### 7.2 Manage flow — `SkillDevelopmentAdmin` (list) + `ClassEditor` (detail)

**List page:**
- Filter chips: All / Draft / Published / Archived (+ counts). Search by title.
- Each card: title (link), created date, status badge, `N modules · M items`.
- **+ New class** modal → title + optional description → inserts `classes`
  row (`purpose` from context, `status='draft'`) → navigates to the editor.

**Class editor (`/training/classes/:classId`):**
- **Header:** title + status badge, Edit details (title/description),
  and actions: **Publish** / **Unpublish** (back to draft) / **Archive** /
  **Delete** (cascades modules, items, progress).
  - Publish is blocked unless the class has **≥ 1 module**.
  - On publish: notify every active member ("New class published: …",
    link to the class).
- **Trainers card:** + Add trainer (picker scoped to `admin`/`trainer`
  members) / Remove. Powers "Meet your trainer" for members.
- **Modules:** each module card has ↑ / ↓ (swap `order_index`), Rename,
  Delete (cascades items). **+ Add module** (name).
- **Items** (per module): list with type badge + title + Remove.
  **+ Add item** modal — pick **Type**, enter **Title**, then type-specific:
  | Type | Extra input | What it writes |
  |---|---|---|
  | Video | pick a `video` resource, or **+ Add new video** (title + external link → `createResource`) | `resource_id` |
  | PDF | pick a `pdf` resource, or **+ Add new PDF** (title + file ≤ 20 MB → upload + `createResource`) | `resource_id` |
  | Article | rich text body | `body` |
  | Test / Quiz | pick a **published** exam | `exam_id` |
  | Assignment | instructions, optional reference link, optional due date, require-note / require-link toggles | creates a `coursework_assignments` row **+** `coursework_targets` for every active member, then links `coursework_assignment_id` |
- New items get `order_index = current item count` (appended).

### 7.3 Member flow — `SkillDevelopmentMember` (list) + `ClassPlayer` (detail)

**List:** published classes only, title (link) + description.

**Class player:**
- Header: title, description, `X of Y complete` badge (Y = total items).
- **Meet your trainer(s)** card (if any): avatar + name + **Ask a question**
  → sends an in-app notification to that trainer (`type='trainer_question'`,
  links back to the class). No chat thread — a one-off ping.
- Modules in order; each item rendered by type:
  | Type | Member actions | "Complete" means |
  |---|---|---|
  | Video / PDF | **Open →** (signed URL / link) · **Mark done** / **Undo** | a `class_item_progress` row with `status='completed'` |
  | Article | **Read** (expand `body`) · **Mark done** / **Undo** | same as above |
  | Test / Quiz | **Take test/quiz →** to `/take/<exam.public_token>` (only if `public_link_enabled`; else "not open yet") | a passing `attempts` row (`submitted` + `passed`) |
  | Assignment | status badge + **Submit → / View →** to `/my-assignments/<id>` | a `coursework_submissions` row with `status='approved'` |
- `totalDone = items.filter(isItemComplete).length`, evaluated with the rules
  in the table above.

---

## 8. Stage 4 — Income Development

**Shape:** get a member from "learning a digital skill" to "earning first
income" before Network Marketing. A tabbed view; per-member state.

Tabs: **Overview · Skill Catalog · Portfolio · Income · Milestones**

### 8.1 Data model

```
income_development_resources              -- org-wide skill/learning catalog (link rows)
  id, org_id, resource_id → resources(id), added_by, created_at
  UNIQUE (org_id, resource_id)
  -- (In practice the "Skill Catalog" tab reuses the classes editor with
  --  purpose='income_development'; this link table mirrors Personal Dev's pattern.)

income_development_progress               -- one row per (office, member) — a linear checklist
  org_id, user_id  (composite pk)
  skill_selected_at       timestamptz | null
  skill_name              text | null
  portfolio_built_at      timestamptz | null
  freelancing_started_at  timestamptz | null
  first_income_at         timestamptz | null      -- auto-set from first income entry
  consistency_at          timestamptz | null
  updated_at

income_development_portfolio_items        -- member-owned, freeform
  id, org_id, user_id, title, description, link_url, created_at

income_development_income_entries         -- member-owned income log
  id, org_id, user_id,
  amount   numeric(12,2)  CHECK (amount > 0),
  source   text | null,
  earned_on date NOT NULL,
  note     text | null,
  created_at
```

### 8.2 Flow

- **Overview:** summary pills — `milestones X of 5`, chosen skill, portfolio
  item count, total earned (₦), first-income date. At 5/5: "ready for Network
  Marketing 🎉".
- **Skill Catalog:** renders the **Skill Development** list/editor with
  `purpose='income_development'` (managers get `SkillDevelopmentAdmin`,
  members get `SkillDevelopmentMember`). Same Classes › Modules › Items,
  separate content set, video/PDF picker draws from `'freelancing'` resources.
- **Portfolio:** add / remove `income_development_portfolio_items`
  (title + optional link + optional description).
- **Income:** log / delete `income_development_income_entries`
  (amount + optional source + date + optional note). Shows total + first-income
  date. **Logging the first entry auto-stamps `first_income_at`** (milestone 4).
- **Milestones** (linear checklist, self-paced, mostly toggle on/off):
  1. **Learn a digital skill** — enter skill name → stamps `skill_selected_at` + `skill_name`
  2. **Build a portfolio** — toggle `portfolio_built_at`
  3. **Start freelancing** — toggle `freelancing_started_at`
  4. **Earn first income** — *auto* from the income log (not a manual button)
  5. **Build consistency** — toggle `consistency_at`

---

## 9. Stage 5 — Network Marketing (destination stage, v1 slice)

Not a learning module — a per-member **CRM pipeline** plus office-curated
reference lists. Included here only for completeness; it's a v1 slice, not the
full spec.

```
network_marketing_products(id, org_id, name, description, link_url, added_by, created_at)
network_marketing_basics  (id, org_id, title, description, link_url, added_by, created_at)
        -- foundational NeoLife curriculum links (Sound Health, Cool Wealth, …)

network_marketing_contacts               -- each member works their own pipeline
  id, org_id, user_id, full_name, phone, email,
  stage text ['prospect'|'invited'|'presented'|'followed_up'
             |'won_customer'|'won_distributor'|'lost'],
  interested_product_id → network_marketing_products(id),
  notes, created_at, updated_at

network_marketing_activities             -- timeline log per contact
  id, org_id, contact_id, user_id, note, stage, created_at
```

Admin curates Products + Basics; each member manages their own contacts and
logs activities as contacts move through the stages. A "distributor" here is a
CRM record, **not** an HQ360 membership.

---

## 10. Tasks — the daily-unlock flow (separate from Training)

**Shape:** one office-wide **ordered** sequence. Each step is a thin pointer at
existing Learning Center content. **One step unlocks per day.** No progress
table — completion is derived.

### 10.1 Data model

```
task_flow_steps
  id, org_id, title, description, order_index,
  type  text CHECK IN ('class','exam','assignment'),
  class_id                  → classes(id)                  on delete cascade
  exam_id                   → exams(id)                    on delete cascade
  coursework_assignment_id  → coursework_assignments(id)   on delete cascade
  created_by, created_at
  -- CHECK: exactly one pointer, matching `type`.
```

### 10.2 Admin flow (`TasksAdmin`)

- Ordered list, "Day 1 · …", "Day 2 · …" with type badge + linked content
  title (+ class purpose). ↑ / ↓ reorder, Remove.
- **+ Add step** modal: type (Class / Exam / Assignment) → pick from
  **published** classes / **published** exams / any assignment → title shown
  to members (defaults to the content's title) → optional description.
- Picking an **assignment** step **backfills `coursework_targets`** for any
  active member not already targeted (so the shared flow works for everyone).
  Classes/exams need no backfill — a published class is org-wide, exam steps
  use the public take-exam link.
- Removing a step does **not** lose member progress (it's derived, not stored).

### 10.3 Member flow (`TasksMember`)

For each step, completion is computed live:

| Step type | Complete when | `completedAt` |
|---|---|---|
| `class` | **every** item in the class is complete (per §7.3 rules); empty class/module ⇒ trivially complete | latest item completion time |
| `exam` | earliest `attempts` row with `status='submitted' AND passed=true` | that attempt's `submitted_at` |
| `assignment` | `coursework_submissions.status='approved'` | its `reviewed_at` |

**Unlock rule:**
- Step 1 is always available.
- Step *i* is available iff step *i-1* is **complete** *and*
  `now ≥ prev.completedAt + 24h`.
  (If `completedAt` is somehow null, treat as available.)
- The first not-complete step is the "current" one and gets a highlighted
  border; a locked current step shows "Unlocks &lt;timestamp&gt;".
- Each available step shows a CTA: Go to class → / Take exam → / Go to
  assignment →. All steps done ⇒ "You've completed every step. 🎉".

```
Day 1  ─done─▶  (wait 24h)  ─▶  Day 2  ─done─▶  (wait 24h)  ─▶  Day 3 …
```

---

## 11. Completion / progress rules — consolidated

| Content | Signal that = "done" | Stored or derived |
|---|---|---|
| Onboarding step | `onboarding_progress.<step>_at` is set (self-reported) | **stored** |
| Personal Development resource (today) | `personal_development_completions` row for `(resource, user, today)` | **stored**, per-day |
| Class item — video / pdf / article | `class_item_progress.status = 'completed'` | **stored** |
| Class item — test / quiz | passing `attempts` row (`submitted` + `passed`) | **derived** from `attempts` |
| Class item — assignment | `coursework_submissions.status = 'approved'` | **derived** |
| Whole class | all items done | **derived** |
| Income milestone 1/2/3/5 | timestamp column set (toggle) | **stored** |
| Income milestone 4 (first income) | auto-set when first income entry logged | **stored**, auto |
| Task step | see §10.3 | **derived** |

---

## 12. Full table inventory (Training + Tasks)

| Table | Grain | Purpose |
|---|---|---|
| `onboarding_settings` | 1 / office | registration link |
| `onboarding_step_items` | N / (office, step) | onboarding content (pdf/video/link) |
| `onboarding_progress` | 1 / (office, member) | 4 self-reported timestamps |
| `personal_development_resources` | N / office | required daily list (→ `resources` `purpose='book'`) |
| `personal_development_completions` | 1 / (resource, member, day) | daily completion, resets |
| `classes` | N / office | curriculum unit; `purpose` = skill vs income |
| `class_modules` | N / class | ordered, free-text sections |
| `class_module_items` | N / module | ordered items, one of 6 types, thin pointer |
| `class_item_progress` | 1 / (item, member) | completion for video/pdf/article only |
| `class_trainers` | N / class | trainer assignment (→ "Meet your trainer") |
| `income_development_resources` | N / office | skill catalog links (mirrors PD) |
| `income_development_progress` | 1 / (office, member) | 5-milestone linear checklist |
| `income_development_portfolio_items` | N / member | freeform portfolio |
| `income_development_income_entries` | N / member | income log (drives milestone 4) |
| `network_marketing_products` | N / office | curated product list |
| `network_marketing_basics` | N / office | curated NeoLife training links |
| `network_marketing_contacts` | N / member | personal CRM pipeline |
| `network_marketing_activities` | N / contact | contact timeline |
| `task_flow_steps` | N / office | ordered daily-unlock flow, thin pointer |
| — | — | *(no task progress table — derived)* |
| `resources`, `exams`/`attempts`/…, `coursework_*` | shared | subsystems everything points into |

---

## 13. Rebuild checklist

1. **Tenancy + roles first.** Every table `org_id`-scoped; enforce
   manage-vs-consume per §3 on the server, not just the UI.
2. **Build the 3 shared subsystems** (`resources` with a `purpose` tag,
   an exam/attempt engine with a public take link, coursework
   assignments/targets/submissions) — Training leans on all three.
3. **Training shell:** a 5-item stepper that swaps the active stage view;
   each stage view branches on role.
4. **Onboarding:** 3 content steps (multi-item) + registration link;
   `progress` = 4 timestamps; strict previous-step gating; self-reported.
5. **Personal Development:** org-wide required list (kind = book/podcast/video),
   per-day completion table, daily reset, streak = consecutive fully-done days.
6. **Skill Development:** `classes → modules → items`; 6 item types each a FK
   into a subsystem with a single-pointer CHECK; `draft/published/archived`;
   publish needs ≥1 module + notifies members; per-item progress only for
   passive content; derive quiz/assignment/whole-class completion; trainers
   join table + "ask a question" notification.
7. **Income Development:** reuse the classes editor tagged
   `purpose='income_development'` for the Skill Catalog; add per-member
   `progress` (5 milestones), `portfolio_items`, `income_entries`
   (first entry auto-completes milestone 4).
8. **Network Marketing:** curated `products` + `basics`; per-member `contacts`
   with a 7-value `stage` enum; `activities` timeline.
9. **Tasks:** one ordered `task_flow_steps` list (class/exam/assignment
   pointer); **no** progress table — derive completion from the same signals;
   step *i* opens 24 h after step *i-1*'s derived completion; assignment steps
   backfill targets for all active members.
10. **Analytics** is optional/roadmap — safe to defer.

### Gotchas carried over from HQ360

- Targeting (assignments, class assignment-items, task assignment-steps) is a
  **one-time snapshot** of active members; late joiners aren't auto-added
  except by the Tasks assignment-step backfill.
- Private files (onboarding PDFs/videos, `resources` PDFs) need short-lived
  **signed URLs**, not public paths.
- "Test" and "Quiz" are the **same** thing — just a label the office picks.
- A class with zero items/modules counts as **trivially complete** for a Task
  step — guard against empty classes if that matters to you.
- `class_item_progress` is never written for test/quiz/assignment items —
  don't add rows there or the derived counts double-count.
