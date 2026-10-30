import type { Stats } from '@/api/port'
import { OTHER_KEY, barList, collapse, dayLine, hourColumns, type BarItem } from '@/charts'
import { h } from '@/dom'
import { dayLabel, localDay, shiftDay } from '@/format'
import { getLocale, t, type MessageKey } from '@/i18n'
import { worldMap, type WorldMap } from '../map'
import { country, deviceLabel, language, plain } from './labels'

const DAYS = 14

export interface MapHost {
  disposed(): boolean
  adopt(map: WorldMap): void
}

export function block(
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
  return h('div', { class: 'axis', 'aria-hidden': 'true' }, ...labels.map((l) => h('span', {}, l)))
}

function summary(items: BarItem[], label: (k: string | null) => string): string {
  return collapse(items, 5)
    .map((i) => `${i.key === OTHER_KEY ? t('other') : label(i.key)} ${i.count}`)
    .join(' · ')
}

function captionFor(title: MessageKey, items: BarItem[], label: (k: string | null) => string) {
  return items.length > 0 ? h('p', { class: 'cap' }, `${t(title)}: ${summary(items, label)}`) : null
}

export function charts(stats: Stats, now: number, map: MapHost): HTMLElement[] {
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
  return [days, hours, where, ...mapBlock(stats, now, map), withWhat, web]
}

function mapBlock(stats: Stats, now: number, host: MapHost): HTMLElement[] {
  if (!stats.points.length && !stats.countries.some((c) => c.key && c.key !== OTHER_KEY)) return []
  const slot = block('', t('mapTitle'), null)
  void import('@/world-data').then(({ WORLD }) => {
    if (host.disposed() || !slot.isConnected) return
    const drawn = worldMap(stats, WORLD, now)
    if (!drawn) {
      slot.remove()
      return
    }
    host.adopt(drawn)
    slot.append(drawn.el)
  })
  return [slot]
}
