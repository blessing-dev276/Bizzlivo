import { supabase } from './supabase'

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export function validateAvatarFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose an image file.'
  if (file.size > MAX_AVATAR_BYTES) return 'Image must be under 5MB.'
  return null
}

// Uploads to the shared `avatars` bucket under {user_id}/{random-filename}
// (see 0011_notifications_and_avatars.sql), then points the profile row at
// the new public URL. A fresh random filename per upload sidesteps stale
// cached images after a re-upload.
export async function uploadAvatar(profileId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${profileId}/${crypto.randomUUID()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type })
  if (uploadErr) throw uploadErr
  const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path)
  const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: publicUrlData.publicUrl }).eq('id', profileId)
  if (updateErr) throw updateErr
  return publicUrlData.publicUrl
}
