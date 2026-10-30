import { decryptNote, NOTE_MAX } from '@/note-crypto'

export type NoteState = { kind: 'none' } | { kind: 'text'; text: string } | { kind: 'unreadable' }

export function noteLength(text: string): number {
  return [...text].length
}

export function noteTooLong(text: string): boolean {
  return noteLength(text) > NOTE_MAX
}

export async function readNote(
  token: string,
  code: string,
  blob: string | null,
): Promise<NoteState> {
  if (blob === null) return { kind: 'none' }
  const text = await decryptNote(token, code, blob)
  return text === null || text === '' ? { kind: 'unreadable' } : { kind: 'text', text }
}
