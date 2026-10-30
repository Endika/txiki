import { countryName, languageName } from '@/format'
import { t, type MessageKey } from '@/i18n'

const DEVICE_LABEL: Record<string, MessageKey> = {
  mobile: 'deviceMobile',
  tablet: 'deviceTablet',
  desktop: 'deviceDesktop',
}
export function deviceLabel(device: string): string {
  const key = DEVICE_LABEL[device]
  return key ? t(key) : device
}

export function plain(key: string | null): string {
  if (key === null) return t('unknown')
  return key === 'Other' ? t('otherName') : key
}

export function country(code: string | null): string {
  return (code ? countryName(code) : null) ?? t('unknown')
}

export function language(tag: string | null): string {
  return tag === null ? t('unknown') : languageName(tag)
}

export function network(key: string | null): string {
  return key ?? t('unknownF')
}

export function channel(key: string | null): string {
  return key ?? t('channelDirect')
}

export function city(key: string | null): string {
  return key ?? t('cityElsewhere')
}

export function model(key: string | null): string {
  return key ?? t('unknown')
}

const SCREEN_LABEL: Record<string, MessageKey> = {
  'small-phone': 'screenSmallPhone',
  phone: 'screenPhone',
  tablet: 'screenTablet',
  laptop: 'screenLaptop',
  large: 'screenLarge',
}
export function screenLabel(key: string | null): string {
  if (key === null) return t('unknownF')
  const message = SCREEN_LABEL[key]
  return message ? t(message) : key
}
