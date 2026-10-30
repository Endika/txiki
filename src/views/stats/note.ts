import { h, icon } from '@/dom'
import { t } from '@/i18n'
import { NOTE_MAX } from '@/note-crypto'
import { noteTooLong, type NoteState } from '@/note-state'

export interface NoteHost {
  note: NoteState
  save: (text: string | null) => Promise<boolean>
}

export function noteRow(host: NoteHost): HTMLElement {
  const row = h('div', { class: 'noterow' })
  let current = host.note
  let editing = false
  let saving = false
  let error: string | null = null
  let draft = ''

  function focusEdit(): void {
    row.querySelector<HTMLElement>('.note-edit')?.focus()
  }

  function close(): void {
    editing = false
    error = null
    draw()
    focusEdit()
  }

  async function submit(value: string): Promise<void> {
    if (saving) return
    draft = value
    const text = value.trim()
    if (noteTooLong(text)) {
      error = t('noteTooLong', { max: NOTE_MAX })
      draw()
      return
    }
    saving = true
    error = null
    draw()
    const saved = await host.save(text === '' ? null : text)
    saving = false
    if (!saved) {
      error = t('noteSaveError')
      draw()
      return
    }
    current = text === '' ? { kind: 'none' } : { kind: 'text', text }
    close()
  }

  function drawEdit(): HTMLElement {
    const input = h('input', {
      class: 'field',
      type: 'text',
      autocomplete: 'off',
      'aria-label': t('noteLabel'),
      'aria-describedby': 'note-error',
    })
    input.value = draft
    input.disabled = saving
    input.setAttribute('aria-invalid', String(error !== null))
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !saving) close()
    })
    const save = h(
      'button',
      { type: 'submit', class: 'mini' },
      saving ? t('noteSaving') : t('noteSave'),
    )
    save.disabled = saving
    save.setAttribute('aria-busy', String(saving))
    const cancel = h('button', { type: 'button', class: 'mini', onclick: close }, t('noteCancel'))
    cancel.disabled = saving
    const form = h(
      'form',
      { class: 'noteform', novalidate: true },
      input,
      h('p', { class: 'field-error', id: 'note-error', role: 'alert' }, error),
      h('div', { class: 'noteform-btns' }, save, cancel),
    )
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      void submit(input.value)
    })
    queueMicrotask(() => {
      if (!saving && form.isConnected && !form.contains(document.activeElement)) input.focus()
    })
    return form
  }

  function drawView(): HTMLElement[] {
    const begin = (): void => {
      draft = current.kind === 'text' ? current.text : ''
      editing = true
      draw()
    }
    const button = (label: string, withIcon: boolean) =>
      h(
        'button',
        { type: 'button', class: 'link-btn note-edit', onclick: begin },
        withIcon ? icon('pencil') : null,
        withIcon ? ' ' : null,
        label,
      )
    switch (current.kind) {
      case 'none':
        return [button(t('noteAdd'), true)]
      case 'text':
        return [h('span', { class: 'notetext' }, current.text), button(t('noteEdit'), true)]
      case 'unreadable':
        return [
          h('span', { class: 'notetext dim' }, t('noteUnreadable')),
          button(t('noteEdit'), true),
        ]
    }
  }

  function draw(): void {
    row.replaceChildren(...(editing ? [drawEdit()] : drawView()))
  }

  draw()
  return row
}
