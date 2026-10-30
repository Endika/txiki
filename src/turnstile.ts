const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render(
    el: HTMLElement,
    options: {
      sitekey: string
      theme: 'auto'
      'refresh-expired': 'never'
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    },
  ): string
  reset(id: string): void
  remove(id: string): void
}

export interface TurnstileCallbacks {
  onToken(token: string): void
  onExpired(): void
  onError(): void
}

export interface TurnstileHandle {
  reset(): void
  remove(): void
}

function current(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile
}

let loading: Promise<TurnstileApi> | null = null

function load(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const ready = current()
    if (ready) return resolve(ready)
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.addEventListener('load', () => {
      const api = current()
      if (api) resolve(api)
      else {
        loading = null
        reject(new Error('Turnstile did not load'))
      }
    })
    script.addEventListener('error', () => {
      script.remove()
      loading = null
      reject(new Error('Turnstile script failed'))
    })
    document.head.append(script)
  })
  return loading
}

export function renderTurnstile(
  el: HTMLElement,
  siteKey: string,
  callbacks: TurnstileCallbacks,
): TurnstileHandle {
  let widget: { api: TurnstileApi; id: string } | null = null
  let removed = false
  let attempt = 0

  function start(): void {
    const mine = ++attempt
    load().then(
      (api) => {
        if (removed || mine !== attempt) return
        const id = api.render(el, {
          sitekey: siteKey,
          theme: 'auto',
          'refresh-expired': 'never',
          callback: (token) => {
            if (!removed) callbacks.onToken(token)
          },
          'expired-callback': () => {
            if (!removed) callbacks.onExpired()
          },
          'error-callback': () => {
            if (!removed) callbacks.onError()
          },
        })
        widget = { api, id }
      },
      () => {
        if (!removed && mine === attempt) callbacks.onError()
      },
    )
  }

  start()

  return {
    reset() {
      if (removed) return
      if (widget) widget.api.reset(widget.id)
      else start()
    },
    remove() {
      removed = true
      if (widget) widget.api.remove(widget.id)
      widget = null
    },
  }
}
