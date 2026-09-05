import { supabase } from './supabase'
import type { Resource, ResourceKind, ResourcePurpose } from '../types/database'

export const MAX_PDF_BYTES = 20 * 1024 * 1024

// Shared by every place that can add to the resources library: the
// general Resources page (purpose picked by the admin) and the inline
// add-forms on Personal Development / Income Development (purpose fixed
// to 'book' / 'freelancing' by context). Keeps the upload-vs-link
// insert logic in one place instead of copy-pasted per pillar.
export async function createResource(params: {
  orgId: string
  uploadedBy: string
  title: string
  kind: ResourceKind
  purpose: ResourcePurpose
  file?: File | null
  linkUrl?: string | null
}): Promise<Resource> {
  const { orgId, uploadedBy, title, kind, purpose } = params

  if (kind === 'pdf') {
    if (!params.file) throw new Error('Choose a PDF file.')
    if (params.file.type !== 'application/pdf') throw new Error('Only PDF files are supported.')
    if (params.file.size > MAX_PDF_BYTES) throw new Error('File is too large — the limit is 20MB.')

    const resourceId = crypto.randomUUID()
    const path = `${orgId}/${resourceId}.pdf`
    const { error: uploadError } = await supabase.storage.from('resources').upload(path, params.file, { contentType: 'application/pdf' })
    // Re-thrown as a plain Error — supabase-js's own error classes don't
    // reliably satisfy `instanceof Error` after bundling, which was
    // silently swallowing real messages (e.g. the plan's resource-limit
    // trigger) behind a generic fallback in every caller.
    if (uploadError) throw new Error(uploadError.message)

    const { data, error: insertError } = await supabase
      .from('resources')
      .insert({
        id: resourceId,
        org_id: orgId,
        uploaded_by: uploadedBy,
        title,
        file_url: path,
        file_type: 'pdf',
        file_size_bytes: params.file.size,
        purpose,
      })
      .select()
      .single()
    if (insertError || !data) throw new Error(insertError?.message ?? 'Could not save resource.')
    return data as Resource
  }

  if (!params.linkUrl?.trim()) throw new Error(`Enter a ${kind} link.`)
  const { data, error: insertError } = await supabase
    .from('resources')
    .insert({
      org_id: orgId,
      uploaded_by: uploadedBy,
      title,
      file_url: params.linkUrl.trim(),
      file_type: kind,
      file_size_bytes: null,
      purpose,
    })
    .select()
    .single()
  if (insertError || !data) throw new Error(insertError?.message ?? 'Could not save resource.')
  return data as Resource
}
