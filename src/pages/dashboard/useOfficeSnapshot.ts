import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { localDateString } from '../../lib/date'

export interface ActivityDay {
  key: string // YYYY-MM-DD (local)
  label: string // e.g. "Sep 3"
  weekday: string // e.g. "Mon"
  attempts: number
  coursework: number
  joins: number
}

export interface UpcomingEventLite {
  id: string
  title: string
  start_at: string
  end_at: string
  venue_type: string
  venue_location: string | null
  category: string
}

export interface OfficeSnapshot {
  // Office Pulse
  totalMembers: number
  activeThisWeek: number
  publishedExams: number
  assignmentTotal: number
  assignmentCompleted: number
  newThisMonth: number
  newThisWeek: number
  invitedPending: number
  draftExams: number
  // Today's Focus
  pendingMembers: number
  courseworkPending: number
  questionsPending: number
  eventsToday: number
  resourceCount: number
  // Training Progress
  publishedClasses: number
  classItemsTotal: number
  classItemsCompleted: number
  courseworkApproved: number
  // People Health
  teamLeaders: number
  teamsCount: number
  // Member Activity (14 days)
  activity: ActivityDay[]
  // Upcoming Events
  upcomingEvents: UpcomingEventLite[]
  // Intelligence
  attemptsThisWeek: number
  attemptsLastWeek: number
  hasUpcomingOrientation: boolean
}

function count(res: { count: number | null }) {
  return res.count ?? 0
}

export function useOfficeSnapshot(orgId: string | undefined) {
  const [data, setData] = useState<OfficeSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const now = Date.now()
    const iso = (ms: number) => new Date(ms).toISOString()
    const weekAgo = iso(now - 7 * 86400000)
    const twoWeeksAgo = iso(now - 14 * 86400000)
    const monthStart = (() => {
      const d = new Date()
      d.setDate(1)
      d.setHours(0, 0, 0, 0)
      return d.toISOString()
    })()
    const todayStart = (() => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      return d.toISOString()
    })()
    const todayEnd = iso(new Date(todayStart).getTime() + 86400000)
    const nowIso = iso(now)

    async function load(org: string) {
      const [
        totalMembersR,
        newThisMonthR,
        newThisWeekR,
        invitedPendingR,
        publishedExamsR,
        draftExamsR,
        resourceCountR,
        assignmentTotalR,
        assignmentCompletedR,
        pendingMembersR,
        courseworkPendingR,
        courseworkApprovedR,
        questionsPendingR,
        publishedClassesR,
        classItemsTotalR,
        classItemsCompletedR,
        teamLeadersR,
        teamsCountR,
        eventsTodayR,
        upcomingOrientationR,
        upcomingEventsR,
        attemptsThisWeekR,
        attemptsLastWeekR,
        attempts14R,
        coursework14R,
        joins14R,
        classProg7R,
      ] = await Promise.all([
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active'),
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active').gte('joined_at', monthStart),
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active').gte('joined_at', weekAgo),
        supabase.from('invites').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'pending'),
        supabase.from('exams').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'published'),
        supabase.from('exams').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'draft'),
        supabase.from('resources').select('id', { count: 'exact', head: true }).eq('org_id', org),
        supabase.from('exam_assignments').select('id', { count: 'exact', head: true }).eq('org_id', org),
        supabase.from('attempts').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'submitted').eq('is_guest', false),
        supabase.from('pending_members').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'pending'),
        supabase.from('coursework_submissions').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'submitted'),
        supabase.from('coursework_submissions').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'approved'),
        supabase.from('questions').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'pending_review'),
        supabase.from('classes').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'published'),
        supabase.from('class_module_items').select('id', { count: 'exact', head: true }).eq('org_id', org),
        supabase.from('class_item_progress').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'completed'),
        supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'active').eq('role', 'team_leader'),
        supabase.from('groups').select('id', { count: 'exact', head: true }).eq('org_id', org),
        supabase.from('events').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'scheduled').gte('start_at', todayStart).lt('start_at', todayEnd),
        supabase.from('events').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('category', 'orientation').eq('status', 'scheduled').gte('start_at', nowIso),
        supabase.from('events').select('id, title, start_at, end_at, venue_type, venue_location, category').eq('org_id', org).eq('status', 'scheduled').gte('start_at', nowIso).order('start_at', { ascending: true }).limit(5),
        supabase.from('attempts').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'submitted').eq('is_guest', false).gte('submitted_at', weekAgo),
        supabase.from('attempts').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('status', 'submitted').eq('is_guest', false).gte('submitted_at', twoWeeksAgo).lt('submitted_at', weekAgo),
        supabase.from('attempts').select('submitted_at, user_id').eq('org_id', org).eq('status', 'submitted').eq('is_guest', false).gte('submitted_at', twoWeeksAgo),
        supabase.from('coursework_submissions').select('submitted_at, user_id').eq('org_id', org).gte('submitted_at', twoWeeksAgo),
        supabase.from('memberships').select('joined_at').eq('org_id', org).eq('status', 'active').gte('joined_at', twoWeeksAgo),
        supabase.from('class_item_progress').select('completed_at, user_id').eq('org_id', org).eq('status', 'completed').gte('completed_at', weekAgo),
      ])

      if (cancelled) return

      // ---- 14-day activity series ----
      const days: ActivityDay[] = []
      const byKey = new Map<string, ActivityDay>()
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now - i * 86400000)
        const key = localDateString(d)
        const day: ActivityDay = {
          key,
          label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
          attempts: 0,
          coursework: 0,
          joins: 0,
        }
        days.push(day)
        byKey.set(key, day)
      }
      for (const r of (attempts14R.data ?? [])) {
        if (!r.submitted_at) continue
        const day = byKey.get(localDateString(new Date(r.submitted_at)))
        if (day) day.attempts += 1
      }
      for (const r of (coursework14R.data ?? [])) {
        if (!r.submitted_at) continue
        const day = byKey.get(localDateString(new Date(r.submitted_at)))
        if (day) day.coursework += 1
      }
      for (const r of (joins14R.data ?? [])) {
        if (!r.joined_at) continue
        const day = byKey.get(localDateString(new Date(r.joined_at)))
        if (day) day.joins += 1
      }

      // ---- active members this week (distinct user_id across signals) ----
      const activeIds = new Set<string>()
      const sevenAgoMs = now - 7 * 86400000
      for (const r of (attempts14R.data ?? [])) {
        if (r.user_id && r.submitted_at && new Date(r.submitted_at).getTime() >= sevenAgoMs) activeIds.add(r.user_id)
      }
      for (const r of (coursework14R.data ?? [])) {
        if (r.user_id && r.submitted_at && new Date(r.submitted_at).getTime() >= sevenAgoMs) activeIds.add(r.user_id)
      }
      for (const r of (classProg7R.data ?? [])) {
        if (r.user_id) activeIds.add(r.user_id)
      }

      const snapshot: OfficeSnapshot = {
        totalMembers: count(totalMembersR),
        activeThisWeek: activeIds.size,
        publishedExams: count(publishedExamsR),
        assignmentTotal: count(assignmentTotalR),
        assignmentCompleted: count(assignmentCompletedR),
        newThisMonth: count(newThisMonthR),
        newThisWeek: count(newThisWeekR),
        invitedPending: count(invitedPendingR),
        draftExams: count(draftExamsR),
        pendingMembers: count(pendingMembersR),
        courseworkPending: count(courseworkPendingR),
        questionsPending: count(questionsPendingR),
        eventsToday: count(eventsTodayR),
        resourceCount: count(resourceCountR),
        publishedClasses: count(publishedClassesR),
        classItemsTotal: count(classItemsTotalR),
        classItemsCompleted: count(classItemsCompletedR),
        courseworkApproved: count(courseworkApprovedR),
        teamLeaders: count(teamLeadersR),
        teamsCount: count(teamsCountR),
        activity: days,
        upcomingEvents: (upcomingEventsR.data as UpcomingEventLite[]) ?? [],
        attemptsThisWeek: count(attemptsThisWeekR),
        attemptsLastWeek: count(attemptsLastWeekR),
        hasUpcomingOrientation: count(upcomingOrientationR) > 0,
      }

      setData(snapshot)
      setLoading(false)
    }

    load(orgId).catch((e) => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Could not load the office snapshot.')
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [orgId])

  return { data, loading, error }
}
