export type ClickResult = {
  target: string
  askLocation: boolean
  locationToken: string | null
}

export type Count = { key: string | null; count: number }

export type Stats = {
  target: string
  createdAt: string
  askLocation: boolean
  disabled: boolean
  total: number
  uniques: number
  bots: number
  note: string | null
  firstAt: string | null
  lastAt: string | null
  byDay: { day: string; count: number }[]
  byHour: number[]
  countries: Count[]
  browsers: Count[]
  os: Count[]
  devices: Count[]
  referrers: Count[]
  langs: Count[]
  recent: {
    at: string
    country: string | null
    browser: string
    os: string
    device: string
    referrerHost: string | null
  }[]
  points: { lat: number; lon: number; at: string }[]
}

export interface TxikiApi {
  create(
    url: string,
    askLocation: boolean,
    turnstileToken: string,
  ): Promise<{ code: string; token: string }>
  click(
    code: string,
    ctx: { lang: string; tz: string; referrer: string; bot: boolean },
  ): Promise<ClickResult | null>
  addLocation(token: string, lat: number, lon: number): Promise<boolean>
  stats(code: string, token: string, tz: string): Promise<Stats | null>
  remove(code: string, token: string): Promise<boolean>
  setNote(code: string, token: string, note: string | null): Promise<boolean>
}

export class NetworkError extends Error {
  constructor(options?: ErrorOptions) {
    super('Network or server error', options)
    this.name = 'NetworkError'
  }
}

export class InvalidTargetError extends NetworkError {
  constructor(options?: ErrorOptions) {
    super(options)
    this.name = 'InvalidTargetError'
  }
}

export class RequestError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Request rejected (${status})`)
    this.name = 'RequestError'
    this.status = status
  }
}

export class CaptchaError extends Error {
  constructor() {
    super('Captcha verification failed')
    this.name = 'CaptchaError'
  }
}

export class RateLimitedError extends Error {
  constructor() {
    super('Too many requests')
    this.name = 'RateLimitedError'
  }
}

export class CapacityError extends Error {
  constructor() {
    super('The service is at capacity')
    this.name = 'CapacityError'
  }
}

export class InvalidUrlError extends Error {
  constructor() {
    super('Invalid URL')
    this.name = 'InvalidUrlError'
  }
}
