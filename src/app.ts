import type { ClickResult, TxikiApi } from '@/api/port'
import { h, icon } from '@/dom'
import {
  LOCALES,
  LOCALE_NAMES,
  detectLocale,
  getLocale,
  isLocale,
  setLocale,
  t,
  type Locale,
} from '@/i18n'
import { parseRoute, type Route } from '@/route'
import type { TurnstileCallbacks, TurnstileHandle } from '@/turnstile'
import { createView } from '@/views/create'
import { goView } from '@/views/go'
import { linksView } from '@/views/links'
import { privacyView } from '@/views/privacy'
import { statsView } from '@/views/stats'
import type { ClientContext, View, ViewDeps } from '@/views/types'

export const STORAGE_KEY = 'txiki.locale'
const SOURCE_URL = 'https://github.com/Endika/txiki'

export interface AppDeps {
  api: TxikiApi | null
  location: Location
  history: History
  storage: Storage
  turnstile: (el: HTMLElement, callbacks: TurnstileCallbacks) => TurnstileHandle
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | null
  webdriver: boolean
  redirect: (url: string) => void
  client: ClientContext
  languages: readonly string[]
  confirm: (message: string) => boolean
  now: () => number
  deviceModel: () => Promise<string | null>
  screenSize: () => { w: number; h: number }
  isFramed: () => boolean
}

function readStoredLocale(storage: Storage): Locale | null {
  try {
    const value = storage.getItem(STORAGE_KEY)
    return isLocale(value) ? value : null
  } catch {
    return null
  }
}

function storeLocale(storage: Storage, locale: Locale): void {
  try {
    storage.setItem(STORAGE_KEY, locale)
  } catch {
    // Storage can be blocked; the choice then lasts only for this visit.
  }
}

function widthOf(route: Route): 'narrow' | 'mid' | 'wide' {
  if (route.kind === 'stats') return 'wide'
  if (route.kind === 'links') return 'mid'
  return 'narrow'
}

export function mountApp(root: HTMLElement, deps: AppDeps): () => void {
  setLocale(readStoredLocale(deps.storage) ?? detectLocale(deps.languages))

  const picker = h('select', { id: 'locale' })
  for (const locale of LOCALES) {
    picker.append(h('option', { value: locale }, LOCALE_NAMES[locale]))
  }
  const nav = h('nav', { class: 'nav' })
  const main = h('main')
  const footer = h('footer', { class: 'foot' })
  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('a', { class: 'logo', href: '#/' }, h('i', { 'aria-hidden': 'true' }), 'txiki'),
      h('div', { class: 'topr' }, nav, h('div', { class: 'lang' }, picker, icon('chevron'))),
    ),
    main,
    footer,
  )

  const clicks = new Map<string, Promise<ClickResult | null>>()
  const header = root.querySelector<HTMLElement>('.top')!

  function blank(on: boolean): void {
    header.hidden = on
    footer.hidden = on
    main.hidden = on
  }

  let view: View | null = null
  let current: Route = parseRoute(deps.location.hash)
  let howOpen = false

  function drawNav(): void {
    const active = current.kind === 'home' ? 'home' : current.kind === 'links' ? 'links' : ''
    const stats = current.kind === 'stats'
    nav.setAttribute('aria-label', t('navLabel'))
    nav.replaceChildren(
      h(
        'a',
        { href: '#/', 'aria-current': active === 'home' ? 'page' : undefined },
        t('navCreate'),
      ),
      h(
        'a',
        { href: '#/links', 'aria-current': active === 'links' || stats ? 'page' : undefined },
        t('navLinks'),
      ),
    )
  }

  function drawFooter(): void {
    const toggle = h(
      'button',
      {
        type: 'button',
        class: 'link-btn',
        'aria-expanded': String(howOpen),
        'aria-controls': 'how',
        onclick: () => {
          howOpen = !howOpen
          drawFooter()
        },
      },
      t('footHow'),
    )
    const panel = h(
      'div',
      { class: 'how', id: 'how', hidden: !howOpen },
      h('p', {}, t('howPlain')),
      h(
        'ul',
        {},
        ...(
          [
            'howCount',
            'howCountry',
            'howCode',
            'howSalt',
            'howKey',
            'howHash',
            'howRls',
            'howLocation',
            'howRetention',
          ] as const
        ).map((key) => h('li', {}, t(key))),
      ),
      h('p', {}, h('a', { href: SOURCE_URL, rel: 'noopener noreferrer' }, t('howSource'))),
    )
    footer.replaceChildren(
      panel,
      h(
        'nav',
        { 'aria-label': t('footHow') },
        toggle,
        h('a', { href: '#/privacy' }, t('footPrivacy')),
        h('a', { href: SOURCE_URL, rel: 'noopener noreferrer' }, t('footCode')),
      ),
    )
  }

  function drawChrome(): void {
    const locale = getLocale()
    document.documentElement.lang = locale
    document.title = t('appTitle')
    picker.value = locale
    picker.setAttribute('aria-label', t('languageLabel'))
    drawNav()
    drawFooter()
  }

  function notice(draw: () => HTMLElement[]): View {
    return { dispose: () => {}, draw: () => main.replaceChildren(...draw()) }
  }

  function viewFor(): View {
    const framed = deps.isFramed()
    if (framed) {
      return notice(() => [
        h(
          'div',
          { class: 'card stack' },
          h('div', { class: 'badge' }, icon('alert')),
          h('h1', {}, t('framedTitle')),
          h('p', { class: 'lead' }, t('framedBody')),
          h(
            'a',
            {
              class: 'btn sec',
              href: deps.location.href,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            t('framedOpen'),
          ),
        ),
      ])
    }
    if (current.kind === 'privacy') return privacyView(main)
    if (!deps.api) {
      return notice(() => [
        h(
          'div',
          { class: 'card stack' },
          h('p', { class: 'banner', role: 'alert' }, icon('alert'), h('span', {}, t('errConfig'))),
        ),
      ])
    }
    const viewDeps: ViewDeps = {
      api: deps.api,
      location: deps.location,
      storage: deps.storage,
      turnstile: deps.turnstile,
      geolocation: deps.geolocation,
      webdriver: deps.webdriver,
      redirect: deps.redirect,
      client: deps.client,
      confirm: deps.confirm,
      now: deps.now,
      deviceModel: deps.deviceModel,
      screenSize: deps.screenSize,
      blank,
      clicks,
    }
    switch (current.kind) {
      case 'links':
        return linksView(main, viewDeps)
      case 'go':
        return goView(main, viewDeps, current.code, current.channel)
      case 'stats':
        return statsView(main, viewDeps, current.code, current.token)
      default:
        return createView(main, viewDeps)
    }
  }

  function route(moveFocus: boolean): void {
    view?.dispose()
    current = parseRoute(deps.location.hash)
    blank(false)
    main.dataset.width = widthOf(current)
    drawNav()
    view = viewFor()
    view.draw()
    if (moveFocus) main.querySelector<HTMLElement>('h1')?.focus()
  }

  function onHashChange(): void {
    route(true)
  }

  picker.addEventListener('change', () => {
    if (!isLocale(picker.value)) return
    setLocale(picker.value)
    storeLocale(deps.storage, picker.value)
    drawChrome()
    view?.draw()
  })
  window.addEventListener('hashchange', onHashChange)

  drawChrome()
  route(false)
  return () => {
    window.removeEventListener('hashchange', onHashChange)
    view?.dispose()
  }
}
