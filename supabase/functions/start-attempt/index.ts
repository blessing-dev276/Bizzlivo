// Supabase Edge Function (Deno): public exam link.
//
// GET  /functions/v1/start-attempt?token={public_token}
//   Preview only (title/office/time limit) — no attempt created, no auth.
// POST /functions/v1/start-attempt
//   Body: { token, name?, whatsapp? }
//   Requires Authorization: Bearer <the caller's own access token> — the
//   caller must already be signed in (via supabase.auth.signUp or
//   signInWithPassword, client-side) before calling this. Registering
//   them as an active member of the exam's org happens here, immediately,
//   as part of starting the exam — see check-exam-link-account /
//   confirm-exam-signup for the login/signup half of this flow.
//
// Runs entirely on the service role key so the caller's browser never
// receives question_options.is_correct.

import { createClient } from 'npm:@supabase/supabase-js@2'

interface QuestionOption {
  id: string
  text: string
  is_correct: boolean
  order_index: number | null
}

interface Question {
  id: string
  text: string
  type: string
  question_options: QuestionOption[]
}

interface ExamSettingsRow {
  num_questions: number
  shuffle_questions: boolean
  shuffle_options: boolean
  time_limit_minutes: number
  max_attempts: number
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

type Db = ReturnType<typeof createClient>

async function loadPublishedExam(db: Db, token: string) {
  const { data: exam, error } = await db
    .from('exams')
    .select('id, org_id, title, public_link_enabled, status, organizations(name)')
    .eq('public_token', token)
    .maybeSingle()
  if (error || !exam || !exam.public_link_enabled || exam.status !== 'published') return null
  return exam
}

async function buildQuestions(db: Db, examId: string, settings: ExamSettingsRow) {
  const { data: pool } = await db
    .from('questions')
    .select('*, question_options(*)')
    .eq('exam_id', examId)
    .eq('status', 'approved')

  let selected = (pool as Question[]) ?? []
  if (selected.length === 0) return null
  if (settings.shuffle_questions) selected = shuffle(selected)
  selected = selected.slice(0, settings.num_questions)

  return selected.map((q) => {
    const options = settings.shuffle_options ? shuffle(q.question_options) : q.question_options
    return {
      id: q.id,
      text: q.text,
      type: q.type,
      options: options.map((o) => ({ id: o.id, text: o.text })),
    }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(supabaseUrl, serviceKey)

  try {
    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token')
      if (!token) return jsonResponse({ error: 'Missing token.' }, 400)

      const exam = await loadPublishedExam(db, token)
      if (!exam) return jsonResponse({ error: 'This exam link is not available.' }, 404)
      const officeName = (exam.organizations as unknown as { name: string } | null)?.name ?? null

      const { data: settings, error: settingsError } = await db
        .from('exam_settings')
        .select('*')
        .eq('exam_id', exam.id)
        .single()
      if (settingsError || !settings) return jsonResponse({ error: 'This exam has no settings configured yet.' }, 500)

      return jsonResponse({
        exam_title: exam.title,
        office_name: officeName,
        time_limit_minutes: settings.time_limit_minutes,
      })
    }

    if (req.method === 'POST') {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) return jsonResponse({ error: 'You must be signed in to start this exam.' }, 401)

      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: userData, error: userError } = await callerClient.auth.getUser()
      if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)
      const user = userData.user
      if (!user.email) return jsonResponse({ error: 'Your account has no email on file.' }, 400)

      const { token, name, whatsapp } = await req.json()
      if (!token) return jsonResponse({ error: 'Missing token.' }, 400)

      const exam = await loadPublishedExam(db, token)
      if (!exam) return jsonResponse({ error: 'This exam link is not available.' }, 404)
      const officeName = (exam.organizations as unknown as { name: string } | null)?.name ?? null

      const { data: settings, error: settingsError } = await db
        .from('exam_settings')
        .select('*')
        .eq('exam_id', exam.id)
        .single()
      if (settingsError || !settings) return jsonResponse({ error: 'This exam has no settings configured yet.' }, 500)

      // Register immediately — this is the whole point of the exam link:
      // starting it creates a real, active membership right away, not a
      // pending approval request.
      const { data: existingProfile } = await db.from('profiles').select('id, phone').eq('id', user.id).maybeSingle()
      if (!existingProfile) {
        const { error: profileError } = await db.from('profiles').insert({
          id: user.id,
          full_name: name?.trim() || user.email,
          email: user.email,
          phone: whatsapp?.trim() || null,
        })
        if (profileError) return jsonResponse({ error: profileError.message }, 500)
      } else if (!existingProfile.phone && whatsapp?.trim()) {
        await db.from('profiles').update({ phone: whatsapp.trim() }).eq('id', user.id)
      }

      const { data: existingMembership } = await db
        .from('memberships')
        .select('id')
        .eq('org_id', exam.org_id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!existingMembership) {
        const { error: membershipError } = await db.from('memberships').insert({
          org_id: exam.org_id,
          user_id: user.id,
          role: 'member',
          status: 'active',
        })
        if (membershipError) return jsonResponse({ error: membershipError.message }, 500)
      }

      // Carry over any prior guest history at this email into the new account.
      await db
        .from('attempts')
        .update({ user_id: user.id })
        .eq('org_id', exam.org_id)
        .eq('is_guest', true)
        .is('user_id', null)
        .ilike('taker_email', user.email)

      // Resume an in-progress attempt if one exists; otherwise create a new
      // one respecting max_attempts (mirrors TakeExam.tsx's member-path
      // logic, so retaking this link doesn't ignore the exam's attempt cap).
      const { data: inProgress } = await db
        .from('attempts')
        .select('*')
        .eq('exam_id', exam.id)
        .eq('user_id', user.id)
        .eq('status', 'in_progress')
        .maybeSingle()

      let attempt = inProgress

      if (!attempt) {
        const { count: pastAttempts } = await db
          .from('attempts')
          .select('id', { count: 'exact', head: true })
          .eq('exam_id', exam.id)
          .eq('user_id', user.id)

        if (settings.max_attempts !== 0 && (pastAttempts ?? 0) >= settings.max_attempts) {
          return jsonResponse({ error: "You've used all your attempts for this exam." }, 403)
        }

        const { data: newAttempt, error: attemptError } = await db
          .from('attempts')
          .insert({
            org_id: exam.org_id,
            exam_id: exam.id,
            user_id: user.id,
            is_guest: false,
            attempt_number: (pastAttempts ?? 0) + 1,
            status: 'in_progress',
          })
          .select()
          .single()

        if (attemptError) {
          // 23505 = unique_violation on (exam_id, user_id, attempt_number) —
          // a concurrent duplicate call already created it; resume that one.
          if (attemptError.code === '23505') {
            const { data: retried } = await db
              .from('attempts')
              .select('*')
              .eq('exam_id', exam.id)
              .eq('user_id', user.id)
              .eq('status', 'in_progress')
              .maybeSingle()
            if (!retried) return jsonResponse({ error: 'Could not start attempt.' }, 500)
            attempt = retried
          } else {
            return jsonResponse({ error: 'Could not start attempt.' }, 500)
          }
        } else {
          attempt = newAttempt
        }
      }

      // The served question set isn't persisted ahead of answering (grading
      // in submit-attempt validates each submitted question_id against real
      // question_options directly, not against a pre-recorded set) — so
      // resuming an in-progress attempt just re-draws a fresh selection tied
      // to the same attempt_id rather than trying to reconstruct the exact
      // original set.
      const questions = await buildQuestions(db, exam.id, settings as ExamSettingsRow)
      if (!questions) return jsonResponse({ error: 'This exam has no approved questions yet.' }, 422)

      return jsonResponse({
        attempt_id: attempt!.id,
        org_id: exam.org_id,
        exam_title: exam.title,
        office_name: officeName,
        time_limit_minutes: settings.time_limit_minutes,
        started_at: attempt!.started_at,
        questions,
      })
    }

    return jsonResponse({ error: 'Method not allowed.' }, 405)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
