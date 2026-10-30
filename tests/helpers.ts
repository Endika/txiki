import { vi } from 'vitest'
import type { Stats, TxikiApi } from '@/api/port'
import type { TurnstileCallbacks, TurnstileHandle } from '@/turnstile'
import { mountApp } from '@/app'
import type { ClientContext } from '@/views/types'
import { setLocale } from '@/i18n'
import { createFakeApi, type FakeApi } from './fake-api'

export const CLIENT: ClientContext = { lang: 'es-ES', tz: 'Europe/Madrid', referrer: '' }

export const NOW = Date.parse('2026-10-30T12:00:00Z')

type TurnstileFn = (el: HTMLElement, callbacks: TurnstileCallbacks) => TurnstileHandle

export type Widget = {
  el: HTMLElement
  callbacks: TurnstileCallbacks
  reset: ReturnType<typeof vi.fn<() => void>>
  remove: ReturnType<typeof vi.fn<() => void>>
}

export type Harness = {
  root: HTMLElement
  fake: FakeApi
  api: TxikiApi | null
  redirect: ReturnType<typeof vi.fn<(url: string) => void>>
  turnstile: ReturnType<typeof vi.fn<TurnstileFn>>
  widgets: Widget[]
  confirm: ReturnType<typeof vi.fn<(message: string) => boolean>>
  storage: Storage
  dispose: () => void
}

export type Options = {
  hash?: string
  storage?: Storage
  api?: TxikiApi | null
  fake?: FakeApi
  geolocation?: Pick<Geolocation, 'getCurrentPosition'> | null
  webdriver?: boolean
  turnstile?: TurnstileFn
  confirm?: boolean
  framed?: boolean
  client?: Partial<ClientContext>
  languages?: readonly string[]
  locale?: string | null
  deviceModel?: () => Promise<string | null>
  screenSize?: { w: number; h: number }
}

export function newFake(): FakeApi {
  return createFakeApi({ now: () => NOW })
}

export function mount(options: Options = {}): Harness {
  const storage = options.storage ?? localStorage
  if (!options.storage) {
    localStorage.clear()
    if (options.locale !== null) localStorage.setItem('txiki.locale', options.locale ?? 'es')
  }
  setLocale('es')
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  window.history.replaceState(null, '', '/txiki/' + (options.hash ?? ''))
  const fake = options.fake ?? newFake()
  const api = options.api === undefined ? fake : options.api
  const redirect = vi.fn<(url: string) => void>()
  const widgets: Widget[] = []
  const turnstile = vi.fn<TurnstileFn>(
    options.turnstile ??
      ((el, callbacks) => {
        const widget: Widget = {
          el,
          callbacks,
          reset: vi.fn(() => queueMicrotask(() => callbacks.onToken('token2'))),
          remove: vi.fn(),
        }
        widgets.push(widget)
        queueMicrotask(() => callbacks.onToken('token'))
        return widget
      }),
  )
  const confirm = vi.fn((_message: string) => options.confirm ?? true)
  const dispose = mountApp(root, {
    api,
    location: window.location,
    history: window.history,
    storage,
    turnstile,
    geolocation: options.geolocation ?? null,
    webdriver: options.webdriver ?? false,
    redirect,
    confirm,
    now: () => NOW,
    deviceModel: options.deviceModel ?? (() => Promise.resolve(null)),
    screenSize: () => options.screenSize ?? { w: 390, h: 844 },
    isFramed: () => options.framed ?? false,
    client: { ...CLIENT, ...options.client },
    languages: options.languages ?? ['en-US'],
  })
  return { root, fake, api, redirect, turnstile, widgets, confirm, storage, dispose }
}

export function $<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}

export function type(el: HTMLInputElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function emptyStats(overrides: Partial<Stats> = {}): Stats {
  return {
    target: 'https://example.com/a?b=1',
    createdAt: '2026-10-16T10:00:00.000Z',
    askLocation: false,
    disabled: false,
    total: 0,
    uniques: 0,
    bots: 0,
    note: null,
    firstAt: null,
    lastAt: null,
    byDay: [],
    byHour: new Array<number>(24).fill(0),
    countries: [],
    browsers: [],
    os: [],
    devices: [],
    referrers: [],
    langs: [],
    networks: [],
    cities: [],
    models: [],
    screens: [],
    channels: [],
    recent: [],
    points: [],
    ...overrides,
  }
}
