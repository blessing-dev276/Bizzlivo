// Bizzlivo transactional email templates.
//
// One table-based, inline-styled layout — no external CSS, no reuse of
// the website stylesheet, mobile-first (max-width 560). Every caller
// goes through renderTemplate(); nothing builds HTML by hand.
//
// Branding: the office name is always prominent + "powered by Bizzlivo".
// The office logo / brand colour are only applied when the caller passes
// them (the send layer only passes them when the org's custom_branding
// entitlement is on).

const BRAND = '#2f6bf0'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://bizzlivo.com'

export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Turn a relative path or absolute URL into a safe absolute URL on the app.
function safeUrl(pathOrUrl: unknown): string {
  const v = String(pathOrUrl ?? '/')
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : APP_URL
    } catch {
      return APP_URL
    }
  }
  return APP_URL.replace(/\/$/, '') + '/' + v.replace(/^\//, '')
}

// Multi-line plain text -> escaped HTML paragraphs.
function paragraphs(text: unknown): string {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3a4250;">${escapeHtml(
          p,
        ).replace(/\n/g, '<br/>')}</p>`,
    )
    .join('')
}

export interface LayoutInput {
  orgName?: string
  orgLogoUrl?: string | null
  brandColor?: string | null
  preheader?: string
  headline: string
  bodyHtml: string
  ctaLabel?: string
  ctaUrl?: string
  detailRows?: { label: string; value: string }[]
  footNote?: string
}

export function baseLayout(input: LayoutInput): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(input.brandColor ?? '') ? input.brandColor! : BRAND
  const org = escapeHtml(input.orgName || 'Bizzlivo')
  const logo =
    input.orgLogoUrl && /^https?:\/\//i.test(input.orgLogoUrl)
      ? `<img src="${escapeHtml(input.orgLogoUrl)}" width="40" height="40" alt="" style="display:block;border-radius:8px;object-fit:contain;" />`
      : ''

  const cta =
    input.ctaLabel && input.ctaUrl
      ? `<tr><td style="padding:8px 0 4px;">
           <a href="${safeUrl(input.ctaUrl)}" style="display:inline-block;background:${accent};color:#ffffff;
             padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
             ${escapeHtml(input.ctaLabel)}</a>
         </td></tr>`
      : ''

  const details =
    input.detailRows && input.detailRows.length
      ? `<tr><td style="padding:12px 0;">
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#f5f7fa;border:1px solid #e6e9ef;border-radius:10px;">
             ${input.detailRows
               .map(
                 (r) =>
                   `<tr>
                      <td style="padding:10px 16px;font-size:13px;color:#6b7480;width:42%;">${escapeHtml(r.label)}</td>
                      <td style="padding:10px 16px;font-size:14px;color:#1f2733;font-weight:600;">${escapeHtml(r.value)}</td>
                    </tr>`,
               )
               .join('')}
           </table>
         </td></tr>`
      : ''

  const foot = input.footNote
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#8891a0;">${escapeHtml(input.footNote)}</p>`
    : ''

  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>`
    : ''

  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#eef1f5;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0"
      style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;
      border:1px solid #e3e7ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td style="padding:22px 28px;border-bottom:1px solid #eef1f5;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          ${logo ? `<td style="padding-right:12px;">${logo}</td>` : ''}
          <td style="font-size:16px;font-weight:700;color:#1f2733;">${org}
            <div style="font-size:11px;font-weight:500;color:#8891a0;letter-spacing:.02em;">powered by Bizzlivo</div>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 28px 26px;">
        <h1 style="margin:0 0 14px;font-size:20px;line-height:1.35;color:#161b22;">${escapeHtml(input.headline)}</h1>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td>${input.bodyHtml}</td></tr>
          ${cta}
          ${details}
        </table>
        ${foot}
      </td></tr>
      <tr><td style="padding:18px 28px;background:#fafbfc;border-top:1px solid #eef1f5;">
        <p style="margin:0;font-size:12px;line-height:1.5;color:#9aa2b0;">
          You're receiving this because you're a member of ${org} on Bizzlivo.
          Manage which emails you get in <a href="${safeUrl('/settings')}" style="color:${accent};">notification settings</a>.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

export interface RenderResult {
  subject: string
  html: string
}

type Data = Record<string, unknown>

function money(amount: unknown, currency: unknown): string {
  const n = Number(amount)
  const ccy = String(currency || '').toUpperCase()
  if (!isFinite(n)) return `${ccy} ${amount ?? ''}`.trim()
  return `${ccy ? ccy + ' ' : ''}${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ------------------------------------------------------------------
// renderTemplate — the registry. `data` carries a common shape:
//   subject, headline, message, cta_label, cta_path,
//   org_name, org_logo_url, brand_color  (branding injected by caller)
// plus per-type extras.
// ------------------------------------------------------------------
export function renderTemplate(type: string, data: Data): RenderResult {
  const orgName = (data.org_name as string) || 'Bizzlivo'
  const branding = {
    orgName,
    orgLogoUrl: (data.org_logo_url as string) ?? null,
    brandColor: (data.brand_color as string) ?? null,
  }
  const subject = (data.subject as string) || (data.headline as string) || `Update from ${orgName}`
  const headline = (data.headline as string) || subject
  const ctaLabel = (data.cta_label as string) || 'Open Bizzlivo'
  const ctaPath = (data.cta_path as string) || '/'

  switch (type) {
    case 'member_invite': {
      const inviterName = data.inviter_name ? ` by ${escapeHtml(data.inviter_name)}` : ''
      const body =
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3a4250;">` +
        `Hi ${escapeHtml(data.recipient_name || 'there')}, you've been invited${inviterName} to join ` +
        `<strong>${escapeHtml(orgName)}</strong> on Bizzlivo — your team's business office for goals, ` +
        `learning, network and wallet.</p>`
      return {
        subject: subject || `You've been invited to join ${orgName} on Bizzlivo`,
        html: baseLayout({
          ...branding,
          preheader: `Join ${orgName} on Bizzlivo`,
          headline: headline || `Join ${orgName} on Bizzlivo`,
          bodyHtml: body,
          ctaLabel: ctaLabel || 'Set your password & join',
          ctaUrl: (data.invite_url as string) || ctaPath,
          footNote: data.expires_in_days
            ? `This invite link expires in ${data.expires_in_days} days. If it lapses, ask an office admin to re-send it, or use your office login page: ${data.login_url ?? ''}`
            : undefined,
        }),
      }
    }

    case 'withdrawal_update': {
      const rows: { label: string; value: string }[] = [
        { label: 'Amount', value: money(data.amount, data.currency) },
        { label: 'Reference', value: String(data.reference ?? '—') },
        { label: 'Status', value: String(data.status ?? '').replace(/^\w/, (c) => c.toUpperCase()) },
      ]
      if (data.account_tail) rows.push({ label: 'Destination', value: String(data.account_tail) })
      const note = data.note
        ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#3a4250;"><strong>Note:</strong> ${escapeHtml(
            data.note,
          )}</p>`
        : ''
      return {
        subject,
        html: baseLayout({
          ...branding,
          preheader: `${headline} — ${money(data.amount, data.currency)}`,
          headline,
          bodyHtml:
            `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3a4250;">` +
            `This is an update on your withdrawal request with ${escapeHtml(orgName)}.</p>` +
            note,
          ctaLabel,
          ctaUrl: ctaPath,
          detailRows: rows,
          footNote:
            'For your security we only ever show the last 4 digits of a payout account. If you did not expect this update, contact your office admin.',
        }),
      }
    }

    case 'office_announcement': {
      const pr = String(data.priority || 'normal')
      const badge =
        pr === 'high'
          ? `<span style="display:inline-block;background:#fdecec;color:#c0392b;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;margin-bottom:12px;">Important</span>`
          : ''
      return {
        subject,
        html: baseLayout({
          ...branding,
          preheader: headline,
          headline,
          bodyHtml: badge + paragraphs(data.message),
          ctaLabel,
          ctaUrl: ctaPath,
        }),
      }
    }

    case 'goal_reminder':
    case 'goal_review':
    case 'notification_digest':
    case 'notification:goal_setup_reminder':
    case 'notification:goal_deadline':
    case 'notification:goal_approved':
    case 'notification:goal_changes_requested':
    case 'notification:goal_rejected':
    case 'notification:goal_month_closed': {
      return {
        subject,
        html: baseLayout({
          ...branding,
          preheader: (data.message as string) || headline,
          headline,
          bodyHtml: paragraphs(data.message || headline),
          ctaLabel,
          ctaUrl: ctaPath,
        }),
      }
    }

    case 'event_reminder': {
      const rows: { label: string; value: string }[] = []
      if (data.when) rows.push({ label: 'When', value: String(data.when) })
      if (data.location) rows.push({ label: 'Where', value: String(data.location) })
      return {
        subject,
        html: baseLayout({
          ...branding,
          preheader: headline,
          headline,
          bodyHtml: paragraphs(data.message || `A reminder about an upcoming event with ${orgName}.`),
          ctaLabel,
          ctaUrl: ctaPath,
          detailRows: rows.length ? rows : undefined,
        }),
      }
    }

    case 'billing_update': {
      const rows: { label: string; value: string }[] = []
      if (data.plan) rows.push({ label: 'Plan', value: String(data.plan) })
      if (data.renews_on) rows.push({ label: 'Active until', value: String(data.renews_on) })
      return {
        subject,
        html: baseLayout({
          ...branding,
          preheader: headline,
          headline,
          bodyHtml: paragraphs(data.message || headline),
          ctaLabel: ctaLabel || 'View billing',
          ctaUrl: ctaPath || '/settings',
          detailRows: rows.length ? rows : undefined,
          footNote:
            'This is a billing notice for your office. Payment receipts are sent separately by our payment processor.',
        }),
      }
    }

    case 'support_ticket_user': {
      return {
        subject,
        html: baseLayout({
          ...branding,
          preheader: headline,
          headline,
          bodyHtml: paragraphs(data.message || 'We have an update on your support request.'),
          ctaLabel: ctaLabel || 'View request',
          ctaUrl: ctaPath || '/support',
          footNote: 'Please reply through the support page so your office admins can see the full thread.',
        }),
      }
    }

    case 'support_ticket_staff': {
      const rows: { label: string; value: string }[] = []
      if (data.ticket_subject) rows.push({ label: 'Subject', value: String(data.ticket_subject) })
      if (data.category) rows.push({ label: 'Category', value: String(data.category) })
      if (data.priority) rows.push({ label: 'Priority', value: String(data.priority) })
      if (data.office) rows.push({ label: 'Office', value: String(data.office) })
      return {
        subject,
        html: baseLayout({
          ...branding,
          headline,
          bodyHtml: paragraphs(data.message || 'A support ticket needs attention.'),
          ctaLabel: ctaLabel || 'Open in Bizzlivo',
          ctaUrl: ctaPath || '/support',
          detailRows: rows.length ? rows : undefined,
        }),
      }
    }

    case 'security_alert': {
      return {
        subject,
        html: baseLayout({
          ...branding,
          preheader: headline,
          headline,
          bodyHtml: paragraphs(
            data.message ||
              "We're letting you know about a security-related change to your Bizzlivo account.",
          ),
          ctaLabel: ctaLabel || 'Review account',
          ctaUrl: ctaPath || '/settings',
          footNote:
            "If this was you, no action is needed. If it wasn't, reset your password immediately and contact your office admin.",
        }),
      }
    }

    case 'super_admin_alert': {
      return {
        subject,
        html: baseLayout({
          orgName: 'Bizzlivo Platform',
          headline,
          bodyHtml: paragraphs(data.message || headline),
          ctaLabel: ctaLabel || 'Open admin',
          ctaUrl: ctaPath || '/admin',
        }),
      }
    }

    default: {
      return {
        subject,
        html: baseLayout({
          ...branding,
          headline,
          bodyHtml: paragraphs(data.message || headline),
          ctaLabel,
          ctaUrl: ctaPath,
        }),
      }
    }
  }
}
