// Learning Center v2 (0038_learning_center.sql). One consistent
// Area → Section → Module → Item model. Content is always a pointer at an
// existing resource / exam / coursework_assignment — never duplicated.
//
// Four areas run on classes / class_modules / class_module_items:
//   network_marketing (NeoLife Basics), freelancing, personal_development
//   (Mind Training), income_development.
// Onboarding keeps its own onboarding_modules / onboarding_step_items
// (own storage bucket + step-gated progress). Network Marketing Products
// keep network_marketing_products (+ video/pdf/exam slots). Personal
// Development Resources stay a personal_development_resources library.
import { supabase } from './supabase'
import type {
  ClassModule,
  ClassModuleItem,
  ClassModuleItemType,
  LearningArea,
  SkillClass,
} from '../types/database'

export interface AreaDef {
  key: LearningArea
  label: string
  blurb: string
  tint: string
  /** areas whose sections are classes-backed */
  classesBacked: boolean
  /** sub-tabs shown inside the area, if any */
  tabs?: string[]
}

export const LEARNING_AREAS: AreaDef[] = [
  { key: 'onboarding', label: 'Onboarding', blurb: 'The first steps every new member takes.', tint: 'var(--tint-primary)', classesBacked: false },
  { key: 'network_marketing', label: 'Network Marketing', blurb: 'NeoLife foundations and the product catalog.', tint: 'var(--tint-people)', classesBacked: true, tabs: ['NeoLife Basics', 'Products'] },
  { key: 'freelancing', label: 'Freelancing', blurb: 'From learning a skill to earning from clients.', tint: 'var(--tint-learn)', classesBacked: true },
  { key: 'personal_development', label: 'Personal Development', blurb: 'Mind training and a personal-growth library.', tint: 'var(--tint-events)', classesBacked: true, tabs: ['Mind Training', 'Resources'] },
  { key: 'income_development', label: 'Income Development', blurb: 'Learn how to produce income, step by step.', tint: 'var(--tint-ok)', classesBacked: true },
]

export function areaDef(key: string): AreaDef | undefined {
  return LEARNING_AREAS.find((a) => a.key === key)
}

// Which resources.purpose bucket an area's video/PDF picker draws from.
export function resourcePurposeFor(area: LearningArea): 'book' | 'skill_set' | 'freelancing' {
  if (area === 'personal_development') return 'book'
  if (area === 'income_development') return 'freelancing'
  return 'skill_set'
}

export const ITEM_TYPE_LABEL: Record<ClassModuleItemType, string> = {
  video: 'Video',
  pdf: 'PDF',
  podcast: 'Podcast',
  link: 'Link',
  article: 'Article',
  test: 'Quiz',
  quiz: 'Quiz',
  assignment: 'Assignment',
}

// Types whose completion is a class_item_progress row (vs. derived from
// attempts / coursework_submissions).
export const PROGRESS_TRACKED = new Set<ClassModuleItemType>(['video', 'pdf', 'article', 'link', 'podcast'])

export interface Section extends SkillClass {
  moduleCount: number
  itemCount: number
}

export interface ModuleWithItems extends ClassModule {
  items: ClassModuleItem[]
}

export async function loadSections(orgId: string, area: LearningArea): Promise<Section[]> {
  const { data: classes } = await supabase
    .from('classes')
    .select('*')
    .eq('org_id', orgId)
    .eq('area', area)
    .order('section_order', { ascending: true })
    .order('created_at', { ascending: true })
  const rows = (classes as SkillClass[]) ?? []
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const { data: mods } = await supabase.from('class_modules').select('id, class_id').in('class_id', ids)
  const moduleRows = (mods as { id: string; class_id: string }[]) ?? []
  const modByClass = new Map<string, string[]>()
  for (const m of moduleRows) {
    const list = modByClass.get(m.class_id) ?? []
    list.push(m.id)
    modByClass.set(m.class_id, list)
  }
  const allModuleIds = moduleRows.map((m) => m.id)
  const itemCountByModule = new Map<string, number>()
  if (allModuleIds.length > 0) {
    const { data: items } = await supabase.from('class_module_items').select('module_id').in('module_id', allModuleIds)
    for (const it of (items as { module_id: string }[]) ?? []) {
      itemCountByModule.set(it.module_id, (itemCountByModule.get(it.module_id) ?? 0) + 1)
    }
  }
  return rows.map((r) => {
    const ms = modByClass.get(r.id) ?? []
    return {
      ...r,
      moduleCount: ms.length,
      itemCount: ms.reduce((n, id) => n + (itemCountByModule.get(id) ?? 0), 0),
    }
  })
}

export async function loadSectionModules(orgId: string, sectionId: string, publishedOnly: boolean): Promise<ModuleWithItems[]> {
  let q = supabase.from('class_modules').select('*').eq('class_id', sectionId).order('order_index', { ascending: true })
  if (publishedOnly) q = q.eq('status', 'published')
  const { data: mods } = await q
  const moduleRows = (mods as ClassModule[]) ?? []
  if (moduleRows.length === 0) return []
  const { data: items } = await supabase
    .from('class_module_items')
    .select('*')
    .in('module_id', moduleRows.map((m) => m.id))
    .order('order_index', { ascending: true })
  const itemRows = (items as ClassModuleItem[]) ?? []
  void orgId
  return moduleRows.map((m) => ({ ...m, items: itemRows.filter((it) => it.module_id === m.id) }))
}

export interface MemberCtx {
  progressItemIds: Set<string>
  passedExamIds: Set<string>
  approvedAssignmentIds: Set<string>
}

export async function loadMemberCtx(orgId: string, userId: string): Promise<MemberCtx> {
  const [prog, attempts, submissions] = await Promise.all([
    supabase.from('class_item_progress').select('item_id').eq('org_id', orgId).eq('user_id', userId).eq('status', 'completed'),
    supabase.from('attempts').select('exam_id').eq('org_id', orgId).eq('user_id', userId).eq('status', 'submitted').eq('passed', true),
    supabase.from('coursework_submissions').select('assignment_id').eq('org_id', orgId).eq('user_id', userId).eq('status', 'approved'),
  ])
  return {
    progressItemIds: new Set(((prog.data as { item_id: string }[]) ?? []).map((r) => r.item_id)),
    passedExamIds: new Set(((attempts.data as { exam_id: string }[]) ?? []).map((r) => r.exam_id)),
    approvedAssignmentIds: new Set(((submissions.data as { assignment_id: string }[]) ?? []).map((r) => r.assignment_id)),
  }
}

export function itemDone(item: ClassModuleItem, ctx: MemberCtx): boolean {
  if (item.type === 'test' || item.type === 'quiz') return !!item.exam_id && ctx.passedExamIds.has(item.exam_id)
  if (item.type === 'assignment') return !!item.coursework_assignment_id && ctx.approvedAssignmentIds.has(item.coursework_assignment_id)
  return ctx.progressItemIds.has(item.id)
}

export function moduleProgress(mod: ModuleWithItems, ctx: MemberCtx): { done: number; total: number; complete: boolean } {
  const total = mod.items.length
  const done = mod.items.filter((it) => itemDone(it, ctx)).length
  return { done, total, complete: total > 0 && done >= total }
}

export function itemHref(item: ClassModuleItem): string | null {
  if (item.type === 'link') return item.link_url
  if (item.type === 'video' || item.type === 'pdf' || item.type === 'podcast') return item.resource_id ? `resource:${item.resource_id}` : null
  if (item.type === 'test' || item.type === 'quiz') return item.exam_id ? `/quizzes/${item.exam_id}` : null
  if (item.type === 'assignment') return item.coursework_assignment_id ? `/my-assignments/${item.coursework_assignment_id}` : null
  return null
}

// Mark a progress-tracked item complete for the current member.
export async function markItemComplete(orgId: string, userId: string, itemId: string) {
  return supabase
    .from('class_item_progress')
    .upsert(
      { org_id: orgId, user_id: userId, item_id: itemId, status: 'completed', completed_at: new Date().toISOString() },
      { onConflict: 'item_id,user_id' },
    )
}

export async function unmarkItem(userId: string, itemId: string) {
  return supabase.from('class_item_progress').delete().eq('user_id', userId).eq('item_id', itemId)
}

// ---- day-based drip release (0065) ----

/**
 * Idempotently records that the current member has started this section
 * (their personal "Day 1") and returns the start date as 'YYYY-MM-DD'.
 * Call it when the member opens the section.
 */
export async function startClass(classId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('start_class', { p_class: classId })
  if (error) return null
  return (data as string) ?? null
}

export interface ModuleLock {
  locked: boolean
  /** whole days until it unlocks (0 when already open) */
  daysUntil: number
  /** 'YYYY-MM-DD' the module unlocks, or null when not dripped */
  unlocksOn: string | null
}

const OPEN: ModuleLock = { locked: false, daysUntil: 0, unlocksOn: null }

/** UTC "today" as a YYYY-MM-DD string — matches the server's date math. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Whether a module is unlocked for a member, mirroring the SQL
 * class_module_unlocked(). Dates are UTC on both sides.
 */
export function moduleLock(dripEnabled: boolean, dripDay: number | null, startedOn: string | null): ModuleLock {
  const day = dripDay ?? 1
  if (!dripEnabled || day <= 1) return OPEN

  const startStr = startedOn ?? (day > 1 ? null : utcToday())
  if (!startStr) return { locked: true, daysUntil: day - 1, unlocksOn: null }

  const unlock = new Date(startStr + 'T00:00:00Z')
  unlock.setUTCDate(unlock.getUTCDate() + (day - 1))
  const unlocksOn = unlock.toISOString().slice(0, 10)

  const today = new Date(utcToday() + 'T00:00:00Z')
  const daysUntil = Math.round((unlock.getTime() - today.getTime()) / 86_400_000)
  return { locked: daysUntil > 0, daysUntil: Math.max(0, daysUntil), unlocksOn }
}

/** "Unlocks today/tomorrow/in N days" copy for a locked module. */
export function unlockLabel(lock: ModuleLock): string {
  if (!lock.locked) return ''
  if (lock.daysUntil <= 0) return 'Unlocks today'
  if (lock.daysUntil === 1) return 'Unlocks tomorrow'
  return `Unlocks in ${lock.daysUntil} days`
}

// ---- area overview for the member Learning Center home ----
export interface AreaOverview {
  key: LearningArea
  moduleTotal: number
  moduleDone: number
  extra: string | null // e.g. "12 resources"
}

export async function loadAreaOverview(orgId: string, userId: string): Promise<AreaOverview[]> {
  const ctx = await loadMemberCtx(orgId, userId)
  const out: AreaOverview[] = []

  // classes-backed areas
  const { data: classes } = await supabase
    .from('classes')
    .select('id, area')
    .eq('org_id', orgId)
    .eq('status', 'published')
    .in('area', ['network_marketing', 'freelancing', 'personal_development', 'income_development'])
  const classRows = (classes as { id: string; area: LearningArea }[]) ?? []
  const classIds = classRows.map((c) => c.id)
  let moduleRows: { id: string; class_id: string }[] = []
  let itemRows: ClassModuleItem[] = []
  if (classIds.length > 0) {
    const { data: mods } = await supabase.from('class_modules').select('id, class_id').eq('status', 'published').in('class_id', classIds)
    moduleRows = (mods as { id: string; class_id: string }[]) ?? []
    if (moduleRows.length > 0) {
      const { data: items } = await supabase.from('class_module_items').select('*').in('module_id', moduleRows.map((m) => m.id))
      itemRows = (items as ClassModuleItem[]) ?? []
    }
  }
  const areaOfClass = new Map(classRows.map((c) => [c.id, c.area]))
  const itemsByModule = new Map<string, ClassModuleItem[]>()
  for (const it of itemRows) {
    const l = itemsByModule.get(it.module_id) ?? []
    l.push(it)
    itemsByModule.set(it.module_id, l)
  }
  for (const area of ['network_marketing', 'freelancing', 'personal_development', 'income_development'] as LearningArea[]) {
    const mods = moduleRows.filter((m) => areaOfClass.get(m.class_id) === area)
    let done = 0
    for (const m of mods) {
      const its = itemsByModule.get(m.id) ?? []
      if (its.length > 0 && its.every((it) => itemDone(it, ctx))) done++
    }
    out.push({ key: area, moduleTotal: mods.length, moduleDone: done, extra: null })
  }

  // onboarding
  const { data: obMods } = await supabase.from('onboarding_modules').select('id').eq('org_id', orgId).eq('status', 'published')
  const obModIds = ((obMods as { id: string }[]) ?? []).map((m) => m.id)
  let obDone = 0
  if (obModIds.length > 0) {
    const [{ data: obItems }, { data: obProg }, { data: obAttempts }] = await Promise.all([
      supabase.from('onboarding_step_items').select('id, module_id, type, exam_id').in('module_id', obModIds),
      supabase.from('onboarding_item_progress').select('item_id').eq('org_id', orgId).eq('user_id', userId),
      supabase.from('attempts').select('exam_id').eq('org_id', orgId).eq('user_id', userId).eq('status', 'submitted').eq('passed', true),
    ])
    const doneItemIds = new Set(((obProg as { item_id: string }[]) ?? []).map((r) => r.item_id))
    const passedExams = new Set(((obAttempts as { exam_id: string }[]) ?? []).map((r) => r.exam_id))
    const items = (obItems as { id: string; module_id: string; type: string; exam_id: string | null }[]) ?? []
    for (const mid of obModIds) {
      const its = items.filter((i) => i.module_id === mid)
      if (its.length > 0 && its.every((i) => (i.type === 'quiz' ? !!i.exam_id && passedExams.has(i.exam_id) : doneItemIds.has(i.id)))) obDone++
    }
  }
  const obOverview: AreaOverview = { key: 'onboarding', moduleTotal: obModIds.length, moduleDone: obDone, extra: null }

  // personal development resources count (extra line)
  const { count: pdResCount } = await supabase
    .from('personal_development_resources')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
  const pd = out.find((o) => o.key === 'personal_development')
  if (pd && (pdResCount ?? 0) > 0) pd.extra = `${pdResCount} resource${pdResCount === 1 ? '' : 's'} in the library`

  return [obOverview, ...out]
}

// ---- shared CRUD (admin) ----
export async function createSection(orgId: string, area: LearningArea, createdBy: string, title: string, sectionOrder: number) {
  return supabase.from('classes').insert({
    org_id: orgId,
    area,
    purpose: null,
    title,
    description: null,
    status: 'draft',
    section_order: sectionOrder,
    created_by: createdBy,
  })
}
