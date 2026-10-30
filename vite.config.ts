import { defineConfig, loadEnv, type Plugin } from 'vite'
import { resolve } from 'node:path'

const TURNSTILE = 'https://challenges.cloudflare.com'

function securityHeaders(connectSrc: string): Plugin {
  const csp = [
    "default-src 'none'",
    `script-src 'self' ${TURNSTILE}`,
    "style-src 'self'",
    "img-src 'self'",
    `connect-src ${connectSrc}`,
    `frame-src ${TURNSTILE}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return {
    name: 'txiki-security-headers',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
          injectTo: 'head-prepend',
        },
        {
          tag: 'meta',
          attrs: { name: 'referrer', content: 'strict-origin' },
          injectTo: 'head-prepend',
        },
        { tag: 'meta', attrs: { name: 'robots', content: 'noindex' }, injectTo: 'head-prepend' },
      ]
    },
  }
}

export default defineConfig(({ mode }) => {
  const url = loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL
  const connectSrc = url ? `'self' ${new URL(url).origin}` : "'self'"
  return {
    base: '/txiki/',
    resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
    plugins: [securityHeaders(connectSrc)],
    build: { sourcemap: true, target: 'es2022' },
  }
})
