import { supabase } from './supabase'

// Trainers manage exams/assignments org-wide by RLS, but the UI narrows
// what they see to content that's actually theirs: items placed inside a
// Skill Development class (0022_skill_development_classes.sql) they're
// attached to as a trainer (0026_class_trainers.sql).
async function getTrainerModuleItemIds(trainerUserId: string): Promise<string[]> {
  const { data: trainerClasses } = await supabase.from('class_trainers').select('class_id').eq('user_id', trainerUserId)
  const classIds = (trainerClasses ?? []).map((c) => c.class_id as string)
  if (classIds.length === 0) return []

  const { data: modules } = await supabase.from('class_modules').select('id').in('class_id', classIds)
  const moduleIds = (modules ?? []).map((m) => m.id as string)
  return moduleIds
}

export async function getTrainerExamIds(trainerUserId: string): Promise<Set<string>> {
  const moduleIds = await getTrainerModuleItemIds(trainerUserId)
  if (moduleIds.length === 0) return new Set()
  const { data: items } = await supabase
    .from('class_module_items')
    .select('exam_id')
    .in('module_id', moduleIds)
    .not('exam_id', 'is', null)
  return new Set((items ?? []).map((i) => i.exam_id as string))
}

export async function getTrainerAssignmentIds(trainerUserId: string): Promise<Set<string>> {
  const moduleIds = await getTrainerModuleItemIds(trainerUserId)
  if (moduleIds.length === 0) return new Set()
  const { data: items } = await supabase
    .from('class_module_items')
    .select('coursework_assignment_id')
    .in('module_id', moduleIds)
    .not('coursework_assignment_id', 'is', null)
  return new Set((items ?? []).map((i) => i.coursework_assignment_id as string))
}
