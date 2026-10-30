import './style.css'
import { createHttpApi } from '@/api'
import { mountApp } from '@/app'
import { renderTurnstile } from '@/turnstile'

function safeStorage(): Storage {
  try {
    return localStorage
  } catch {
    const memory = new Map<string, string>()
    return {
      getItem: (name) => memory.get(name) ?? null,
      setItem: (name, value) => void memory.set(name, value),
    } as Storage
  }
}

const root = document.getElementById('app')
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return ''
  }
}

function isFramed(): boolean {
  try {
    return window.top !== window.self
  } catch {
    return true
  }
}

if (root) {
  mountApp(root, {
    api: url && key ? createHttpApi(url, key) : null,
    location,
    history,
    storage: safeStorage(),
    turnstile: (el, callbacks) => {
      if (siteKey) return renderTurnstile(el, siteKey, callbacks)
      queueMicrotask(callbacks.onError)
      return { reset: () => callbacks.onError(), remove: () => {} }
    },
    geolocation: 'geolocation' in navigator ? navigator.geolocation : null,
    webdriver: navigator.webdriver === true,
    redirect: (target) => location.replace(target),
    client: { lang: navigator.language, tz: timeZone(), referrer: document.referrer },
    languages: navigator.languages,
    confirm: (message) => window.confirm(message),
    now: Date.now,
    isFramed,
  })
}
