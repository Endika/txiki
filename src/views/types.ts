import type { ClickResult, TxikiApi } from '@/api'
import type { TurnstileCallbacks, TurnstileHandle } from '@/turnstile'

export interface ViewDeps {
  api: TxikiApi
  location: Location
  storage: Storage
  turnstile: (el: HTMLElement, callbacks: TurnstileCallbacks) => TurnstileHandle
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | null
  redirect: (url: string) => void
  confirm: (message: string) => boolean
  now: () => number
  blank: (on: boolean) => void
  clicks: Map<string, Promise<ClickResult | null>>
}

export interface View {
  draw(): void
  dispose(): void
}
