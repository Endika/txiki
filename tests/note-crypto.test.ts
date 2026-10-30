import { describe, expect, it } from 'vitest'
import { NOTE_MAX, decryptNote, encryptNote } from '@/note-crypto'

const CODE = 'Ab3dE9x'
const TOKEN = 'C'.repeat(43)
const OTHER_TOKEN = 'D'.repeat(43)

describe('note crypto', () => {
  it('round-trips plain text, emoji and the maximum length', async () => {
    for (const text of [
      'CV · Empresa X',
      'hola 👩‍💻🎉',
      'x'.repeat(NOTE_MAX),
      '😀'.repeat(NOTE_MAX),
    ]) {
      const blob = await encryptNote(TOKEN, CODE, text)
      await expect(decryptNote(TOKEN, CODE, blob)).resolves.toBe(text)
    }
  })

  it('does not decrypt with another token or another code', async () => {
    const blob = await encryptNote(TOKEN, CODE, 'secret')
    await expect(decryptNote(OTHER_TOKEN, CODE, blob)).resolves.toBeNull()
    await expect(decryptNote(TOKEN, 'Zz9yX8w', blob)).resolves.toBeNull()
  })

  it('rejects tampered blobs and garbage', async () => {
    const blob = await encryptNote(TOKEN, CODE, 'secret')
    const mid = blob[20] === 'A' ? 'B' : 'A'
    await expect(
      decryptNote(TOKEN, CODE, blob.slice(0, 20) + mid + blob.slice(21)),
    ).resolves.toBeNull()
    await expect(decryptNote(TOKEN, CODE, blob.slice(0, -4))).resolves.toBeNull()
    for (const junk of ['', 'abc', '!!!!', 'A'.repeat(40), 'not base64 at all']) {
      await expect(decryptNote(TOKEN, CODE, junk)).resolves.toBeNull()
    }
  })

  it('uses a fresh IV every time', async () => {
    const a = await encryptNote(TOKEN, CODE, 'same')
    const b = await encryptNote(TOKEN, CODE, 'same')
    expect(a).not.toBe(b)
  })

  it('keeps the worst case within the server check', async () => {
    const blob = await encryptNote(TOKEN, CODE, '😀'.repeat(NOTE_MAX))
    expect(blob).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(blob.length).toBeGreaterThanOrEqual(22)
    expect(blob.length).toBeLessThanOrEqual(600)
  })

  it('rejects empty and over-long notes', async () => {
    await expect(encryptNote(TOKEN, CODE, '')).rejects.toThrow()
    await expect(encryptNote(TOKEN, CODE, 'x'.repeat(NOTE_MAX + 1))).rejects.toThrow()
  })
})
