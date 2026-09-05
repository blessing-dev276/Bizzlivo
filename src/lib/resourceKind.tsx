import type { ReactNode } from 'react'
import type { Resource, ResourceKind, ResourcePurpose } from '../types/database'

export const KIND_LABEL: Record<ResourceKind, string> = { pdf: 'Book (PDF)', podcast: 'Podcast', video: 'Video' }

export const PURPOSE_LABEL: Record<ResourcePurpose, string> = {
  book: 'Personal Development',
  skill_set: 'Skill Set',
  freelancing: 'Freelancing',
}

export const KIND_ICON: Record<ResourceKind, ReactNode> = {
  pdf: <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>,
  podcast: <svg viewBox="0 0 24 24"><path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" /><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" /></svg>,
  video: <svg viewBox="0 0 24 24"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>,
}

const KNOWN_KINDS = new Set<string>(Object.keys(KIND_LABEL))

export function resourceKind(r: Pick<Resource, 'file_type'>): ResourceKind {
  return KNOWN_KINDS.has(r.file_type) ? (r.file_type as ResourceKind) : 'pdf'
}
