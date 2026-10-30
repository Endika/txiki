type Prop = string | boolean | undefined | ((event: Event) => void)
type Child = Node | string | null | false | undefined

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, Prop> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue
    if (typeof value === 'function') el.addEventListener(name.slice(2), value)
    else el.setAttribute(name, value === true ? '' : value)
  }
  for (const child of children) {
    if (child === null || child === false || child === undefined) continue
    el.append(child)
  }
  return el
}

const PATHS = {
  lock: '<rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
  eyeOff:
    '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/><path d="M2.5 13.5l11-11"/>',
  check: '<path d="M3 8.5l3 3 7-7"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 5.5v-1a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1"/>',
  alert: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.75V8.5M8 10.9v.1"/>',
  chevron: '<path d="M3 6l5 5 5-5"/>',
  pin: '<path d="M8 14.5s-4.75-4-4.75-7.9a4.75 4.75 0 0 1 9.5 0c0 3.9-4.75 7.9-4.75 7.9z"/><circle cx="8" cy="6.6" r="1.7"/>',
  unlink:
    '<path d="M6.5 9.5l3-3M7 4.2l.7-.7a2.9 2.9 0 0 1 4.1 4.1l-.7.7M9 11.8l-.7.7a2.9 2.9 0 0 1-4.1-4.1l.7-.7"/>',
  spinner: '<path d="M8 1.75a6.25 6.25 0 1 0 6.25 6.25"/>',
} as const

export function icon(name: keyof typeof PATHS, className = ''): SVGElement {
  const template = document.createElement('template')
  template.innerHTML = `<svg class="icon ${className}" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
  return template.content.firstElementChild as SVGElement
}

export function selectContents(el: HTMLElement): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus()
    el.select()
    return
  }
  const range = document.createRange()
  range.selectNodeContents(el)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export async function copyText(text: string, fallbackTarget: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    selectContents(fallbackTarget)
    return false
  }
}
