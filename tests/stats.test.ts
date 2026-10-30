import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkError, type Stats, type TxikiApi } from '@/api'
import { localDay } from '@/format'
import { icon } from '@/dom'
import { t } from '@/i18n'
import { loadLinks, saveLink } from '@/storage'
import { $, NOW, emptyStats, mount, newFake, settle, type Harness } from './helpers'

let h: Harness

afterEach(async () => {
  h.dispose()
  await settle()
})

const CODE = 'k3F9aQ2'
const TOKEN = 'Z'.repeat(43)
const HASH = `#s/${CODE}.${TOKEN}`

function serving(stats: Stats | null): TxikiApi {
  return { ...newFake(), stats: async () => stats }
}

function hoursAgo(n: number): string {
  return new Date(NOW - n * 3600_000).toISOString()
}

function busy(): Stats {
  const byHour = new Array<number>(24).fill(0)
  byHour[9] = 2
  byHour[16] = 4
  const at = hoursAgo(2)
  return emptyStats({
    askLocation: true,
    total: 12,
    uniques: 9,
    firstAt: hoursAgo(90),
    lastAt: at,
    byDay: [
      { day: localDay(NOW), count: 4 },
      { day: localDay(NOW - 3 * 86400_000), count: 8 },
    ],
    byHour,
    countries: [
      { key: 'ES', count: 9 },
      { key: 'FR', count: 2 },
      { key: null, count: 1 },
    ],
    browsers: [
      { key: 'Safari', count: 6 },
      { key: 'Chrome', count: 5 },
      { key: '__other__', count: 1 },
    ],
    os: [{ key: 'iOS', count: 7 }],
    devices: [
      { key: 'mobile', count: 8 },
      { key: 'desktop', count: 4 },
    ],
    referrers: [
      { key: null, count: 7 },
      { key: 'linkedin.com', count: 5 },
    ],
    langs: [{ key: 'es-ES', count: 12 }],
    recent: [
      { at, country: 'ES', browser: 'Safari', os: 'iOS', device: 'mobile', referrerHost: null },
      {
        at: hoursAgo(5),
        country: 'FR',
        browser: 'Chrome',
        os: 'Windows',
        device: 'desktop',
        referrerHost: 'linkedin.com',
      },
    ],
    points: [{ lat: 40.41678, lon: -3.70379, at }],
  })
}

describe('stats view', () => {
  it('imports an unknown link into Mis links once the key works', async () => {
    const fake = newFake()
    const { code, token } = await fake.create('https://example.com/a?b=1', false, 'tok')
    h = mount({ hash: `#s/${code}.${token}`, fake })
    expect(loadLinks(h.storage)).toEqual([])
    await settle()
    expect(loadLinks(h.storage)).toEqual([
      { code, token, target: 'https://example.com/a?b=1', createdAt: new Date(NOW).toISOString() },
    ])
    expect($(h.root, '.code').textContent).toBe(code)
    expect($(h.root, '.to').textContent).toContain('example.com/a?b=1')
  })

  it.each([
    [1, 'Una visita de bot, no contada.'],
    [3, '3 visitas de bots, no contadas.'],
  ])('says so when %i bot visits were left out', async (bots, text) => {
    h = mount({ hash: HASH, api: serving(emptyStats({ bots })) })
    await settle()
    expect(h.root.textContent).toContain(text)
  })

  it('shows no bot line without bot visits', async () => {
    h = mount({ hash: HASH, api: serving(emptyStats({ bots: 0 })) })
    await settle()
    expect(h.root.textContent).not.toContain('bot')
  })

  it('does not import a link whose key is wrong', async () => {
    h = mount({ hash: HASH, api: serving(null) })
    await settle()
    expect(loadLinks(h.storage)).toEqual([])
  })

  it('shows the answer sentence, plural, with the last click', async () => {
    h = mount({ hash: HASH, api: serving(busy()) })
    await settle()
    const answer = $(h.root, '.answer').textContent!
    expect(answer).toContain('Lo han abierto 12 veces, 9 personas.')
    expect(answer).toContain('La última, hace 2 h, desde España en un móvil.')
    expect($(h.root, '.answer em').textContent).toBe('9 personas.')
  })

  it('uses the singular for one click and one person', async () => {
    const stats = emptyStats({ total: 1, uniques: 1, lastAt: hoursAgo(1), recent: [] })
    h = mount({ hash: HASH, api: serving(stats) })
    await settle()
    expect($(h.root, '.answer').textContent).toContain('Lo han abierto una vez, una persona.')
    expect($(h.root, '.answer').textContent).toContain('La última, hace 1 h.')
  })

  it('handles more clicks than people and thousands of clicks', async () => {
    const stats = emptyStats({ total: 1500, uniques: 1, lastAt: hoursAgo(1) })
    h = mount({ hash: HASH, api: serving(stats) })
    await settle()
    expect($(h.root, '.answer').textContent).toMatch(/Lo han abierto 1\.?500 veces, una persona\./)
  })

  it('has a calm state for zero clicks and no empty charts', async () => {
    h = mount({ hash: HASH, api: serving(emptyStats()) })
    await settle()
    expect($(h.root, '.answer').textContent).toBe(t('answerNone'))
    expect(h.root.textContent).toContain(t('answerNoneSub'))
    expect(h.root.querySelector('.blk')).toBeNull()
    expect($(h.root, '.foot-row button').textContent).toBe(t('deleteLink'))
  })

  it('draws 14 days with the empty ones in grey and 24 hours', async () => {
    h = mount({ hash: HASH, api: serving(busy()) })
    await settle()
    const days = $(h.root, 'svg.days')
    expect(days.querySelectorAll('rect')).toHaveLength(14)
    expect(days.querySelectorAll('rect.on')).toHaveLength(2)
    expect(days.querySelectorAll('rect.z')).toHaveLength(12)
    expect($(h.root, 'svg.hours').querySelectorAll('rect')).toHaveLength(24)
    for (const svg of h.root.querySelectorAll('svg.cols')) {
      expect(svg.getAttribute('role')).toBe('img')
      expect(svg.getAttribute('aria-label')).toBeTruthy()
    }
  })

  it('names the blocks as the design does, in order', async () => {
    h = mount({ hash: HASH, api: serving(busy()) })
    await settle()
    const titles = [...h.root.querySelectorAll('.blk h2')].map((e) => e.firstChild!.textContent)
    expect(titles).toEqual([
      'Por día',
      'A qué hora',
      'Desde dónde',
      'Mapa',
      'Con qué',
      'Desde qué web',
      'Últimos clics',
    ])
  })

  it('names countries, shows “Directo” for no referrer and “Otros” for __other__', async () => {
    h = mount({ hash: HASH, api: serving(busy()) })
    await settle()
    const blocks = [...h.root.querySelectorAll('.blk')]
    const names = (i: number) => [...blocks[i]!.querySelectorAll('.name')].map((e) => e.textContent)
    expect(names(2)).toEqual(['España', 'Francia', 'Desconocido'])
    expect(names(4)).toEqual(['Safari', 'Chrome', 'Otros'])
    expect(names(5)).toEqual(['Directo', 'linkedin.com'])
    expect(blocks[4]!.textContent).toContain('Dispositivos: Móvil 8 · Ordenador 4')
  })

  it('lists the latest clicks with a map link only where a location was shared', async () => {
    h = mount({ hash: HASH, api: serving(busy()) })
    await settle()
    const rows = [...h.root.querySelectorAll('.feed li')]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('España · Móvil · Safari · ubicación: ver en mapa')
    expect(rows[1]!.textContent).toContain('Francia · Ordenador · Chrome · desde linkedin.com')
    const link = $<HTMLAnchorElement>(rows[0]!, 'a')
    expect(link.getAttribute('href')).toBe(
      'https://www.openstreetmap.org/?mlat=40.42&mlon=-3.70#map=13/40.42/-3.70',
    )
    expect(link.rel).toContain('noopener')
    expect(link.rel).toContain('noreferrer')
    expect(rows[1]!.querySelector('a')).toBeNull()
  })

  it('does not drop shared locations older than the latest 50 clicks', async () => {
    const stats = busy()
    stats.points.push({ lat: 41.38, lon: 2.17, at: '2026-01-01T10:00:00.000Z' })
    h = mount({ hash: HASH, api: serving(stats) })
    await settle()
    const places = [...h.root.querySelectorAll('.blk')].at(-1)!
    expect(places.querySelector('h2')!.textContent).toBe(t('blockPlaces'))
    expect(places.querySelector('a')!.textContent).toBe('41.38, 2.17')
  })

  it('shows a band for a disabled link and a tag for one that asks for location', async () => {
    h = mount({ hash: HASH, api: serving({ ...busy(), disabled: true }) })
    await settle()
    expect($(h.root, '.band').textContent).toBe(t('disabledBand'))
    expect($(h.root, '.tag').textContent).toBe(t('statsAsksLocation'))
  })

  it('says the link is gone or the key wrong, and removes it from the list', async () => {
    h = mount({ hash: HASH, api: serving(null) })
    saveLink(h.storage, { code: CODE, token: TOKEN, target: 'https://x.es', createdAt: 'now' })
    await settle()
    expect($(h.root, 'h1').textContent).toBe(t('statsGoneTitle'))
    $<HTMLButtonElement>(h.root, 'button.btn').click()
    expect(loadLinks(h.storage)).toEqual([])
    expect(window.location.hash).toBe('#/links')
  })

  it('offers a retry on network errors', async () => {
    const fake = newFake()
    const { code, token } = await fake.create('https://example.com/', false, 'tok')
    fake.failNext(new NetworkError())
    h = mount({ hash: `#s/${code}.${token}`, fake })
    await settle()
    expect($(h.root, '.banner').textContent).toBe(t('errNetwork'))
    $<HTMLButtonElement>(h.root, 'button.btn').click()
    await settle()
    expect($(h.root, '.code').textContent).toBe(code)
  })

  it('deletes the link after confirmation and returns to Mis links', async () => {
    const fake = newFake()
    const { code, token } = await fake.create('https://example.com/', false, 'tok')
    h = mount({ hash: `#s/${code}.${token}`, fake })
    await settle()
    expect(loadLinks(h.storage)).toHaveLength(1)
    $<HTMLButtonElement>(h.root, '.foot-row button').click()
    await settle()
    expect(h.confirm).toHaveBeenCalledWith(t('deleteConfirm'))
    expect(fake.links().size).toBe(0)
    expect(loadLinks(h.storage)).toEqual([])
    expect(window.location.hash).toBe('#/links')
  })

  it('keeps the link when the deletion is not confirmed', async () => {
    const fake = newFake()
    const { code, token } = await fake.create('https://example.com/', false, 'tok')
    h = mount({ hash: `#s/${code}.${token}`, fake, confirm: false })
    await settle()
    $<HTMLButtonElement>(h.root, '.foot-row button').click()
    await settle()
    expect(fake.links().size).toBe(1)
    expect(loadLinks(h.storage)).toHaveLength(1)
  })

  it('tells the owner when the deletion failed and keeps the link', async () => {
    const fake = newFake()
    const { code, token } = await fake.create('https://example.com/', false, 'tok')
    h = mount({ hash: `#s/${code}.${token}`, fake })
    await settle()
    fake.failNext(new NetworkError())
    $<HTMLButtonElement>(h.root, '.foot-row button').click()
    await settle()
    expect($(h.root, '.error').textContent).toBe(t('errDelete'))
    expect(fake.links().size).toBe(1)
    expect(loadLinks(h.storage)).toHaveLength(1)
  })

  it('renders in Basque without throwing, with country names in Basque', async () => {
    h = mount({ hash: HASH, api: serving(busy()), locale: 'eu' })
    await settle()
    expect(h.root.textContent).toContain('Espainia')
    expect($(h.root, '.answer').textContent).toContain('12 aldiz ireki dute, 9 pertsonak.')
  })

  it('redraws in another language without fetching again', async () => {
    const api = serving(busy())
    const spy = vi.spyOn(api, 'stats')
    h = mount({ hash: HASH, api })
    await settle()
    const picker = $<HTMLSelectElement>(h.root, '#locale')
    picker.value = 'en'
    picker.dispatchEvent(new Event('change'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect($(h.root, '.answer').textContent).toContain('It has been opened 12 times, by 9 people.')
  })
})

describe('stats view details', () => {
  it('makes the code the heading and focuses it', async () => {
    h = mount({ hash: HASH, api: serving(busy()) })
    await settle()
    const heading = $(h.root, 'h1')
    expect(heading.textContent).toContain(CODE)
    expect(heading.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(heading)
  })

  it('keeps the copy fallbacks out of the tab order and labelled', async () => {
    h = mount({ hash: HASH, api: serving(busy()) })
    await settle()
    const inputs = [...h.root.querySelectorAll<HTMLInputElement>('.actions input.sr')]
    expect(inputs).toHaveLength(2)
    for (const input of inputs) {
      expect(input.tabIndex).toBe(-1)
      expect(input.getAttribute('aria-label')).toBeTruthy()
      expect(input.getAttribute('aria-hidden')).toBeNull()
    }
    expect(inputs[1]!.value.endsWith(`#s/${CODE}.${TOKEN}`)).toBe(true)
  })

  it('marks the key as private and says what each copy is for', async () => {
    h = mount({ hash: HASH, api: serving(busy()) })
    await settle()
    const [linkBtn, keyBtn] = [...h.root.querySelectorAll<HTMLButtonElement>('.actions button')]
    expect(linkBtn!.textContent).toBe('Copiar enlace')
    expect(keyBtn!.textContent).toBe('Copiar llave privada')
    expect(keyBtn!.querySelector('svg')!.outerHTML).toBe(icon('lock').outerHTML)
    expect(linkBtn!.querySelector('svg')!.outerHTML).toBe(icon('copy').outerHTML)
    expect(h.root.textContent).toContain('El enlace corto es para compartir. La llave es privada')
  })

  it('translates the server’s Other, names languages and handles unknown countries', async () => {
    const stats = busy()
    stats.browsers = [
      { key: 'Other', count: 3 },
      { key: 'Safari', count: 1 },
    ]
    stats.os = [{ key: 'Other', count: 4 }]
    stats.langs = [
      { key: 'es-ES', count: 3 },
      { key: null, count: 1 },
    ]
    stats.countries = [{ key: 'XX', count: 1 }]
    stats.recent[0]!.country = 'XX'
    stats.recent[0]!.browser = 'Other'
    h = mount({ hash: HASH, api: serving(stats) })
    await settle()
    const text = h.root.textContent!
    expect(
      [...h.root.querySelectorAll('.blk')[4]!.querySelectorAll('.name')].map((e) => e.textContent),
    ).toEqual(['Otro', 'Safari'])
    expect(text).toContain('Sistemas: Otro 4')
    expect(text).toContain('Idiomas: español de España 3 · Desconocido 1')
    expect(text).not.toContain('XX')
    expect($(h.root, '.answer .last').textContent).toContain('hace 2 h, en un móvil')
    expect([...h.root.querySelectorAll('.feed li')][0]!.textContent).toContain(
      'Desconocido · Móvil · Otro',
    )
  })

  it('follows hash changes to Mis links', async () => {
    h = mount()
    window.location.hash = '#/links'
    await vi.waitFor(() => expect($(h.root, 'h1').textContent).toBe(t('linksEmptyTitle')))
    expect($(h.root, '.nav a[aria-current=page]').textContent).toBe(t('navLinks'))
  })
})

describe('links view', () => {
  it('invites to create the first link', () => {
    h = mount({ hash: '#/links' })
    expect($(h.root, 'h1').textContent).toBe(t('linksEmptyTitle'))
    expect($(h.root, 'a.btn').getAttribute('href')).toBe('#/')
    expect(h.root.textContent).toContain(t('linksNote'))
  })

  it('lists saved links with their clicks and the last one', async () => {
    const fake = newFake()
    const fresh = await fake.create('https://endika.dev/cv-2026.pdf', false, 'tok')
    const quiet = await fake.create('https://eslojusto.es/finiquito', false, 'tok')
    await fake.click(fresh.code, { lang: 'es', tz: 'UTC', referrer: '', bot: false })
    await fake.click(fresh.code, { lang: 'es', tz: 'UTC', referrer: '', bot: false })
    h = mount({ hash: '#/links', fake })
    saveLink(h.storage, { ...quiet, target: 'https://eslojusto.es/finiquito', createdAt: 'x' })
    saveLink(h.storage, { ...fresh, target: 'https://endika.dev/cv-2026.pdf', createdAt: 'x' })
    h.dispose()
    h = mount({ hash: '#/links', fake, storage: h.storage })
    await vi.waitFor(() => expect(h.root.querySelectorAll('.li .n')).toHaveLength(2))
    await settle()
    const rows = [...h.root.querySelectorAll('.li')]
    expect(rows.map((r) => r.querySelector('.code')!.textContent)).toEqual([fresh.code, quiet.code])
    expect(rows[0]!.querySelector('.n')!.textContent).toBe('Clics: 2')
    expect(rows[0]!.querySelector('.host')!.textContent).toBe('endika.dev/cv-2026.pdf')
    expect(rows[0]!.classList.contains('fresh')).toBe(true)
    expect(rows[0]!.getAttribute('href')).toBe(`#s/${fresh.code}.${fresh.token}`)
    expect(rows[1]!.querySelector('.when')!.textContent).toBe(t('noClicks'))
    expect(rows[1]!.classList.contains('fresh')).toBe(false)
  })

  it('marks links that no longer exist and ignores broken entries', async () => {
    h = mount({ hash: '#/links', api: serving(null) })
    h.dispose()
    localStorage.setItem(
      'txiki.links',
      JSON.stringify([
        { code: CODE, token: TOKEN, target: 'https://x.es/', createdAt: 'x' },
        { code: 'bad', token: 1 },
        'junk',
      ]),
    )
    h = mount({ hash: '#/links', api: serving(null), storage: localStorage })
    await settle()
    const rows = h.root.querySelectorAll('.li')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.querySelector('.when')!.textContent).toBe(t('linkUnavailable'))
  })

  it('still renders when the stats of a link cannot be fetched', async () => {
    const api: TxikiApi = {
      ...newFake(),
      stats: async () => {
        throw new NetworkError()
      },
    }
    h = mount({ hash: '#/links', api })
    h.dispose()
    localStorage.setItem(
      'txiki.links',
      JSON.stringify([{ code: CODE, token: TOKEN, target: 'https://x.es/', createdAt: 'x' }]),
    )
    h = mount({ hash: '#/links', api, storage: localStorage })
    await settle()
    expect($(h.root, '.li .when').textContent).toBe(t('linkLoadError'))
  })

  it('survives storage that throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    h = mount({ hash: '#/links', storage: blocked })
    expect($(h.root, 'h1').textContent).toBe(t('linksEmptyTitle'))
  })
})

describe('links view behaviour', () => {
  function seedLinks(count: number): void {
    localStorage.setItem(
      'txiki.links',
      JSON.stringify(
        Array.from({ length: count }, (_, i) => ({
          code: `code${String(i).padStart(3, '0')}`,
          token: TOKEN,
          target: `https://example.com/${i}`,
          createdAt: 'x',
        })),
      ),
    )
  }

  it('never runs more than 4 stats requests at once', async () => {
    seedLinks(11)
    let running = 0
    let peak = 0
    let done = 0
    const api: TxikiApi = {
      ...newFake(),
      stats: async () => {
        running += 1
        peak = Math.max(peak, running)
        await settle()
        running -= 1
        done += 1
        return emptyStats()
      },
    }
    h = mount({ hash: '#/links', api, storage: localStorage })
    await vi.waitFor(() => expect(done).toBe(11))
    expect(peak).toBe(4)
  })

  it('updates rows in place so focus is not lost when stats arrive', async () => {
    seedLinks(2)
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const api: TxikiApi = {
      ...newFake(),
      stats: async () => {
        await gate
        return emptyStats({ total: 5, lastAt: hoursAgo(1) })
      },
    }
    h = mount({ hash: '#/links', api, storage: localStorage })
    const before = [...h.root.querySelectorAll<HTMLElement>('a.li')]
    before[1]!.focus()
    release()
    await settle()
    const after = [...h.root.querySelectorAll<HTMLElement>('a.li')]
    expect(after[1]).toBe(before[1])
    expect(document.activeElement).toBe(before[1])
    expect(after[1]!.querySelector('.n')!.textContent).toContain('5')
  })

  describe('map', () => {
    const titles = () =>
      [...h.root.querySelectorAll('.blk h2')].map((e) => e.firstChild!.textContent)

    it('is absent when there is nothing to draw', async () => {
      const stats = emptyStats({
        total: 3,
        uniques: 2,
        lastAt: hoursAgo(1),
        countries: [{ key: null, count: 3 }],
      })
      h = mount({ hash: HASH, api: serving(stats) })
      await settle()
      expect(titles()).not.toContain('Mapa')
      expect(h.root.querySelector('.map')).toBeNull()
    })

    it('is dropped when no country is on the map and there are no points', async () => {
      const stats = emptyStats({
        total: 3,
        uniques: 2,
        lastAt: hoursAgo(1),
        countries: [{ key: 'XX', count: 3 }],
      })
      h = mount({ hash: HASH, api: serving(stats) })
      await settle()
      expect(titles()).not.toContain('Mapa')
    })

    it('shows countries alone with a legend and no toggle', async () => {
      const stats = emptyStats({
        total: 12,
        uniques: 9,
        lastAt: hoursAgo(1),
        countries: [
          { key: 'ES', count: 8 },
          { key: 'FR', count: 2 },
          { key: '__other__', count: 2 },
        ],
      })
      h = mount({ hash: HASH, api: serving(stats) })
      await settle()
      expect(titles()).toEqual([
        'Por día',
        'A qué hora',
        'Desde dónde',
        'Mapa',
        'Con qué',
        'Desde qué web',
        'Últimos clics',
      ])
      const svg = $(h.root, '.map svg')
      expect(svg.getAttribute('aria-label')).toBe('Clics en 2 países')
      expect(svg.querySelectorAll('path.t4')).toHaveLength(1)
      expect(svg.querySelectorAll('path.t1')).toHaveLength(1)
      expect(h.root.querySelector('.map-pt')).toBeNull()
      expect(h.root.querySelector('.map-foot button')).toBeNull()
      expect($(h.root, '.map-legend').textContent).toContain('Ninguno')
      expect($(h.root, '.map-legend').textContent).toContain('1–2')
    })

    function withPoints(): Stats {
      const stats = busy()
      const at = (n: number) => hoursAgo(n)
      stats.points = [
        { lat: 40.4168, lon: -3.7038, at: at(2) },
        { lat: 40.4201, lon: -3.7001, at: at(30) },
        { lat: 40.4168, lon: -3.7038, at: at(40) },
        { lat: 41.3851, lon: 2.1734, at: at(50) },
        { lat: 19.4326, lon: -99.1332, at: at(60) },
      ]
      return stats
    }

    it('groups points sharing coordinates and summarises them for assistive tech', async () => {
      h = mount({ hash: HASH, api: serving(withPoints()) })
      await settle()
      expect($(h.root, '.map svg').getAttribute('role')).toBe('img')
      expect($(h.root, '.map svg').getAttribute('aria-label')).toBe(
        'Clics en 2 países y en 3 ubicaciones',
      )
      const dots = [...h.root.querySelectorAll<HTMLButtonElement>('.map-pt')]
      expect(dots).toHaveLength(3)
      expect(dots.map((d) => d.textContent)).toContain('3')
      expect(h.root.querySelector('.map svg button')).toBeNull()
      expect(dots.every((d) => d.closest('[role="img"]') === null)).toBe(true)
      expect($(h.root, '.map-foot button').textContent).toBe('Ver el mundo')
    })

    it('toggles between the points and the world', async () => {
      h = mount({ hash: HASH, api: serving(withPoints()) })
      await settle()
      const svg = $(h.root, '.map svg')
      const fitted = svg.getAttribute('viewBox')
      const toggle = $<HTMLButtonElement>(h.root, '.map-foot button')
      toggle.click()
      expect(svg.getAttribute('viewBox')).toBe('-180 -84 360 144')
      expect(toggle.textContent).toBe('Ver los puntos')
      toggle.click()
      expect(svg.getAttribute('viewBox')).toBe(fitted)
    })

    it('opens a popover with the time and an OpenStreetMap link, closes on Escape', async () => {
      h = mount({ hash: HASH, api: serving(withPoints()) })
      await settle()
      const dot = [...h.root.querySelectorAll<HTMLButtonElement>('.map-pt')].find(
        (d) => d.textContent === '3',
      )!
      dot.click()
      const pop = $(h.root, '.map-pop')
      expect(pop.hidden).toBe(false)
      expect(dot.getAttribute('aria-expanded')).toBe('true')
      expect(pop.textContent).toContain('3 clics en esta ubicación')
      const link = $<HTMLAnchorElement>(pop, 'a')
      expect(link.textContent).toBe('Abrir en OpenStreetMap')
      expect(link.href).toBe(
        'https://www.openstreetmap.org/?mlat=40.42&mlon=-3.70#map=13/40.42/-3.70',
      )
      expect(link.target).toBe('_blank')
      expect(link.rel).toBe('noopener noreferrer')
      expect(document.activeElement).toBe(link)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(pop.hidden).toBe(true)
      expect(dot.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(dot)
    })

    it('shows only the time for a single click and closes when clicking outside', async () => {
      h = mount({ hash: HASH, api: serving(withPoints()) })
      await settle()
      const dot = [...h.root.querySelectorAll<HTMLButtonElement>('.map-pt')].find(
        (d) => d.textContent === '',
      )!
      dot.click()
      const pop = $(h.root, '.map-pop')
      expect(pop.textContent).toContain('Ubicación compartida,')
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      expect(pop.hidden).toBe(true)
    })
  })
})
