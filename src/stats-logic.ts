import type { Stats } from '@/api/port'
import { countryName, relativeTime } from '@/format'
import { t, type MessageKey } from '@/i18n'

type Click = Stats['recent'][number]
type Point = Stats['points'][number]

const DEVICE_PHRASE: Record<string, MessageKey> = {
  mobile: 'devicePhraseMobile',
  tablet: 'devicePhraseTablet',
  desktop: 'devicePhraseDesktop',
}

export function lastClickSentence(
  stats: Pick<Stats, 'lastAt' | 'recent'>,
  now: number,
): string | null {
  if (!stats.lastAt) return null
  const when = relativeTime(stats.lastAt, now)
  const latest = stats.recent[0]
  const place = latest?.country ? countryName(latest.country) : null
  const phraseKey = latest ? DEVICE_PHRASE[latest.device] : undefined
  const device = phraseKey ? t(phraseKey) : null
  if (place && device) return t('lastFull', { when, country: place, device })
  if (place) return t('lastCountry', { when, country: place })
  if (device) return t('lastDevice', { when, device })
  return t('lastOnly', { when })
}

export function pairClicksWithPoints(
  recent: readonly Click[],
  points: readonly Point[],
): { clicks: { click: Click; point: Point | null }[]; unmatched: Point[] } {
  const byTime = new Map(points.map((p) => [p.at, p]))
  const shown = new Set<string>()
  const clicks = recent.map((click) => {
    const point = byTime.get(click.at) ?? null
    if (point) shown.add(click.at)
    return { click, point }
  })
  return { clicks, unmatched: points.filter((p) => !shown.has(p.at)) }
}
