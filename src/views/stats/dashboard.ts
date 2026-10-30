import type { Stats } from '@/api/port'
import { h } from '@/dom'
import { shortDate } from '@/format'
import { t, tCount } from '@/i18n'
import { shortLink, statsLink } from '@/route'
import { lastClickSentence } from '@/stats-logic'
import { displayTarget } from '@/url'
import { copyButton, fallbackInput } from '../copy'
import { charts, type MapHost } from './blocks'
import { feed } from './feed'

export interface DashboardContext {
  code: string
  token: string
  location: Pick<Location, 'origin' | 'pathname'>
  now: number
  deleting: boolean
  deleteFailed: boolean
  onRemove: () => void
  map: MapHost
}

export function dashboard(stats: Stats, ctx: DashboardContext): HTMLElement {
  const { code, token, location, deleting, deleteFailed } = ctx
  const base = location.origin + location.pathname
  const short = shortLink(code, base)
  const key = statsLink(code, token, base)
  const fallbackLink = fallbackInput(short, t('copyLink'))
  const fallbackKey = fallbackInput(key, t('copyKey'))
  const note = h('p', { class: 'hint', role: 'status' })
  const last = lastClickSentence(stats, ctx.now)
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
    { type: 'button', class: 'link-btn danger', onclick: ctx.onRemove },
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
        copyButton(key, fallbackKey, 'copyKey', note, 'lock'),
      ),
    ),
    h('p', { class: 'hint' }, t('keysHint')),
    note,
    stats.disabled ? h('p', { class: 'band', role: 'status' }, t('disabledBand')) : null,
    ...answer,
    stats.bots > 0
      ? h('p', { class: 'hint', role: 'status' }, tCount('botVisits', stats.bots))
      : null,
    ...(stats.total > 0
      ? [h('div', { class: 'blocks' }, ...charts(stats, ctx.now, ctx.map), ...feed(stats, ctx.now))]
      : []),
    deleteFailed ? h('p', { class: 'error', role: 'alert' }, t('errDelete')) : null,
    h('div', { class: 'foot-row' }, h('span', {}, t('retentionNote')), deleteBtn),
  )
}
