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
