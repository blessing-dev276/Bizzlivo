// Supabase Edge Function (Deno): public exam link, step 2 — grade and
// submit an attempt started via start-attempt. Runs on the service role
// key so correctness is never computed in the taker's browser. Scoped by
// knowledge of the unguessable attempt_id, same trust model whether the
// attempt belongs to a legacy is_guest:true row or a real registered
// member created by start-attempt's POST branch — this endpoint never
// touches TakeExam.tsx's attempts (a separate, client-graded code path).
//
// POST /functions/v1/submit-attempt
// Body: { attempt_id, answers: [{ question_id, selected_option_ids }] }

import { createClient } from 'npm:@supabase/supabase-js@2'

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

interface IncomingAnswer {
  question_id: string
  selected_option_ids: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const { attempt_id: attemptId, answers } = (await req.json()) as {
      attempt_id?: string
      answers?: IncomingAnswer[]
    }
    if (!attemptId || !Array.isArray(answers)) {
      return jsonResponse({ error: 'attempt_id and answers are required.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const db = createClient(supabaseUrl, serviceKey)

    const { data: attempt, error: attemptError } = await db
      .from('attempts')
      .select('id, org_id, exam_id, status, started_at')
      .eq('id', attemptId)
      .maybeSingle()
    if (attemptError || !attempt) return jsonResponse({ error: 'Attempt not found.' }, 404)
    if (attempt.status !== 'in_progress') return jsonResponse({ error: 'This attempt has already been submitted.' }, 410)

    const { data: settings, error: settingsError } = await db
      .from('exam_settings')
      .select('pass_mark_percent')
      .eq('exam_id', attempt.exam_id)
      .single()
    if (settingsError || !settings) return jsonResponse({ error: 'Exam settings not found.' }, 500)

    // Only accept answers for questions that actually belong to this exam.
    const questionIds = [...new Set(answers.map((a) => a.question_id))]
    const { data: options } = await db
      .from('question_options')
      .select('id, question_id, is_correct')
      .in('question_id', questionIds)

    const optionsByQuestion = new Map<string, { id: string; is_correct: boolean }[]>()
    for (const opt of options ?? []) {
      const list = optionsByQuestion.get(opt.question_id) ?? []
      list.push({ id: opt.id, is_correct: opt.is_correct })
      optionsByQuestion.set(opt.question_id, list)
    }

    let correctCount = 0
    const answerRows = []
    for (const answer of answers) {
      const questionOptions = optionsByQuestion.get(answer.question_id)
      if (!questionOptions) continue // not a real question for this exam — ignore

      const correctIds = new Set(questionOptions.filter((o) => o.is_correct).map((o) => o.id))
      const selected = answer.selected_option_ids ?? []
      const isCorrect =
        selected.length > 0 &&
        selected.length === correctIds.size &&
        selected.every((id) => correctIds.has(id))
      if (isCorrect) correctCount += 1

      answerRows.push({
        attempt_id: attemptId,
        question_id: answer.question_id,
        selected_option_ids: selected,
        is_correct: isCorrect,
      })
    }

    if (answerRows.length === 0) return jsonResponse({ error: 'No valid answers submitted.' }, 400)

    const { error: insertError } = await db.from('attempt_answers').insert(answerRows)
    if (insertError) return jsonResponse({ error: insertError.message }, 500)

    const total = answerRows.length
    const scorePercent = Math.round((correctCount / total) * 10000) / 100
    const passed = scorePercent >= settings.pass_mark_percent
    const timeSpent = Math.round((Date.now() - new Date(attempt.started_at).getTime()) / 1000)

    const { error: updateError } = await db
      .from('attempts')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        score_percent: scorePercent,
        passed,
        time_spent_seconds: timeSpent,
      })
      .eq('id', attemptId)
    if (updateError) return jsonResponse({ error: updateError.message }, 500)

    return jsonResponse({ score_percent: scorePercent, passed, correct_count: correctCount, total })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
