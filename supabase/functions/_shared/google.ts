// Google OAuth + Calendar helpers shared by the google-* edge functions.
// One-way sync (Bizzlivo -> Google). Minimal scopes: calendar.events + email.

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
]

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const CAL_BASE = 'https://www.googleapis.com/calendar/v3'

function redirectUri(): string {
  // Fixed: the Supabase functions gateway URL for google-oauth-callback.
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-oauth-callback`
}

export function consentUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${p}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  error?: string
  error_description?: string
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  })
  return res.json()
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!,
      grant_type: 'refresh_token',
    }),
  })
  return res.json()
}

export async function fetchUserInfo(accessToken: string): Promise<{ sub?: string; email?: string }> {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
  return res.json()
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
}

// ---- Calendar events ----

export interface CalendarEventInput {
  summary: string
  description?: string
  location?: string
  timeZone: string
  start: string // RFC3339 with offset, or date for all-day (not used here)
  end: string
  recurrence?: string[] // ['RRULE:FREQ=DAILY;...']
  wantMeet: boolean
}

function bodyFor(input: CalendarEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? undefined,
    location: input.location ?? undefined,
    start: { dateTime: input.start, timeZone: input.timeZone },
    end: { dateTime: input.end, timeZone: input.timeZone },
  }
  if (input.recurrence?.length) body.recurrence = input.recurrence
  if (input.wantMeet) {
    body.conferenceData = {
      createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
    }
  }
  return body
}

export interface CalendarEventResult {
  id: string
  hangoutLink?: string
  conferenceData?: { conferenceId?: string }
  htmlLink?: string
}

export async function insertCalendarEvent(
  accessToken: string, calendarId: string, input: CalendarEventInput,
): Promise<CalendarEventResult> {
  const res = await fetch(
    `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyFor(input)),
    },
  )
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? `Calendar insert failed (${res.status})`)
  return json
}

export async function patchCalendarEvent(
  accessToken: string, calendarId: string, eventId: string, input: CalendarEventInput,
): Promise<CalendarEventResult> {
  const res = await fetch(
    `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyFor(input)),
    },
  )
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? `Calendar patch failed (${res.status})`)
  return json
}

export async function deleteCalendarEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  await fetch(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {})
}
