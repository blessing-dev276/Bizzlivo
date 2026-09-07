import { supabase } from './supabase'

export const MAX_LOGO_BYTES = 5 * 1024 * 1024

export function validateLogoFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose an image file (PNG, JPG or SVG).'
  if (file.size > MAX_LOGO_BYTES) return 'Logo must be under 5MB.'
  return null
}

// Uploads to the public `org-logos` bucket under {org_id}/{random}.{ext}
// (see 0060_office_profile.sql — writes are gated to org admins), then
// points organizations.logo_url at the new public URL. A fresh random
// filename per upload sidesteps stale cached images after a re-upload.
export async function uploadOfficeLogo(orgId: string, file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const path = `${orgId}/${crypto.randomUUID()}.${ext}`
  const { error: uploadErr } = await supabase.storage
    .from('org-logos')
    .upload(path, file, { contentType: file.type, upsert: true })
  if (uploadErr) throw uploadErr
  const { data } = supabase.storage.from('org-logos').getPublicUrl(path)
  const { error: updateErr } = await supabase.from('organizations').update({ logo_url: data.publicUrl }).eq('id', orgId)
  if (updateErr) throw updateErr
  return data.publicUrl
}

export async function clearOfficeLogo(orgId: string): Promise<void> {
  const { error } = await supabase.from('organizations').update({ logo_url: null }).eq('id', orgId)
  if (error) throw error
}
