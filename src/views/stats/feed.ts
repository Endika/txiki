import type { Stats } from '@/api/port'
import { h } from '@/dom'
import { clockTime } from '@/format'
import { t } from '@/i18n'
import { pairClicksWithPoints } from '@/stats-logic'
import { osmLink } from '../map'
import { block } from './blocks'
import { country, deviceLabel, plain } from './labels'

export function feed(stats: Stats, now: number): HTMLElement[] {
  const { clicks, unmatched: extra } = pairClicksWithPoints(stats.recent, stats.points)
  const items = clicks.map(({ click: c, point }) => {
    const parts: string[] = [c.city ?? country(c.country), deviceLabel(c.device), plain(c.browser)]
    if (c.network) parts.push(c.network)
    if (c.referrerHost) parts.push(t('viaWeb', { host: c.referrerHost }))
    const text = h('span', {}, parts.join(' · '))
    if (c.channel) text.append(' ', h('span', { class: 'tag' }, c.channel))
    if (point) text.append(' · ', osmLink(point.lat, point.lon, t('mapLink')))
    return h('li', {}, h('time', { datetime: c.at }, clockTime(c.at, now)), text)
  })
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
