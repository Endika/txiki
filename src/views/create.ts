import {
  CapacityError,
  CaptchaError,
  InvalidUrlError,
  NetworkError,
  RateLimitedError,
  RequestError,
} from '@/api/port'
import { h, icon } from '@/dom'
import { t, type MessageKey } from '@/i18n'
import { encryptNote, NOTE_MAX } from '@/note-crypto'
import { noteTooLong } from '@/note-state'
import { shortLink, statsHash, statsLink } from '@/route'
import { saveLink } from '@/storage'
import type { TurnstileHandle } from '@/turnstile'
import { displayUrl, normalizeUrl } from '@/url'
import { copyButton, fallbackInput } from './copy'
import type { View, ViewDeps } from './types'

type Result = {
  link: string
  stats: string
  hash: string
  saved: boolean
  note: string | null
  noteFailed: boolean
}

function errorKey(cause: unknown): MessageKey {
  if (cause instanceof InvalidUrlError) return 'errInvalidUrl'
  if (cause instanceof CaptchaError) return 'errCaptcha'
  if (cause instanceof RateLimitedError) return 'errRateLimited'
  if (cause instanceof CapacityError) return 'errCapacity'
  if (cause instanceof NetworkError) return 'errNetwork'
  if (cause instanceof RequestError) return 'errRequest'
  return 'errGeneric'
}

export function createView(container: HTMLElement, deps: ViewDeps): View {
  let url = ''
  let askLocation = false
  let note = ''
  let noteInvalid = false
  let busy = false
  let error: MessageKey | null = null
  let result: Result | null = null
  let animate = false
  let disposed = false
  let drawn = false
  let token: string | null = null
  let captchaFailed = false
  let widget = h('div', { class: 'ts' })
  let handle: TurnstileHandle | null = null
  let paint: () => void = () => {}

  function startCaptcha(): void {
    handle?.remove()
    token = null
    captchaFailed = false
    const mine = h('div', { class: 'ts' })
    widget = mine
    handle = deps.turnstile(mine, {
      onToken: (value) => {
        if (widget !== mine) return
        token = value
        captchaFailed = false
        if (error === 'errCaptchaLoad' || error === 'errCaptchaPending') error = null
        paint()
      },
      onExpired: () => {
        if (widget !== mine) return
        token = null
        handle?.reset()
      },
      onError: () => {
        if (widget !== mine) return
        token = null
        captchaFailed = true
        error = 'errCaptchaLoad'
        paint()
      },
    })
  }

  async function submit(): Promise<void> {
    if (busy) return
    const target = normalizeUrl(url)
    if (!target) {
      error = 'errInvalidUrl'
      paint()
      return
    }
    const noteText = note.trim()
    noteInvalid = noteTooLong(noteText)
    if (noteInvalid) {
      paint()
      return
    }
    if (!token) {
      error = captchaFailed ? 'errCaptchaLoad' : 'errCaptchaPending'
      paint()
      return
    }
    const spent = token
    token = null
    busy = true
    error = null
    paint()
    try {
      const created = await deps.api.create(target, askLocation, spent)
      if (disposed) return
      let noteSaved = noteText === ''
      if (!noteSaved) {
        try {
          const blob = await encryptNote(created.token, created.code, noteText)
          noteSaved = await deps.api.setNote(created.code, created.token, blob)
        } catch {
          noteSaved = false
        }
        if (disposed) return
      }
      const base = deps.location.origin + deps.location.pathname
      const saved = saveLink(deps.storage, {
        code: created.code,
        token: created.token,
        target,
        createdAt: new Date(deps.now()).toISOString(),
      })
      handle?.remove()
      handle = null
      result = {
        link: shortLink(created.code, base),
        stats: statsLink(created.code, created.token, base),
        hash: statsHash(created.code, created.token),
        saved,
        note: noteText !== '' && noteSaved ? noteText : null,
        noteFailed: !noteSaved,
      }
      animate = true
      busy = false
      render(true)
      return
    } catch (cause) {
      error = errorKey(cause)
      if (cause instanceof InvalidUrlError) token = spent
      else handle?.reset()
    }
    if (disposed) return
    busy = false
    paint()
  }

  function again(): void {
    url = ''
    note = ''
    noteInvalid = false
    askLocation = false
    error = null
    result = null
    startCaptcha()
    animate = true
    render(true)
  }

  function drawResult(done: Result): HTMLElement[] {
    const field = (id: string, labelId: string, full: string) =>
      h('input', {
        class: 'field mono',
        id,
        readonly: true,
        value: displayUrl(full),
        'aria-labelledby': labelId,
      })
    const linkField = field('short-link', 'short-label', done.link)
    const keyField = field('stats-link', 'key-label', done.stats)
    const linkFallback = fallbackInput(done.link, t('shortLinkLabel'))
    const keyFallback = fallbackInput(done.stats, t('keyLabel'))
    const linkNote = h('p', { class: 'hint', role: 'status' })
    const keyNote = h('p', { class: 'hint', role: 'status' })
    const warning = done.saved
      ? h('p', { class: 'note', role: 'note' }, h('b', {}, t('keyNoteStrong')), ' ', t('keyNote'))
      : h(
          'p',
          { class: 'note strong', role: 'alert' },
          h('b', {}, t('notSavedStrong')),
          ' ',
          t('notSavedNote'),
        )
    const noteWarning = done.noteFailed
      ? h('p', { class: 'note', role: 'status' }, t('noteCreateFailed'))
      : null
    const cls = animate ? 'rise' : ''
    return [
      h(
        'section',
        { class: `card stack ${cls}` },
        h('h1', { tabindex: '-1' }, t('readyTitle')),
        h('p', { class: 'lead' }, t('readyLead')),
        h(
          'div',
          {},
          h('label', { class: 'label', id: 'short-label', for: 'short-link' }, t('shortLinkLabel')),
          h(
            'div',
            { class: 'copyrow' },
            linkField,
            linkFallback,
            copyButton(done.link, linkFallback, 'copy', linkNote),
          ),
          linkNote,
        ),
        done.note === null
          ? null
          : h('p', { class: 'notetext' }, t('noteOnCard', { note: done.note })),
      ),
      h(
        'section',
        { class: `card stack ${cls}` },
        h(
          'div',
          {},
          h(
            'label',
            { class: 'label', id: 'key-label', for: 'stats-link' },
            icon('lock'),
            t('keyLabel'),
          ),
          h(
            'div',
            { class: 'copyrow' },
            keyField,
            keyFallback,
            copyButton(done.stats, keyFallback, 'copy', keyNote, 'lock'),
          ),
          keyNote,
        ),
        warning,
        noteWarning,
        h('a', { class: 'btn', href: done.hash }, t('viewStats')),
        h('button', { type: 'button', class: 'btn sec', onclick: again }, t('createAnother')),
      ),
    ]
  }

  function drawForm(): HTMLElement[] {
    const input = h('input', {
      class: 'field',
      id: 'url',
      type: 'text',
      inputmode: 'url',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      placeholder: t('urlPlaceholder'),
      required: true,
      'aria-describedby': 'form-error',
    })
    input.value = url
    input.addEventListener('input', () => {
      url = input.value
    })
    const noteInput = h('input', {
      class: 'field',
      id: 'note',
      type: 'text',
      autocomplete: 'off',
      'aria-describedby': 'note-hint note-error',
    })
    noteInput.value = note
    noteInput.addEventListener('input', () => {
      note = noteInput.value
      if (noteInvalid && !noteTooLong(note.trim())) {
        noteInvalid = false
        paint()
      }
    })
    const noteProblem = h('p', { class: 'field-error', id: 'note-error', role: 'alert' })
    const check = h('input', { type: 'checkbox', id: 'ask-location' })
    check.checked = askLocation
    check.addEventListener('change', () => {
      askLocation = check.checked
    })
    const problem = h('p', { class: 'error', id: 'form-error', role: 'alert' })
    const retry = h(
      'button',
      {
        type: 'button',
        class: 'btn sec',
        id: 'captcha-retry',
        onclick: () => {
          captchaFailed = false
          error = null
          handle?.reset()
          paint()
        },
      },
      t('captchaRetry'),
    )
    const submitBtn = h('button', { type: 'submit', class: 'btn' })
    paint = (): void => {
      problem.textContent = error ? t(error) : ''
      input.setAttribute('aria-invalid', error === 'errInvalidUrl' ? 'true' : 'false')
      noteProblem.textContent = noteInvalid ? t('noteTooLong', { max: NOTE_MAX }) : ''
      noteInput.setAttribute('aria-invalid', String(noteInvalid))
      retry.hidden = !captchaFailed
      submitBtn.disabled = busy
      submitBtn.setAttribute('aria-busy', String(busy))
      submitBtn.replaceChildren(
        ...(busy ? [icon('spinner', 'spin')] : []),
        h('span', {}, busy ? t('creating') : t('createButton')),
      )
    }
    paint()
    const form = h(
      'form',
      { class: 'card stack', novalidate: true },
      h('h1', { tabindex: '-1' }, t('createTitle')),
      h('p', { class: 'lead' }, t('createLead')),
      h('div', {}, h('label', { class: 'label', for: 'url' }, t('urlLabel')), input),
      h(
        'div',
        {},
        h('label', { class: 'label', for: 'note' }, t('noteLabel')),
        noteInput,
        h('p', { class: 'hint', id: 'note-hint' }, t('noteHint')),
        noteProblem,
      ),
      h(
        'label',
        { class: 'check' },
        check,
        h('span', {}, t('askLocationLabel'), h('small', {}, t('askLocationHint'))),
      ),
      widget,
      retry,
      problem,
      submitBtn,
      h('p', { class: 'fine' }, h('a', { href: '#/privacy' }, t('locWhatSaved'))),
    )
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      void submit()
    })
    return [form]
  }

  function render(focus: boolean): void {
    container.replaceChildren(...(result ? drawResult(result) : drawForm()))
    animate = false
    if (focus) container.querySelector<HTMLElement>('h1')?.focus()
  }

  startCaptcha()

  return {
    draw() {
      if (drawn && !result) startCaptcha()
      drawn = true
      render(false)
    },
    dispose() {
      disposed = true
      handle?.remove()
      handle = null
    },
  }
}
