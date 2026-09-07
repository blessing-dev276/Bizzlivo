// Supabase Edge Function (Deno): extract text from a resource PDF, prompt
// Claude for MCQ/True-False questions via structured JSON output, and insert
// them as pending_review.
//
// Required secrets (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY
// Auto-provided by the Supabase runtime:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_ROLES = ['owner', 'admin', 'instructor']
// Claude's 1M-token context window comfortably fits far more source text than
// the previous Groq-based setup could — no need for an aggressive cap here.
const MAX_SOURCE_CHARS = 60000
const CLAUDE_MODEL = 'claude-opus-4-8'

const QUESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['mcq', 'true_false'] },
          skill_tag: { type: 'string', description: 'lowercase, underscore-separated sub-topic tag' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                is_correct: { type: 'boolean' },
              },
              required: ['text', 'is_correct'],
              additionalProperties: false,
            },
          },
        },
        required: ['text', 'type', 'skill_tag', 'options'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
}

interface GeneratedOption {
  text: string
  is_correct: boolean
}

interface GeneratedQuestion {
  text: string
  type?: string
  skill_tag?: string
  options: GeneratedOption[]
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return jsonResponse({ error: 'Server misconfigured: ANTHROPIC_API_KEY not set.' }, 500)

    // Client scoped to the caller's JWT, used only to identify the user.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)

    const { examId, resourceId, count } = await req.json()
    if (!examId || !resourceId || !count) {
      return jsonResponse({ error: 'examId, resourceId and count are required.' }, 400)
    }
    const numQuestions = Math.max(1, Math.min(100, Number(count)))

    // Service-role client for all data access; tenant checks are done manually below.
    const db = createClient(supabaseUrl, serviceKey)

    const { data: exam, error: examError } = await db
      .from('exams')
      .select('id, org_id, resource_id')
      .eq('id', examId)
      .single()
    if (examError || !exam) return jsonResponse({ error: 'Exam not found.' }, 404)

    const { data: membership } = await db
      .from('memberships')
      .select('role')
      .eq('org_id', exam.org_id)
      .eq('user_id', userData.user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (!membership || !ADMIN_ROLES.includes(membership.role)) {
      return jsonResponse({ error: 'You do not have permission to generate questions for this exam.' }, 403)
    }

    const { data: resource, error: resourceError } = await db
      .from('resources')
      .select('id, org_id, file_url, title')
      .eq('id', resourceId)
      .single()
    if (resourceError || !resource || resource.org_id !== exam.org_id) {
      return jsonResponse({ error: 'Resource not found for this office.' }, 404)
    }

    const { data: org } = await db.from('organizations').select('plan_tier').eq('id', exam.org_id).single()
    const { data: limits } = await db
      .from('plan_limits')
      .select('ai_exam_generations_per_month, ai_questions_per_month')
      .eq('plan', org?.plan_tier ?? 'free')
      .single()
    if (limits) {
      const monthStart = new Date()
      monthStart.setUTCDate(1)
      monthStart.setUTCHours(0, 0, 0, 0)
      const { data: usageRows } = await db
        .from('ai_usage_events')
        .select('question_count')
        .eq('org_id', exam.org_id)
        .gte('created_at', monthStart.toISOString())
      const generationsUsed = usageRows?.length ?? 0
      const questionsUsed = (usageRows ?? []).reduce((sum, r) => sum + r.question_count, 0)

      // null cap = unlimited (Business package).
      if (limits.ai_exam_generations_per_month != null && generationsUsed >= limits.ai_exam_generations_per_month) {
        return jsonResponse({
          error: `You've used all ${limits.ai_exam_generations_per_month} AI exam generations included this month on your current package. Upgrade for more, or wait until next month.`,
        }, 403)
      }
      if (limits.ai_questions_per_month != null && questionsUsed + numQuestions > limits.ai_questions_per_month) {
        const remaining = Math.max(0, limits.ai_questions_per_month - questionsUsed)
        return jsonResponse({
          error: `Generating ${numQuestions} questions would go over your package's monthly AI question budget (${questionsUsed}/${limits.ai_questions_per_month} used, ${remaining} left). Generate fewer, or upgrade your package.`,
        }, 403)
      }
    }

    const { data: fileBlob, error: downloadError } = await db.storage
      .from('resources')
      .download(resource.file_url)
    if (downloadError || !fileBlob) {
      return jsonResponse({ error: `Could not download resource PDF: ${downloadError?.message ?? 'unknown error'}` }, 500)
    }

    let sourceText: string
    try {
      const buffer = new Uint8Array(await fileBlob.arrayBuffer())
      const pdf = await getDocumentProxy(buffer)
      const { text } = await extractText(pdf, { mergePages: true })
      sourceText = (Array.isArray(text) ? text.join('\n') : text).slice(0, MAX_SOURCE_CHARS)
    } catch (err) {
      return jsonResponse({ error: `Could not extract text from PDF: ${err instanceof Error ? err.message : String(err)}` }, 500)
    }

    if (!sourceText.trim()) {
      return jsonResponse({ error: 'The PDF has no extractable text (it may be scanned/image-only).' }, 422)
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey })

    const systemPrompt = `You are generating a multiple-choice exam from a training document titled "${resource.title}".

Generate exactly ${numQuestions} questions covering the material in the document the user provides. Mix mostly "mcq" (4 options, exactly one correct) with a few "true_false" (2 options) if natural. Each question needs a short "skill_tag" (lowercase, underscore-separated) capturing the sub-topic it tests.`

    let response
    try {
      const stream = anthropic.messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: Math.min(20000, 1000 + numQuestions * 180),
        thinking: { type: 'adaptive' },
        system: systemPrompt,
        messages: [{ role: 'user', content: `Document:\n"""\n${sourceText}\n"""` }],
        output_config: { format: { type: 'json_schema', schema: QUESTIONS_SCHEMA } },
      })
      response = await stream.finalMessage()
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        return jsonResponse(
          { error: 'The AI provider is rate-limited right now. Try generating fewer questions at once, or wait a minute and retry.' },
          429,
        )
      }
      if (err instanceof Anthropic.APIError) {
        return jsonResponse({ error: `AI generation request failed: ${err.message}` }, 502)
      }
      throw err
    }

    if (response.stop_reason === 'refusal') {
      return jsonResponse({ error: 'The AI declined to generate questions for this document. Try a different resource.' }, 502)
    }
    if (response.stop_reason === 'max_tokens') {
      return jsonResponse({ error: 'The AI response was cut off before finishing. Try generating fewer questions at once.' }, 502)
    }

    let parsed: { questions: GeneratedQuestion[] }
    try {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      if (!textBlock) throw new Error('No text content in AI response.')
      parsed = JSON.parse(textBlock.text)
      if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        throw new Error('Response JSON had no questions array.')
      }
    } catch (err) {
      return jsonResponse({
        error: `AI response was not valid JSON — nothing was saved. Retry generation. (${err instanceof Error ? err.message : String(err)})`,
      }, 502)
    }

    let inserted = 0
    for (const q of parsed.questions) {
      if (!q.text || !Array.isArray(q.options) || q.options.length < 2) continue

      const { data: questionRow, error: qError } = await db
        .from('questions')
        .insert({
          exam_id: examId,
          org_id: exam.org_id,
          type: q.type === 'true_false' ? 'true_false' : 'mcq',
          text: q.text,
          skill_tag: q.skill_tag ?? null,
          ai_generated: true,
          status: 'pending_review',
        })
        .select('id')
        .single()

      if (qError || !questionRow) continue

      const optionRows = q.options.map((opt, idx) => ({
        question_id: questionRow.id,
        text: opt.text,
        is_correct: !!opt.is_correct,
        order_index: idx,
      }))
      const { error: optError } = await db.from('question_options').insert(optionRows)
      if (!optError) inserted += 1
    }

    if (inserted === 0) {
      return jsonResponse({ error: 'AI response parsed but no valid questions could be saved. Retry generation.' }, 502)
    }

    await db.from('ai_usage_events').insert({ org_id: exam.org_id, exam_id: examId, question_count: inserted })

    return jsonResponse({ inserted })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error.' }, 500)
  }
})
