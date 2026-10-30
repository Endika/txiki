import { copyText, h, icon } from '@/dom'
import { t, type MessageKey } from '@/i18n'

export function copyButton(
  text: string,
  fallbackTarget: HTMLElement,
  key: MessageKey = 'copy',
  note?: HTMLElement,
  glyph: 'copy' | 'lock' = 'copy',
): HTMLButtonElement {
  const label = h('span', {}, t(key))
  const button = h('button', { type: 'button', class: 'mini' }, icon(glyph), label)
  let timer: ReturnType<typeof setTimeout> | undefined
  button.addEventListener('click', async () => {
    const ok = await copyText(text, fallbackTarget)
    clearTimeout(timer)
    label.textContent = ok ? t('copied') : t(key)
    button.replaceChildren(icon(ok ? 'check' : glyph), label)
    if (note) note.textContent = ok ? '' : t('copyFailed')
    if (ok) {
      timer = setTimeout(() => {
        label.textContent = t(key)
        button.replaceChildren(icon(glyph), label)
      }, 2000)
    }
  })
  return button
}

export function fallbackInput(value: string, label: string): HTMLInputElement {
  const input = h('input', {
    class: 'sr',
    readonly: true,
    tabindex: '-1',
    'aria-label': label,
  })
  input.value = value
  return input
}
