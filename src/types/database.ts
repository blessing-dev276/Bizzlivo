// Hand-written types for the Phase 1 subset of schema.sql.
// Regenerate/replace with `supabase gen types typescript` once the project is live.

export type MembershipRole = 'admin' | 'trainer' | 'team_leader' | 'member'
export type MembershipStatus = 'active' | 'invited' | 'suspended'
export type ExamStatus = 'draft' | 'published' | 'archived'
export type QuestionStatus = 'pending_review' | 'approved' | 'rejected'
export type QuestionType = 'mcq' | 'true_false' | 'multi_select'
export type AttemptStatus = 'in_progress' | 'submitted' | 'expired'
export type InviteStatus = 'pending' | 'accepted' | 'expired'
export type CourseworkSubmissionStatus = 'submitted' | 'approved' | 'rejected' | 'changes_requested'
export type PlanTier = 'free' | 'growth' | 'business'
export type BillingCycle = 'monthly' | 'yearly'
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
export type EventCategory =
  | 'orientation' | 'leadership_meeting' | 'network_marketing_training' | 'freelancing_training'
  | 'skill_development_class' | 'product_training' | 'workshop' | 'webinar'
  | 'recognition_event' | 'team_meeting' | 'office_announcement'
  | 'neolife_meeting' | 'assignment_deadline' | 'custom_event' | 'training_session'
export type EventVenueType = 'physical' | 'online'
export type EventStoredStatus = 'draft' | 'scheduled' | 'cancelled'

export interface Organization {
  id: string
  name: string
  slug: string
  logo_url: string | null
  brand_color: string | null
  whatsapp_number: string | null
  plan_tier: string
  status: string
  created_at: string
}

export interface Profile {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  avatar_url: string | null
  status: string | null
  sponsor_member_id: string | null
  sponsor_name: string | null
  created_at: string
}

export interface Membership {
  id: string
  org_id: string
  user_id: string
  role: MembershipRole
  status: MembershipStatus
  joined_at: string
}

export interface Invite {
  id: string
  org_id: string
  email: string | null
  phone: string | null
  role: MembershipRole
  token: string
  invited_by: string | null
  status: InviteStatus
  expires_at: string
  created_at: string
}

export interface Group {
  id: string
  org_id: string
  name: string
  leader_id: string | null
  created_at: string
}

export interface GroupMember {
  group_id: string
  user_id: string
  created_at: string
}

// Which pillar a resource was uploaded for — see 0025_resource_purpose.sql.
// Orthogonal to ResourceKind (file_type): a purpose can hold any kind.
export type ResourcePurpose = 'book' | 'skill_set' | 'freelancing'

export interface Resource {
  id: string
  org_id: string
  uploaded_by: string
  title: string
  file_url: string
  file_type: string
  file_size_bytes: number | null
  skill_tags: string[]
  purpose: ResourcePurpose
  created_at: string
}

export interface Exam {
  id: string
  org_id: string
  resource_id: string | null
  title: string
  description: string | null
  created_by: string
  status: ExamStatus
  public_link_enabled: boolean
  public_token: string
  created_at: string
}

export interface HQEvent {
  id: string
  org_id: string
  title: string
  description: string | null
  category: EventCategory
  start_at: string
  end_at: string
  venue_type: EventVenueType
  venue_location: string | null
  meeting_link: string | null
  organizer_id: string | null
  status: EventStoredStatus
  created_by: string
  created_at: string
}

export interface EventAttendee {
  event_id: string
  user_id: string
  joined_at: string
}

export interface ExamSettings {
  exam_id: string
  num_questions: number
  question_pool_size: number | null
  time_limit_minutes: number
  shuffle_questions: boolean
  shuffle_options: boolean
  pass_mark_percent: number
  max_attempts: number
  require_fullscreen: boolean
  flag_tab_switch: boolean
}

export interface Question {
  id: string
  exam_id: string
  org_id: string
  type: QuestionType
  text: string
  skill_tag: string | null
  difficulty: string | null
  order_index: number | null
  ai_generated: boolean
  reviewed_by: string | null
  reviewed_at: string | null
  status: QuestionStatus
  created_at: string
}

export interface QuestionOption {
  id: string
  question_id: string
  text: string
  is_correct: boolean
  order_index: number | null
}

export interface ExamAssignment {
  id: string
  org_id: string
  exam_id: string
  assigned_to_user: string | null
  assigned_to_group: string | null
  assigned_by: string
  due_date: string | null
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

export interface Attempt {
  id: string
  org_id: string
  exam_id: string
  user_id: string | null
  taker_name: string | null
  taker_email: string | null
  taker_whatsapp: string | null
  is_guest: boolean
  attempt_number: number
  started_at: string
  submitted_at: string | null
  status: AttemptStatus
  score_percent: number | null
  passed: boolean | null
  time_spent_seconds: number | null
}

export interface CourseworkAssignment {
  id: string
  org_id: string
  title: string
  instructions: string
  reference_link: string | null
  require_note: boolean
  require_link: boolean
  due_date: string | null
  created_by: string
  created_at: string
}

export interface CourseworkTarget {
  id: string
  assignment_id: string
  org_id: string
  assigned_to_user: string | null
  assigned_to_group: string | null
  created_at: string
}

export interface CourseworkSubmission {
  id: string
  assignment_id: string
  org_id: string
  user_id: string
  note: string | null
  link: string | null
  status: CourseworkSubmissionStatus
  review_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  submitted_at: string
}

export type PendingMemberStatus = 'pending' | 'approved' | 'rejected'

export interface PendingMember {
  id: string
  org_id: string
  full_name: string
  email: string
  phone: string | null
  source_exam_id: string | null
  source_attempt_id: string | null
  status: PendingMemberStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export interface AttemptAnswer {
  id: string
  attempt_id: string
  question_id: string
  selected_option_ids: string[]
  is_correct: boolean | null
  time_spent_seconds: number | null
}

export interface NotificationPayload {
  text: string
  link?: string
}

export interface Notification {
  id: string
  org_id: string
  user_id: string
  type: string
  channel: string
  payload: NotificationPayload | null
  status: string
  sent_at: string | null
  read_at: string | null
  created_at: string
}

export interface PlanLimits {
  plan: PlanTier
  price_monthly_kobo: number
  price_yearly_kobo: number
  max_members: number | null
  max_resources: number | null
  max_published_exams: number | null
  ai_exam_generations_per_month: number
  ai_questions_per_month: number
  removes_badge: boolean
  custom_branding: boolean
}

export interface Subscription {
  id: string
  org_id: string
  plan: PlanTier
  status: SubscriptionStatus
  provider: string
  provider_customer_id: string | null
  provider_subscription_id: string | null
  provider_plan_code: string | null
  billing_cycle: BillingCycle | null
  amount_kobo: number | null
  current_period_start: string | null
  current_period_end: string | null
  trial_ends_at: string | null
  cancel_at_period_end: boolean
  created_at: string
}

export interface PaymentEvent {
  id: string
  org_id: string
  amount: number
  currency: string
  status: string
  provider_ref: string | null
  created_at: string
}

// Shape returned by the get_org_usage(target_org_id) RPC — plan + trial
// state + usage-vs-limit for every metered resource, in one round trip.
export interface OrgUsage {
  plan: PlanTier
  status: SubscriptionStatus | null
  billing_cycle: BillingCycle | null
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  max_members: number | null
  member_count: number
  max_resources: number | null
  resource_count: number
  max_published_exams: number | null
  published_exam_count: number
  ai_exam_generations_per_month: number
  ai_exam_generations_used: number
  ai_questions_per_month: number
  ai_questions_used: number
  removes_badge: boolean
  custom_branding: boolean
}

export interface OnboardingSettings {
  org_id: string
  registration_link: string | null
  updated_at: string
}

export interface OnboardingProgress {
  org_id: string
  user_id: string
  policy_acknowledged_at: string | null
  business_explanation_viewed_at: string | null
  network_varsity_completed_at: string | null
  registered_at: string | null
}

// A step can hold several resources now (mix of PDFs, videos, links) —
// see 0024_onboarding_multi_resource.sql. Registration isn't a step here;
// it stays a single link on OnboardingSettings.
export type OnboardingStep = 'business_explanation' | 'network_varsity' | 'office_policy'
export type OnboardingItemType = 'pdf' | 'video' | 'link'

export interface OnboardingStepItem {
  id: string
  org_id: string
  step: OnboardingStep
  type: OnboardingItemType
  title: string
  file_path: string | null
  link_url: string | null
  order_index: number
  created_by: string
  created_at: string
}

// resources.file_type isn't DB-constrained, but the app only ever writes
// one of these three values — 'pdf' uploads to the private `resources`
// bucket, 'podcast'/'video' just store an external link as file_url.
export type ResourceKind = 'pdf' | 'podcast' | 'video'

export interface PersonalDevelopmentResource {
  id: string
  org_id: string
  resource_id: string
  added_by: string
  created_at: string
}

export interface PersonalDevelopmentCompletion {
  id: string
  org_id: string
  resource_id: string
  user_id: string
  completed_on: string
  created_at: string
}

// Skill Development (Training pillar): office-authored Classes, each
// split into freely-named Modules holding an ordered list of Items.
// An Item is a thin pointer into whichever system already owns that
// content type — see 0022_skill_development_classes.sql for why.
export type ClassStatus = 'draft' | 'published' | 'archived'
// Which pillar a class belongs to — see 0029_class_purpose.sql. Skill
// Development and Income Development's Skill Catalog share this same
// classes/class_modules/class_module_items schema and editor, tagged by
// purpose the same way resources.purpose separates book/skill_set/
// freelancing content on one shared `resources` table.
export type ClassPurpose = 'skill_development' | 'income_development'

export interface SkillClass {
  id: string
  org_id: string
  title: string
  description: string | null
  status: ClassStatus
  purpose: ClassPurpose
  created_by: string
  created_at: string
}

export interface ClassModule {
  id: string
  class_id: string
  org_id: string
  title: string
  order_index: number
  created_at: string
}

export type ClassModuleItemType = 'video' | 'pdf' | 'article' | 'test' | 'quiz' | 'assignment'

export interface ClassModuleItem {
  id: string
  module_id: string
  org_id: string
  type: ClassModuleItemType
  title: string
  order_index: number
  resource_id: string | null
  body: string | null
  exam_id: string | null
  coursework_assignment_id: string | null
  created_by: string
  created_at: string
}

// Only ever written for video/pdf/article items — test/quiz/assignment
// completion is read from `attempts` / `coursework_submissions` instead.
export type ClassItemProgressStatus = 'not_started' | 'in_progress' | 'completed'

export interface ClassItemProgress {
  id: string
  item_id: string
  org_id: string
  user_id: string
  status: ClassItemProgressStatus
  completed_at: string | null
  created_at: string
}

// A class can have any number of trainers, and a trainer (any active org
// member) can be attached to any number of classes — see
// 0026_class_trainers.sql. Powers "Meet your trainer" for members.
export interface ClassTrainer {
  id: string
  class_id: string
  org_id: string
  user_id: string
  added_by: string
  created_at: string
}

// Income Development (Training pillar): office-curated skill/learning
// catalog (linked resources, same pattern as Personal Development) plus a
// per-member milestone checklist, portfolio, and income log.
export interface IncomeDevelopmentResource {
  id: string
  org_id: string
  resource_id: string
  added_by: string
  created_at: string
}

export interface IncomeDevelopmentProgress {
  org_id: string
  user_id: string
  skill_selected_at: string | null
  skill_name: string | null
  portfolio_built_at: string | null
  freelancing_started_at: string | null
  first_income_at: string | null
  consistency_at: string | null
  updated_at: string
}

export interface IncomeDevelopmentPortfolioItem {
  id: string
  org_id: string
  user_id: string
  title: string
  description: string | null
  link_url: string | null
  created_at: string
}

export interface IncomeDevelopmentIncomeEntry {
  id: string
  org_id: string
  user_id: string
  amount: number
  source: string | null
  earned_on: string
  note: string | null
  created_at: string
}

// Network Marketing (Training pillar, v1): each member works their own
// contact pipeline from prospect through won customer/distributor — see
// 0028_network_marketing.sql for why a "distributor" is a CRM record here,
// not an actual HQ360 membership.
export type NetworkMarketingContactStage =
  | 'prospect' | 'invited' | 'presented' | 'followed_up' | 'won_customer' | 'won_distributor' | 'lost'

export interface NetworkMarketingProduct {
  id: string
  org_id: string
  name: string
  description: string | null
  link_url: string | null
  added_by: string
  created_at: string
}

// The foundational NeoLife training curriculum (Sound Health, Cool Wealth,
// Fact About Life, etc.) — office-curated, same shape as Products.
export interface NetworkMarketingBasic {
  id: string
  org_id: string
  title: string
  description: string | null
  link_url: string | null
  added_by: string
  created_at: string
}

export interface NetworkMarketingContact {
  id: string
  org_id: string
  user_id: string
  full_name: string
  phone: string | null
  email: string | null
  stage: NetworkMarketingContactStage
  interested_product_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface NetworkMarketingActivity {
  id: string
  org_id: string
  contact_id: string
  user_id: string
  note: string
  stage: NetworkMarketingContactStage | null
  created_at: string
}

// Tasks: a single office-wide, ordered learning flow — each step points at
// existing Learning Center content (a class, exam, or assignment), one
// step unlocking per day. See 0033_task_flow.sql for why there's no
// separate progress table — completion is derived from the signal each
// content type already tracks elsewhere.
export type TaskFlowStepType = 'class' | 'exam' | 'assignment'

export interface TaskFlowStep {
  id: string
  org_id: string
  title: string
  description: string | null
  order_index: number
  type: TaskFlowStepType
  class_id: string | null
  exam_id: string | null
  coursework_assignment_id: string | null
  created_by: string
  created_at: string
}
