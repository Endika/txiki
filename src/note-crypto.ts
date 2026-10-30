export const NOTE_MAX = 100

const SALT = new TextEncoder().encode('txiki-note-v1')
const IV_BYTES = 12
const BLOB = /^[A-Za-z0-9_-]+$/

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function deriveKey(token: string, code: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', fromBase64Url(token), 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: new TextEncoder().encode(code) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptNote(token: string, code: string, text: string): Promise<string> {
  const length = [...text].length
  if (length === 0 || length > NOTE_MAX) throw new RangeError('Invalid note length')
  const key = await deriveKey(token, code)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(code) },
      key,
      new TextEncoder().encode(text),
    ),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return toBase64Url(out)
}

export async function decryptNote(
  token: string,
  code: string,
  blob: string,
): Promise<string | null> {
  try {
    if (!BLOB.test(blob)) return null
    const bytes = fromBase64Url(blob)
    if (bytes.length <= IV_BYTES) return null
    const key = await deriveKey(token, code)
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes.slice(0, IV_BYTES),
        additionalData: new TextEncoder().encode(code),
      },
      key,
      bytes.slice(IV_BYTES),
    )
    return new TextDecoder('utf-8', { fatal: true }).decode(plain)
  } catch {
    return null
  }
}
