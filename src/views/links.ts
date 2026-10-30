import { h } from '@/dom'
import { formatNumber, isRecent, relativeTime } from '@/format'
import { t } from '@/i18n'
import { loadLinks, type SavedLink } from '@/storage'
import { displayTarget } from '@/url'
import type { View, ViewDeps } from './types'

const CONCURRENCY = 4

type Summary = { total: number; lastAt: string | null } | 'gone' | 'error'
type Row = { li: HTMLElement; a: HTMLElement; n: HTMLElement; when: HTMLElement }

export function linksView(container: HTMLElement, deps: ViewDeps): View {
  const links = loadLinks(deps.storage)
  const summaries = new Map<string, Summary>()
  const rows = new Map<string, Row>()
  let disposed = false
  let started = false

  function paint(link: SavedLink): void {
    const row = rows.get(link.code)
    if (!row) return
    const summary = summaries.get(link.code)
    const now = deps.now()
    let count = '…'
    let when = ''
    let fresh = false
    if (summary === 'gone') {
      count = ''
      when = t('linkUnavailable')
    } else if (summary === 'error') {
      count = ''
      when = t('linkLoadError')
    } else if (summary) {
      count = formatNumber(summary.total)
      if (summary.lastAt) {
        when = relativeTime(summary.lastAt, now)
        fresh = isRecent(summary.lastAt, now)
      } else when = t('noClicks')
    }
    row.a.classList.toggle('fresh', fresh)
    row.n.replaceChildren(h('span', { class: 'sr' }, `${t('clicksSr')}: `), count)
    row.when.textContent = when
  }

  async function fetchAll(): Promise<void> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const queue = [...links]
    const worker = async (): Promise<void> => {
      for (let link = queue.shift(); link; link = queue.shift()) {
        try {
          const stats = await deps.api.stats(link.code, link.token, tz)
          summaries.set(link.code, stats ? { total: stats.total, lastAt: stats.lastAt } : 'gone')
        } catch {
          summaries.set(link.code, 'error')
        }
        if (disposed) return
        paint(link)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  }

  function row(link: SavedLink): HTMLElement {
    const n = h('span', { class: 'n' })
    const when = h('span', { class: 'when' })
    const a = h(
      'a',
      { class: 'li', href: `#s/${link.code}.${link.token}` },
      h('span', { class: 'code' }, link.code),
      n,
      h('span', { class: 'host' }, link.target ? displayTarget(link.target) : ''),
      when,
    )
    const li = h('li', {}, a)
    rows.set(link.code, { li, a, n, when })
    return li
  }

  function draw(): void {
    rows.clear()
    if (links.length === 0) {
      container.replaceChildren(
        h(
          'section',
          { class: 'card stack' },
          h('h1', { tabindex: '-1' }, t('linksEmptyTitle')),
          h('p', { class: 'lead' }, t('linksEmptyLead')),
          h('a', { class: 'btn', href: '#/' }, t('linksEmptyCta')),
          h('p', { class: 'cap' }, t('linksNote')),
        ),
      )
      return
    }
    container.replaceChildren(
      h(
        'div',
        { class: 'page-title' },
        h('h1', { tabindex: '-1' }, t('linksTitle')),
        h('a', { href: '#/' }, t('linksNew')),
      ),
      h('ul', { class: 'list' }, ...links.map(row)),
      h('p', { class: 'cap' }, t('linksNote')),
    )
    for (const link of links) paint(link)
  }

  return {
    draw() {
      draw()
      if (!started) {
        started = true
        void fetchAll()
      }
    },
    dispose() {
      disposed = true
    },
  }
}
