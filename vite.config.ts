import { defineConfig, loadEnv, type Plugin } from 'vite'
import { resolve } from 'node:path'

function securityHeaders(connectSrc: string): Plugin {
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    `connect-src ${connectSrc}`,
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
          attrs: { name: 'referrer', content: 'no-referrer' },
          injectTo: 'head-prepend',
        },
        { tag: 'meta', attrs: { name: 'robots', content: 'noindex' }, injectTo: 'head-prepend' },
      ]
    },
  }
}

export default defineConfig(({ mode }) => {
  const url = loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL
  const connectSrc = url ? new URL(url).origin : "'none'"
  return {
    base: '/txiki/',
    resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
    plugins: [securityHeaders(connectSrc)],
    build: { sourcemap: true, target: 'es2022' },
  }
})
