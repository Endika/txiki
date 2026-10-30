import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkError, type TxikiApi } from '@/api/port'
import { t } from '@/i18n'
import { decryptNote, encryptNote } from '@/note-crypto'
import { saveLink } from '@/storage'
import { $, mount, newFake, settle, type, type Harness } from './helpers'

let h: Harness

afterEach(async () => {
  h.dispose()
  await settle()
})

async function submitWith(note: string): Promise<void> {
  await settle()
  type($(h.root, '#url'), 'https://endika.dev/cv-2026.pdf')
  type($(h.root, '#note'), note)
  $<HTMLFormElement>(h.root, 'form').requestSubmit()
  await vi.waitFor(() =>
    expect(h.root.querySelector('#short-link, #note-error:not(:empty)')).not.toBeNull(),
  )
}

async function withNote(text: string | null) {
  const fake = newFake()
  const link = await fake.create('https://example.com/a', false, 'tok')
  if (text !== null)
    await fake.setNote(link.code, link.token, await encryptNote(link.token, link.code, text))
  return { fake, ...link, hash: `#s/${link.code}.${link.token}` }
}

async function ready(selector = '.noterow .notetext, .noterow button'): Promise<void> {
  await vi.waitFor(() => expect(h.root.querySelector(selector)).not.toBeNull())
  await settle()
}

async function stored(): Promise<void> {
  await vi.waitFor(() => expect(noteRow().querySelector('input')).toBeNull())
}

function noteRow(): HTMLElement {
  return $(h.root, '.noterow')
}

describe('note on the create screen', () => {
  it('encrypts the note and stores it for the new link', async () => {
    h = mount()
    await submitWith('  CV · Empresa X  ')
    const [stored] = [...h.fake.links().values()]
    expect(stored!.note).not.toBeNull()
    expect(await decryptNote(stored!.token, stored!.code, stored!.note!)).toBe('CV · Empresa X')
    expect(h.root.textContent).toContain(t('noteOnCard', { note: 'CV · Empresa X' }))
    expect(h.root.querySelector('.note[role=status]')).toBeNull()
  })

  it('creates the link without a note when the field is blank', async () => {
    h = mount()
    await submitWith('   ')
    expect([...h.fake.links().values()][0]!.note).toBeNull()
    expect(h.root.textContent).not.toContain(t('noteCreateFailed'))
  })

  it.each([
    ['returns false', async () => false],
    [
      'throws',
      async () => {
        throw new NetworkError()
      },
    ],
  ])('still shows the link and warns when saving the note %s', async (_label, setNote) => {
    const fake = newFake()
    const api: TxikiApi = { ...fake, setNote }
    h = mount({ fake, api })
    await submitWith('CV')
    expect(fake.links().size).toBe(1)
    expect(h.root.querySelector('#short-link')).not.toBeNull()
    expect($(h.root, '.note[role=status]').textContent).toBe(t('noteCreateFailed'))
    expect(h.root.textContent).not.toContain(t('noteOnCard', { note: 'CV' }))
  })

  it('rejects more than 100 code points without creating anything', async () => {
    h = mount()
    await submitWith('😀'.repeat(101))
    expect(h.fake.links().size).toBe(0)
    expect($(h.root, '#note-error').textContent).toBe(t('noteTooLong', { max: 100 }))
    expect($(h.root, '#note').getAttribute('aria-invalid')).toBe('true')
    type($(h.root, '#note'), '😀'.repeat(100))
    expect($(h.root, '#note-error').textContent).toBe('')
    $<HTMLFormElement>(h.root, 'form').requestSubmit()
    await vi.waitFor(() => expect(h.root.querySelector('#short-link')).not.toBeNull())
    expect(h.fake.links().size).toBe(1)
  })

  it('clears the note with the rest of the form on “Acortar otro”', async () => {
    h = mount()
    await submitWith('CV')
    $<HTMLButtonElement>(h.root, 'button.sec').click()
    expect($<HTMLInputElement>(h.root, '#note').value).toBe('')
  })
})

describe('note on the dashboard', () => {
  it('offers to add a note when there is none', async () => {
    const { fake, hash } = await withNote(null)
    h = mount({ hash, fake })
    await settle()
    expect($(noteRow(), 'button').textContent?.trim()).toBe(t('noteAdd'))
  })

  it('shows the decrypted note as text, never as HTML', async () => {
    const { fake, hash } = await withNote('<b>CV</b> & Co')
    h = mount({ hash, fake })
    await ready()
    expect($(noteRow(), '.notetext').textContent).toBe('<b>CV</b> & Co')
    expect(noteRow().querySelector('b')).toBeNull()
    expect($(noteRow(), 'button').textContent?.trim()).toBe(t('noteEdit'))
  })

  it('adds, edits and clears the note, keeping it across reloads', async () => {
    const { fake, code, token, hash } = await withNote(null)
    h = mount({ hash, fake })
    await settle()
    $<HTMLButtonElement>(noteRow(), 'button').click()
    const input = $<HTMLInputElement>(noteRow(), 'input')
    await settle()
    expect(document.activeElement).toBe(input)
    type(input, ' Primera ')
    $<HTMLFormElement>(noteRow(), 'form').requestSubmit()
    await stored()
    expect($(noteRow(), '.notetext').textContent).toBe('Primera')
    expect(document.activeElement).toBe($(noteRow(), 'button'))
    expect(await decryptNote(token, code, fake.links().get(code)!.note!)).toBe('Primera')

    h.dispose()
    h = mount({ hash, fake, storage: h.storage })
    await ready()
    expect($(noteRow(), '.notetext').textContent).toBe('Primera')

    $<HTMLButtonElement>(noteRow(), 'button').click()
    expect($<HTMLInputElement>(noteRow(), 'input').value).toBe('Primera')
    type($(noteRow(), 'input'), 'Segunda')
    $<HTMLFormElement>(noteRow(), 'form').requestSubmit()
    await stored()
    expect(await decryptNote(token, code, fake.links().get(code)!.note!)).toBe('Segunda')

    $<HTMLButtonElement>(noteRow(), 'button').click()
    type($(noteRow(), 'input'), '  ')
    $<HTMLFormElement>(noteRow(), 'form').requestSubmit()
    await stored()
    expect(fake.links().get(code)!.note).toBeNull()
    expect($(noteRow(), 'button').textContent?.trim()).toBe(t('noteAdd'))
  })

  it('cancels with Escape or the button without saving', async () => {
    const { fake, code, hash } = await withNote('Antes')
    h = mount({ hash, fake })
    await ready()
    $<HTMLButtonElement>(noteRow(), 'button').click()
    type($(noteRow(), 'input'), 'Cambiado')
    $(noteRow(), 'input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(noteRow().querySelector('input')).toBeNull()
    expect($(noteRow(), '.notetext').textContent).toBe('Antes')
    expect(document.activeElement).toBe($(noteRow(), 'button'))
    $<HTMLButtonElement>(noteRow(), 'button').click()
    $<HTMLButtonElement>(noteRow(), 'button[type=button]').click()
    expect($(noteRow(), '.notetext').textContent).toBe('Antes')
    const before = fake.links().get(code)!.note
    await settle()
    expect(fake.links().get(code)!.note).toBe(before)
  })

  it('keeps the editor open with an error when saving fails', async () => {
    const { fake, hash } = await withNote('Antes')
    const api: TxikiApi = { ...fake, setNote: async () => false }
    h = mount({ hash, fake, api })
    await ready()
    $<HTMLButtonElement>(noteRow(), 'button').click()
    type($(noteRow(), 'input'), 'Nuevo')
    $<HTMLFormElement>(noteRow(), 'form').requestSubmit()
    await vi.waitFor(() => expect($(noteRow(), '#note-error').textContent).toBe(t('noteSaveError')))
    expect($<HTMLInputElement>(noteRow(), 'input').value).toBe('Nuevo')
    expect($<HTMLInputElement>(noteRow(), 'input').disabled).toBe(false)
  })

  it('refuses a note over 100 code points', async () => {
    const { fake, code, hash } = await withNote(null)
    h = mount({ hash, fake })
    await settle()
    $<HTMLButtonElement>(noteRow(), 'button').click()
    type($(noteRow(), 'input'), 'x'.repeat(101))
    $<HTMLFormElement>(noteRow(), 'form').requestSubmit()
    await settle()
    expect($(noteRow(), '#note-error').textContent).toBe(t('noteTooLong', { max: 100 }))
    expect(fake.links().get(code)!.note).toBeNull()
  })

  it('shows “Nota ilegible” for a note that cannot be decrypted and lets it be replaced', async () => {
    const { fake, code, token, hash } = await withNote(null)
    await fake.setNote(code, token, await encryptNote('A'.repeat(43), code, 'otra llave'))
    h = mount({ hash, fake })
    await ready()
    expect($(noteRow(), '.notetext').textContent).toBe(t('noteUnreadable'))
    expect(h.root.querySelector('.answer')).not.toBeNull()
    $<HTMLButtonElement>(noteRow(), 'button').click()
    expect($<HTMLInputElement>(noteRow(), 'input').value).toBe('')
    type($(noteRow(), 'input'), 'Nueva')
    $<HTMLFormElement>(noteRow(), 'form').requestSubmit()
    await stored()
    expect($(noteRow(), '.notetext').textContent).toBe('Nueva')
  })
})

describe('note in Mis links', () => {
  it('shows the note as the label and moves the host to the second line', async () => {
    const withText = await withNote('CV · Empresa X')
    const plain = await withText.fake.create('https://eslojusto.es/finiquito', false, 'tok')
    h = mount({ hash: '#/links', fake: withText.fake })
    saveLink(h.storage, { ...plain, target: 'https://eslojusto.es/finiquito', createdAt: 'x' })
    saveLink(h.storage, {
      code: withText.code,
      token: withText.token,
      target: 'https://example.com/a',
      createdAt: 'x',
    })
    h.dispose()
    h = mount({ hash: '#/links', fake: withText.fake, storage: h.storage })
    await ready('.li .titled')
    const rows = [...h.root.querySelectorAll('.li')]
    const noted = rows.find((r) => r.querySelector('.titled'))!
    expect(noted.querySelector('.code')!.textContent).toBe('CV · Empresa X')
    expect(noted.querySelector('.host')!.textContent).toBe(`${withText.code} · example.com/a`)
    const other = rows.find((r) => r !== noted)!
    expect(other.querySelector('.code')!.textContent).toBe(plain.code)
    expect(other.querySelector('.host')!.textContent).toBe('eslojusto.es/finiquito')
  })

  it('keeps the row unchanged for an unreadable note and renders HTML literally', async () => {
    const bad = await withNote(null)
    await bad.fake.setNote(bad.code, bad.token, await encryptNote('B'.repeat(43), bad.code, 'x'))
    const html = await bad.fake.create('https://example.com/b', false, 'tok')
    await bad.fake.setNote(
      html.code,
      html.token,
      await encryptNote(html.token, html.code, '<b>hola</b>'),
    )
    h = mount({ hash: '#/links', fake: bad.fake })
    saveLink(h.storage, {
      code: bad.code,
      token: bad.token,
      target: 'https://example.com/a',
      createdAt: 'x',
    })
    saveLink(h.storage, { ...html, target: 'https://example.com/b', createdAt: 'x' })
    h.dispose()
    h = mount({ hash: '#/links', fake: bad.fake, storage: h.storage })
    await ready('.li .titled')
    const titled = $(h.root, '.li .titled')
    expect(titled.textContent).toBe('<b>hola</b>')
    expect(titled.querySelector('b')).toBeNull()
    const unread = [...h.root.querySelectorAll('.li .code')].find((c) => c.textContent === bad.code)
    expect(unread).toBeDefined()
  })
})
