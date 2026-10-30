import { InvalidTargetError, type ClickResult } from '@/api'
import { h, icon } from '@/dom'
import { t } from '@/i18n'
import { displayTarget } from '@/url'
import type { View, ViewDeps } from './types'

const LOCATION_TIMEOUT_MS = 10_000

type State =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'invalid' }
  | { kind: 'gone' }
  | { kind: 'ask'; click: ClickResult; waiting: boolean }

export function goView(container: HTMLElement, deps: ViewDeps, code: string): View {
  let state: State = { kind: 'loading' }
  let disposed = false
  let started = false
  let privacyOpen = false

  function leave(target: string): void {
    if (!disposed) deps.redirect(target)
  }

  function show(next: State): void {
    state = next
    deps.blank(next.kind === 'loading')
    draw()
  }

  function fetchClick(): Promise<ClickResult | null> {
    let pending = deps.clicks.get(code)
    if (!pending) {
      pending = deps.api.click(code, {
        lang: navigator.language,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        referrer: document.referrer,
      })
      deps.clicks.set(code, pending)
      pending.catch(() => deps.clicks.delete(code))
    }
    return pending
  }

  async function load(): Promise<void> {
    show({ kind: 'loading' })
    let click: ClickResult | null
    try {
      click = await fetchClick()
    } catch (cause) {
      if (disposed) return
      show({ kind: cause instanceof InvalidTargetError ? 'invalid' : 'failed' })
      return
    }
    if (disposed) return
    if (click === null) show({ kind: 'gone' })
    else if (click.askLocation && click.locationToken !== null && deps.geolocation) {
      show({ kind: 'ask', click, waiting: false })
    } else leave(click.target)
  }

  function share(click: ClickResult): void {
    const geolocation = deps.geolocation
    const locationToken = click.locationToken
    if (!geolocation || locationToken === null) return leave(click.target)
    show({ kind: 'ask', click, waiting: true })
    geolocation.getCurrentPosition(
      (position) => {
        deps.api
          .addLocation(locationToken, position.coords.latitude, position.coords.longitude)
          .catch(() => false)
          .finally(() => leave(click.target))
      },
      () => leave(click.target),
      { timeout: LOCATION_TIMEOUT_MS, maximumAge: 0, enableHighAccuracy: false },
    )
  }

  function notice(
    badge: SVGElement,
    title: string,
    lead: string | null,
    ...actions: (HTMLElement | null)[]
  ): HTMLElement {
    return h(
      'section',
      { class: 'card stack' },
      h('div', { class: 'badge' }, badge),
      h('h1', { tabindex: '-1' }, title),
      lead ? h('p', { class: 'lead' }, lead) : null,
      ...actions,
    )
  }

  function draw(): void {
    switch (state.kind) {
      case 'loading':
        container.replaceChildren()
        return
      case 'failed':
        container.replaceChildren(
          notice(
            icon('alert'),
            t('goErrTitle'),
            t('errNetwork'),
            h('button', { type: 'button', class: 'btn', onclick: () => void load() }, t('retry')),
          ),
        )
        return
      case 'invalid':
        container.replaceChildren(notice(icon('unlink'), t('goInvalidTitle'), t('goInvalidLead')))
        return
      case 'gone':
        container.replaceChildren(
          notice(
            icon('unlink'),
            t('goneTitle'),
            t('goneLead'),
            h('a', { class: 'btn sec', href: '#/' }, t('goneCreate')),
          ),
        )
        return
      case 'ask': {
        const { click, waiting } = state
        const shareBtn = h(
          'button',
          { type: 'button', class: 'btn', onclick: () => share(click) },
          waiting ? t('locWaiting') : t('locShare'),
        )
        shareBtn.disabled = waiting
        shareBtn.setAttribute('aria-busy', String(waiting))
        const more = h(
          'button',
          {
            type: 'button',
            class: 'link-btn',
            'aria-expanded': String(privacyOpen),
            'aria-controls': 'loc-privacy',
            onclick: () => {
              privacyOpen = !privacyOpen
              draw()
            },
          },
          t('locWhatSaved'),
        )
        container.replaceChildren(
          notice(
            icon('pin'),
            t('locTitle'),
            t('locLead'),
            h('p', { class: 'dest' }, t('locDest'), ' ', h('b', {}, displayTarget(click.target))),
            shareBtn,
            h(
              'button',
              { type: 'button', class: 'btn sec', onclick: () => leave(click.target) },
              t('locSkip'),
            ),
            h('p', { class: 'fine' }, more),
            h('p', { class: 'cap', id: 'loc-privacy', hidden: !privacyOpen }, t('privacyBody')),
          ),
        )
        return
      }
    }
  }

  return {
    draw() {
      if (!started) {
        started = true
        void load()
      } else draw()
    },
    dispose() {
      disposed = true
      deps.blank(false)
    },
  }
}
