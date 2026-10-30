import { screenClass } from './screen.ts'
import { isBot, parseUserAgent } from './ua.ts'
import { RPC_ERRORS } from './rpc-errors.ts'
import { clientIp, corsHeaders, referrerHost } from './request.ts'

export type Deps = {
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>
  verifyTurnstile(token: string, ip: string | null): Promise<boolean>
  country(ip: string | null): string | null
}

const MAX_BODY_BYTES = 8 * 1024
const CODE_RE = /^[0-9A-Za-z]{7}$/
const MODEL_RE = /^[A-Za-z0-9 ._+()-]+$/
const CHANNEL_RE = /^[a-z0-9-]{1,24}$/

function cleanModel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const model = value.trim()
  return model.length >= 1 && model.length <= 40 && MODEL_RE.test(model) ? model : null
}

function cleanChannel(value: unknown): string | null {
  return typeof value === 'string' && CHANNEL_RE.test(value) ? value : null
}

function cleanScreen(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const { w, h } = value as Record<string, unknown>
  return screenClass(w, h)
}

function json(origin: string | null, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function preflight(req: Request, origin: string | null): Response | null {
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') {
    const res = json(origin, 405, { error: 'method_not_allowed' })
    res.headers.set('Allow', 'POST, OPTIONS')
    return res
  }
  return null
}

type Body = { ok: true; value: Record<string, unknown> } | { ok: false; res: Response }

async function readLimited(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'))
  if (declared > MAX_BODY_BYTES) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

async function readBody(req: Request, origin: string | null): Promise<Body> {
  const text = await readLimited(req)
  if (text === null) return { ok: false, res: json(origin, 413, { error: 'too_large' }) }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    value = null
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { ok: true, value: value as Record<string, unknown> }
  }
  return { ok: false, res: json(origin, 400, { error: 'invalid_request' }) }
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data)) throw new Error('bad shape')
  const row: unknown = data[0]
  return typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : null
}

function failure(origin: string | null, fn: string, err: unknown): Response {
  const message = err instanceof Error ? err.message : ''
  if (fn === 'create_link') {
    if (message.includes(RPC_ERRORS.invalidTarget))
      return json(origin, 400, { error: 'invalid_url' })
    if (message.includes(RPC_ERRORS.rateLimited))
      return json(origin, 429, { error: 'rate_limited' })
    if (message.includes(RPC_ERRORS.capacityReached))
      return json(origin, 503, { error: 'capacity' })
  }
  console.error(`rpc ${fn} failed`)
  return json(origin, 500, { error: 'server' })
}

export async function handleCreate(
  req: Request,
  deps: Pick<Deps, 'rpc' | 'verifyTurnstile'>,
): Promise<Response> {
  const origin = req.headers.get('origin')
  const early = preflight(req, origin)
  if (early) return early
  const body = await readBody(req, origin)
  if (!body.ok) return body.res
  const { url, askLocation, turnstileToken } = body.value
  if (
    typeof url !== 'string' ||
    typeof askLocation !== 'boolean' ||
    typeof turnstileToken !== 'string'
  ) {
    return json(origin, 400, { error: 'invalid_request' })
  }
  let target: string
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
    if (parsed.username || parsed.password) throw new Error('credentials')
    target = parsed.href
  } catch {
    return json(origin, 400, { error: 'invalid_url' })
  }
  const ip = clientIp(req.headers)
  if (ip === null) return json(origin, 400, { error: 'invalid_request' })
  if (!(await deps.verifyTurnstile(turnstileToken, ip))) {
    return json(origin, 403, { error: 'captcha' })
  }
  try {
    const row = firstRow(
      await deps.rpc('create_link', { p_target: target, p_ask_location: askLocation, p_ip: ip }),
    )
    if (!row || typeof row.code !== 'string' || typeof row.token !== 'string') {
      throw new Error('bad shape')
    }
    return json(origin, 200, { code: row.code, token: row.token })
  } catch (err) {
    return failure(origin, 'create_link', err)
  }
}

export async function handleClick(
  req: Request,
  deps: Pick<Deps, 'rpc' | 'country'>,
): Promise<Response> {
  const origin = req.headers.get('origin')
  const early = preflight(req, origin)
  if (early) return early
  const body = await readBody(req, origin)
  if (!body.ok) return body.res
  const { code, lang, tz, referrer, bot, model, screen, channel } = body.value
  if (typeof code !== 'string' || !CODE_RE.test(code)) {
    return json(origin, 404, { error: 'not_found' })
  }
  const ip = clientIp(req.headers)
  const userAgent = req.headers.get('user-agent')
  const ua = parseUserAgent(userAgent)
  try {
    const row = firstRow(
      await deps.rpc('record_click', {
        p_code: code,
        p_ip: ip ?? '',
        p_country: deps.country(ip),
        p_browser: ua.browser,
        p_os: ua.os,
        p_device: ua.device,
        p_lang: typeof lang === 'string' ? lang : null,
        p_tz: typeof tz === 'string' ? tz : null,
        p_referrer_host: referrerHost(referrer),
        p_bot: isBot(userAgent, bot === true),
        p_model: cleanModel(model),
        p_screen: cleanScreen(screen),
        p_channel: cleanChannel(channel),
      }),
    )
    if (!row) return json(origin, 404, { error: 'not_found' })
    return json(origin, 200, {
      target: row.target,
      askLocation: row.ask_location,
      locationToken: row.location_token ?? null,
    })
  } catch (err) {
    return failure(origin, 'record_click', err)
  }
}
