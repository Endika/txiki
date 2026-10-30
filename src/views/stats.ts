import type { Stats } from '@/api'
import { OTHER_KEY, barList, collapse, dayLine, hourColumns, type BarItem } from '@/charts'
import { h, icon } from '@/dom'
import {
  clockTime,
  countryName,
  dayLabel,
  languageName,
  localDay,
  relativeTime,
  shiftDay,
  shortDate,
} from '@/format'
import { getLocale, t, tCount, type MessageKey } from '@/i18n'
import { shortLink, statsLink } from '@/route'
import { loadLinks, removeLink, saveLink } from '@/storage'
import { displayTarget } from '@/url'
import { copyButton, fallbackInput } from './copy'
import { osmLink, worldMap, type WorldMap } from './map'
import type { View, ViewDeps } from './types'

const DAYS = 14

type State =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'gone' } | { kind: 'ready'; stats: Stats }

const DEVICE_LABEL: Record<string, MessageKey> = {
  mobile: 'deviceMobile',
  tablet: 'deviceTablet',
  desktop: 'deviceDesktop',
}
const DEVICE_PHRASE: Record<string, MessageKey> = {
  mobile: 'devicePhraseMobile',
  tablet: 'devicePhraseTablet',
  desktop: 'devicePhraseDesktop',
}

function deviceLabel(device: string): string {
  const key = DEVICE_LABEL[device]
  return key ? t(key) : device
}

function plain(key: string | null): string {
  if (key === null) return t('unknown')
  return key === 'Other' ? t('otherName') : key
}

function country(code: string | null): string {
  return (code ? countryName(code) : null) ?? t('unknown')
}

function language(tag: string | null): string {
  return tag === null ? t('unknown') : languageName(tag)
}

export function statsView(
  container: HTMLElement,
  deps: ViewDeps,
  code: string,
  token: string,
): View {
  let state: State = { kind: 'loading' }
  let disposed = false
  let started = false
  let deleting = false
  let focused = false
  let deleteFailed = false
  let mapView: WorldMap | null = null
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  async function load(): Promise<void> {
    state = { kind: 'loading' }
    draw()
    try {
      const stats = await deps.api.stats(code, token, tz)
      if (disposed) return
      if (stats === null) {
        state = { kind: 'gone' }
      } else {
        if (!loadLinks(deps.storage).some((l) => l.code === code)) {
          saveLink(deps.storage, {
            code,
            token,
            target: stats.target,
            createdAt: stats.createdAt,
          })
        }
        state = { kind: 'ready', stats }
      }
    } catch {
      if (disposed) return
      state = { kind: 'error' }
    }
    draw()
  }

  async function remove(): Promise<void> {
    if (deleting || !deps.confirm(t('deleteConfirm'))) return
    deleting = true
    deleteFailed = false
    draw()
    try {
      await deps.api.remove(code, token)
    } catch {
      if (disposed) return
      deleting = false
      deleteFailed = true
      draw()
      return
    }
    removeLink(deps.storage, code)
    if (!disposed) deps.location.hash = '#/links'
  }

  function sentence(stats: Stats): string | null {
    if (!stats.lastAt) return null
    const when = relativeTime(stats.lastAt, deps.now())
    const latest = stats.recent[0]
    const place = latest?.country ? countryName(latest.country) : null
    const phraseKey = latest ? DEVICE_PHRASE[latest.device] : undefined
    const device = phraseKey ? t(phraseKey) : null
    if (place && device) return t('lastFull', { when, country: place, device })
    if (place) return t('lastCountry', { when, country: place })
    if (device) return t('lastDevice', { when, device })
    return t('lastOnly', { when })
  }

  function block(
    cls: string,
    title: string,
    note: string | null,
    ...content: (Node | null)[]
  ): HTMLElement {
    return h(
      'section',
      { class: `blk ${cls}`.trim() },
      h('h2', {}, title, note ? h('span', {}, note) : null),
      ...content,
    )
  }

  function axis(...labels: string[]): HTMLElement {
    return h(
      'div',
      { class: 'axis', 'aria-hidden': 'true' },
      ...labels.map((l) => h('span', {}, l)),
    )
  }

  function summary(items: BarItem[], label: (k: string | null) => string): string {
    return collapse(items, 5)
      .map((i) => `${i.key === OTHER_KEY ? t('other') : label(i.key)} ${i.count}`)
      .join(' · ')
  }

  function captionFor(title: MessageKey, items: BarItem[], label: (k: string | null) => string) {
    return items.length > 0
      ? h('p', { class: 'cap' }, `${t(title)}: ${summary(items, label)}`)
      : null
  }

  function charts(stats: Stats): HTMLElement[] {
    const now = deps.now()
    const today = localDay(now)
    const start = shiftDay(today, -(DAYS - 1))
    const mid = shiftDay(today, -Math.floor(DAYS / 2))
    const days = block(
      'half',
      t('blockDays'),
      t('blockDaysNote', { n: DAYS }),
      dayLine(stats.byDay, {
        days: DAYS,
        end: today,
        summary: t('daysSummary', { n: DAYS }),
        label: (day, n) => `${dayLabel(day)}: ${n}`,
      }),
      axis(dayLabel(start), dayLabel(mid), t('today')),
    )
    const hours = block(
      'half',
      t('blockHours'),
      t('blockHoursNote'),
      hourColumns(stats.byHour, {
        summary: t('hoursSummary'),
        label: (hour, n) => `${t('hourShort', { h: hour })}: ${n}`,
      }),
      axis(
        ...[0, 6, 12, 18, 23].map((hour, i) =>
          i === 0 ? t('hourShort', { h: hour }) : String(hour),
        ),
      ),
    )
    const where = block(
      'third',
      t('blockWhere'),
      null,
      barList(stats.countries, {
        label: country,
        otherLabel: t('other'),
        locale: getLocale(),
      }),
    )
    const withWhat = block(
      'third',
      t('blockWith'),
      null,
      barList(stats.browsers, { label: plain, otherLabel: t('other'), locale: getLocale() }),
      captionFor('withDevices', stats.devices, (k) => (k === null ? t('unknown') : deviceLabel(k))),
      captionFor('withSystems', stats.os, plain),
      captionFor('withLangs', stats.langs, language),
    )
    const web = block(
      'third',
      t('blockWeb'),
      null,
      barList(stats.referrers, {
        label: (k) => (k === null ? t('direct') : k),
        otherLabel: t('other'),
        locale: getLocale(),
      }),
    )
    return [days, hours, where, ...mapBlock(stats), withWhat, web]
  }

  function mapBlock(stats: Stats): HTMLElement[] {
    if (!stats.points.length && !stats.countries.some((c) => c.key && c.key !== OTHER_KEY))
      return []
    const slot = block('', t('mapTitle'), null)
    void import('../world-data').then(({ WORLD }) => {
      if (disposed || !slot.isConnected) return
      const drawn = worldMap(stats, WORLD, deps.now())
      if (!drawn) {
        slot.remove()
        return
      }
      mapView?.dispose()
      mapView = drawn
      slot.append(drawn.el)
    })
    return [slot]
  }

  function feed(stats: Stats): HTMLElement[] {
    const now = deps.now()
    const byTime = new Map(stats.points.map((p) => [p.at, p]))
    const shown = new Set<string>()
    const items = stats.recent.map((c) => {
      const parts: (string | Node)[] = [country(c.country), deviceLabel(c.device), plain(c.browser)]
      if (c.referrerHost) parts.push(t('viaWeb', { host: c.referrerHost }))
      const point = byTime.get(c.at)
      if (point) shown.add(c.at)
      const text = h('span', {}, parts.join(' · '))
      if (point) text.append(' · ', osmLink(point.lat, point.lon, t('mapLink')))
      return h('li', {}, h('time', { datetime: c.at }, clockTime(c.at, now)), text)
    })
    const extra = stats.points.filter((p) => !shown.has(p.at))
    const out = [
      block(
        '',
        t('blockRecent'),
        stats.points.length > 0 ? t('blockRecentPlaces', { n: stats.points.length }) : null,
        h('ul', { class: 'feed' }, ...items),
      ),
    ]
    if (extra.length > 0) {
      out.push(
        block(
          '',
          t('blockPlaces'),
          null,
          h(
            'ul',
            { class: 'feed' },
            ...extra.map((p) =>
              h(
                'li',
                {},
                h('time', { datetime: p.at }, clockTime(p.at, now)),
                h('span', {}, osmLink(p.lat, p.lon, `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`)),
              ),
            ),
          ),
        ),
      )
    }
    return out
  }

  function dashboard(stats: Stats): HTMLElement {
    const base = deps.location.origin + deps.location.pathname
    const short = shortLink(code, base)
    const key = statsLink(code, token, base)
    const fallbackLink = fallbackInput(short, t('copyLink'))
    const fallbackKey = fallbackInput(key, t('copyKey'))
    const note = h('p', { class: 'hint', role: 'status' })
    const last = sentence(stats)
    const answer =
      stats.total === 0
        ? [
            h('p', { class: 'answer' }, t('answerNone')),
            h('p', { class: 'lead' }, t('answerNoneSub')),
          ]
        : [
            h(
              'p',
              { class: 'answer' },
              tCount('answerTimes', stats.total),
              ' ',
              h('em', {}, tCount('answerPeople', stats.uniques)),
              last ? ' ' : null,
              last ? h('span', { class: 'last' }, last) : null,
            ),
          ]
    const deleteBtn = h(
      'button',
      { type: 'button', class: 'link-btn danger', onclick: () => void remove() },
      deleting ? t('deleting') : t('deleteLink'),
    )
    deleteBtn.disabled = deleting
    return h(
      'div',
      { class: 'dash' },
      h('a', { class: 'back', href: '#/links' }, t('statsBack')),
      h(
        'div',
        { class: 'linkhead' },
        h(
          'div',
          {},
          h(
            'h1',
            { class: 'code', tabindex: '-1' },
            code,
            stats.askLocation ? h('span', { class: 'tag' }, t('statsAsksLocation')) : null,
          ),
          h(
            'div',
            { class: 'to' },
            `→ ${displayTarget(stats.target)} · ${t('statsCreated', { date: shortDate(stats.createdAt) })}`,
          ),
        ),
        h(
          'div',
          { class: 'actions' },
          fallbackLink,
          fallbackKey,
          copyButton(short, fallbackLink, 'copyLink', note),
          copyButton(key, fallbackKey, 'copyKey', note),
        ),
      ),
      note,
      stats.disabled ? h('p', { class: 'band', role: 'status' }, t('disabledBand')) : null,
      ...answer,
      stats.bots > 0
        ? h('p', { class: 'hint', role: 'status' }, tCount('botVisits', stats.bots))
        : null,
      ...(stats.total > 0 ? [h('div', { class: 'blocks' }, ...charts(stats), ...feed(stats))] : []),
      deleteFailed ? h('p', { class: 'error', role: 'alert' }, t('errDelete')) : null,
      h('div', { class: 'foot-row' }, h('span', {}, t('retentionNote')), deleteBtn),
    )
  }

  function draw(): void {
    switch (state.kind) {
      case 'loading':
        container.replaceChildren(
          h(
            'section',
            { class: 'card stack', role: 'status' },
            h('p', { class: 'fine' }, icon('spinner', 'spin'), ' ', t('statsLoading')),
          ),
        )
        return
      case 'error':
        container.replaceChildren(
          h(
            'section',
            { class: 'card stack' },
            h(
              'p',
              { class: 'banner', role: 'alert' },
              icon('alert'),
              h('span', {}, t('errNetwork')),
            ),
            h('button', { type: 'button', class: 'btn', onclick: () => void load() }, t('retry')),
          ),
        )
        return
      case 'gone':
        container.replaceChildren(
          h(
            'section',
            { class: 'card stack' },
            h('div', { class: 'badge' }, icon('unlink')),
            h('h1', { tabindex: '-1' }, t('statsGoneTitle')),
            h('p', { class: 'lead' }, t('statsGoneBody')),
            h(
              'button',
              {
                type: 'button',
                class: 'btn sec',
                onclick: () => {
                  removeLink(deps.storage, code)
                  deps.location.hash = '#/links'
                },
              },
              t('statsGoneRemove'),
            ),
          ),
        )
        return
      case 'ready':
        container.replaceChildren(dashboard(state.stats))
        if (!focused) {
          focused = true
          container.querySelector<HTMLElement>('h1')?.focus()
        }
        return
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
      mapView?.dispose()
    },
  }
}
