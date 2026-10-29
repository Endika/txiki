import { clientIp, corsHeaders, referrerHost } from '../../supabase/functions/_shared/request.ts'

describe('referrerHost', () => {
  it('returns the lowercase hostname only', () => {
    expect(referrerHost('https://T.co/x?y=1#z')).toBe('t.co')
    expect(referrerHost('https://ex.com.')).toBe('ex.com')
    expect(referrerHost('http://User@Example.COM:8080/a')).toBe('example.com')
  })

  it('returns null for anything that is not an absolute http(s) URL', () => {
    expect(referrerHost('nope')).toBeNull()
    expect(referrerHost(42)).toBeNull()
    expect(referrerHost('')).toBeNull()
    expect(referrerHost(null)).toBeNull()
    expect(referrerHost(undefined)).toBeNull()
    expect(referrerHost({})).toBeNull()
    expect(referrerHost('javascript:alert(1)')).toBeNull()
  })
})

describe('clientIp', () => {
  it('reads cf-connecting-ip, trimmed', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '  203.0.113.7 ' }))).toBe('203.0.113.7')
  })

  it('takes the first value of a comma-separated list', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4')
  })

  it('ignores x-forwarded-for and returns null when the header is missing or empty', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4' }))).toBeNull()
    expect(clientIp(new Headers())).toBeNull()
    expect(clientIp(new Headers({ 'cf-connecting-ip': '   ' }))).toBeNull()
  })
})

describe('corsHeaders', () => {
  it.each(['https://endika.github.io', 'http://localhost:5173', 'http://localhost:4173'])(
    'allows %s',
    (origin) => {
      const h = corsHeaders(origin)
      expect(h['Access-Control-Allow-Origin']).toBe(origin)
      expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
      expect(h['Access-Control-Allow-Headers']).toBe('content-type')
      expect(h['Access-Control-Max-Age']).toBe('86400')
      expect(h['Vary']).toBe('Origin')
    },
  )

  it.each([
    'https://evil.example',
    'https://endika.github.io.evil.example',
    'http://localhost:3000',
    null,
  ])('does not allow %s', (origin) => {
    const h = corsHeaders(origin)
    expect(h).not.toHaveProperty('Access-Control-Allow-Origin')
    expect(h['Vary']).toBe('Origin')
  })
})
