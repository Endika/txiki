import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaptchaError, InvalidTargetError, InvalidUrlError, NetworkError } from '@/api/port'
import { t } from '@/i18n'
import { loadLinks } from '@/storage'
import { $, CLIENT, mount, newFake, settle, type, type Harness } from './helpers'

let h: Harness

afterEach(async () => {
  h.dispose()
  await settle()
})

async function fillAndSubmit(url = 'https://endika.dev/cv-2026.pdf'): Promise<void> {
  await settle()
  type($(h.root, '#url'), url)
  $<HTMLFormElement>(h.root, 'form').requestSubmit()
  await settle()
}

describe('shell', () => {
  it('shows the logo, nav, language picker and footer links', () => {
    h = mount()
    expect($(h.root, '.logo').textContent).toBe('txiki')
    const nav = [...h.root.querySelectorAll('.nav a')].map((a) => a.textContent)
    expect(nav).toEqual([t('navCreate'), t('navLinks')])
    const options = [...h.root.querySelectorAll('#locale option')].map((o) =>
      o.getAttribute('value'),
    )
    expect(options).toEqual(['es', 'en', 'eu', 'ca', 'gl'])
    const footer = [...h.root.querySelectorAll('.foot nav > *')].map((e) => e.textContent)
    expect(footer).toEqual([t('footHow'), t('footPrivacy'), t('footCode')])
    expect($(h.root, '.foot a[rel]').getAttribute('href')).toBe('https://github.com/Endika/txiki')
  })

  it('opens and closes the explanation from the footer', () => {
    h = mount()
    const how = $(h.root, '#how')
    expect(how.hidden).toBe(true)
    $<HTMLButtonElement>(h.root, '.foot button').click()
    expect($(h.root, '#how').hidden).toBe(false)
  })

  it('remembers the language and redraws the page in it', () => {
    h = mount()
    const picker = $<HTMLSelectElement>(h.root, '#locale')
    picker.value = 'en'
    picker.dispatchEvent(new Event('change'))
    expect(localStorage.getItem('txiki.locale')).toBe('en')
    expect($(h.root, 'h1').textContent).toBe('Shorten a link')
    expect(document.documentElement.lang).toBe('en')
    h.dispose()
    h = mount({ locale: null })
    expect($(h.root, 'h1').textContent).toBe('Shorten a link')
  })

  it('falls back to the browser language and survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    h = mount({ storage: blocked })
    const picker = $<HTMLSelectElement>(h.root, '#locale')
    picker.value = 'gl'
    picker.dispatchEvent(new Event('change'))
    expect($(h.root, 'h1').textContent).toBe('Acurta unha ligazón')
  })

  it('explains a missing server configuration', () => {
    h = mount({ api: null })
    expect($(h.root, '[role=alert]').textContent).toBe(t('errConfig'))
  })

  it('refuses to run inside a frame', () => {
    h = mount({ framed: true })
    expect($(h.root, 'h1').textContent).toBe(t('framedTitle'))
    expect(h.root.querySelector('form')).toBeNull()
  })
})

describe('create view', () => {
  it('renders the widget once and starts with the location option off', async () => {
    h = mount()
    await settle()
    expect(h.turnstile).toHaveBeenCalledTimes(1)
    expect(h.turnstile.mock.calls[0]![0]).toBe(h.root.querySelector('.ts'))
    expect($<HTMLInputElement>(h.root, '#ask-location').checked).toBe(false)
  })

  it('shows the links without the scheme, copies the full URL, and saves the link', async () => {
    h = mount()
    await settle()
    $<HTMLInputElement>(h.root, '#ask-location').click()
    await fillAndSubmit()
    const short = $<HTMLInputElement>(h.root, '#short-link').value
    const key = $<HTMLInputElement>(h.root, '#stats-link').value
    expect(short).toMatch(/^localhost:?\d*\/txiki\/#[0-9A-Za-z]{7}$/)
    const code = short.slice(-7)
    expect(key).toMatch(new RegExp(`/txiki/#s/${code}\\.[A-Za-z0-9_-]{43}$`))
    expect(key).not.toMatch(/^https?:/)
    const fallbacks = [...h.root.querySelectorAll<HTMLInputElement>('input.sr')]
    expect(fallbacks.map((i) => i.value)).toEqual([`http://${short}`, `http://${key}`])
    for (const input of fallbacks) {
      expect(input.tabIndex).toBe(-1)
      expect(input.getAttribute('aria-label')).toBeTruthy()
      expect(input.getAttribute('aria-hidden')).toBeNull()
    }
    const [saved] = loadLinks(h.storage)
    expect(saved).toMatchObject({ code, target: 'https://endika.dev/cv-2026.pdf' })
    expect(key.endsWith(saved!.token)).toBe(true)
    expect(h.fake.links().get(code)?.askLocation).toBe(true)
    expect(h.root.querySelector('.note.strong')).toBeNull()
    expect($(h.root, '.note').textContent).toContain(t('keyNoteStrong'))
    expect($(h.root, 'a.btn').getAttribute('href')).toBe(`#s/${code}.${saved!.token}`)
    expect(h.widgets[0]!.remove).toHaveBeenCalled()
  })

  it('moves focus to the heading after creating and after “Acortar otro”', async () => {
    h = mount()
    await fillAndSubmit()
    expect(document.activeElement).toBe($(h.root, 'h1'))
    ;($(h.root, 'h1') as HTMLElement).blur()
    $<HTMLButtonElement>(h.root, 'button.btn.sec').click()
    expect(document.activeElement).toBe($(h.root, 'h1'))
  })

  it('adds https:// to a bare host and keeps paths', async () => {
    h = mount()
    await fillAndSubmit('endika.dev/cv 2026'.replace(' ', '-'))
    const [saved] = loadLinks(h.storage)
    expect(saved!.target).toBe('https://endika.dev/cv-2026')
  })

  it('rejects bad URLs on the client without spending the captcha token', async () => {
    h = mount()
    const create = vi.spyOn(h.fake, 'create')
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://example.com',
      'two words',
      'nodots',
      'https://a:b@example.com',
    ]) {
      await fillAndSubmit(bad)
      expect($(h.root, '.error').textContent, bad).toBe(t('errInvalidUrl'))
      expect($(h.root, '#url').getAttribute('aria-invalid')).toBe('true')
    }
    expect(create).not.toHaveBeenCalled()
    expect(h.widgets[0]!.reset).not.toHaveBeenCalled()
  })

  it('warns loudly when the browser cannot save the link', async () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    h = mount({ storage: blocked })
    await fillAndSubmit()
    expect($(h.root, '#stats-link')).toBeTruthy()
    expect($(h.root, '.note.strong').textContent).toContain(t('notSavedStrong'))
    expect($(h.root, '.note.strong').getAttribute('role')).toBe('alert')
  })

  it('shows a captcha message and resets the same widget after CaptchaError', async () => {
    h = mount()
    await settle()
    h.fake.failNext(new CaptchaError())
    await fillAndSubmit()
    expect($(h.root, '.error').textContent).toBe(t('errCaptcha'))
    expect(h.turnstile).toHaveBeenCalledTimes(1)
    expect(h.widgets[0]!.reset).toHaveBeenCalledTimes(1)
    expect($<HTMLInputElement>(h.root, '#url').value).toBe('https://endika.dev/cv-2026.pdf')
    await settle()
    $<HTMLFormElement>(h.root, 'form').requestSubmit()
    await settle()
    expect(h.root.querySelector('#short-link')).not.toBeNull()
  })

  it('keeps the widget when the server says the URL is invalid', async () => {
    h = mount()
    await settle()
    h.fake.failNext(new InvalidUrlError())
    await fillAndSubmit()
    expect($(h.root, '.error').textContent).toBe(t('errInvalidUrl'))
    expect(h.widgets[0]!.reset).not.toHaveBeenCalled()
    $<HTMLFormElement>(h.root, 'form').requestSubmit()
    await settle()
    expect(h.root.querySelector('#short-link')).not.toBeNull()
  })

  it('shows the network error and allows another try', async () => {
    h = mount()
    await settle()
    h.fake.failNext(new NetworkError())
    await fillAndSubmit()
    expect($(h.root, '.error').textContent).toBe(t('errNetwork'))
    expect(h.root.querySelector('button[type=submit]')).toHaveProperty('disabled', false)
  })

  it('asks to wait when the captcha has not finished', async () => {
    h = mount({ turnstile: () => ({ reset: () => {}, remove: () => {} }) })
    await fillAndSubmit()
    expect($(h.root, '.error').textContent).toBe(t('errCaptchaPending'))
    expect(h.fake.links().size).toBe(0)
  })

  it('forgets an expired token and resets the widget', async () => {
    h = mount()
    await settle()
    h.widgets[0]!.callbacks.onExpired()
    expect(h.widgets[0]!.reset).toHaveBeenCalledTimes(1)
    await settle()
    h.widgets[0]!.reset.mockImplementation(() => {})
    h.widgets[0]!.callbacks.onExpired()
    await fillAndSubmit()
    expect($(h.root, '.error').textContent).toBe(t('errCaptchaPending'))
  })

  it('offers a retry when the captcha fails and recovers on reset', async () => {
    h = mount()
    await settle()
    h.widgets[0]!.callbacks.onError()
    expect($(h.root, '.error').textContent).toBe(t('errCaptchaLoad'))
    const retry = $<HTMLButtonElement>(h.root, '#captcha-retry')
    expect(retry.hidden).toBe(false)
    retry.click()
    expect(h.widgets[0]!.reset).toHaveBeenCalledTimes(1)
    await settle()
    expect($(h.root, '#captcha-retry').hidden).toBe(true)
    expect($(h.root, '.error').textContent).toBe('')
  })

  it('removes the widget when the view goes away', async () => {
    h = mount()
    await settle()
    window.location.hash = '#/privacy'
    await vi.waitFor(() => expect(h.widgets[0]!.remove).toHaveBeenCalled())
  })

  it('goes back to an empty form with a fresh widget with “Acortar otro”', async () => {
    h = mount()
    await fillAndSubmit()
    $<HTMLButtonElement>(h.root, 'button.btn.sec').click()
    await settle()
    expect($<HTMLInputElement>(h.root, '#url').value).toBe('')
    expect(h.turnstile).toHaveBeenCalledTimes(2)
  })
})

describe('go view', () => {
  async function start(
    askLocation: boolean,
    options: Parameters<typeof mount>[0] = {},
    target = 'https://ñandú.es/a?b=1#c',
  ): Promise<string> {
    const fake = newFake()
    const { code } = await fake.create(target, askLocation, 'token')
    h = mount({ ...options, hash: `#${code}`, fake })
    await settle()
    return code
  }

  it('redirects straight to the exact destination without asking', async () => {
    await start(false)
    expect(h.redirect).toHaveBeenCalledTimes(1)
    expect(h.redirect).toHaveBeenCalledWith('https://xn--and-6ma2c.es/a?b=1#c')
    expect(h.root.querySelector('main')?.hidden).toBe(true)
  })

  it('sends language, time zone and referrer with the click', async () => {
    const fake = newFake()
    const click = vi.spyOn(fake, 'click')
    const { code } = await fake.create('https://example.com/', false, 'token')
    h = mount({ hash: `#${code}`, fake })
    await settle()
    expect(click).toHaveBeenCalledWith(code, {
      lang: CLIENT.lang,
      tz: CLIENT.tz,
      referrer: CLIENT.referrer,
      bot: false,
    })
  })

  it('sends the real referrer when the page has one', async () => {
    const fake = newFake()
    const click = vi.spyOn(fake, 'click')
    const { code } = await fake.create('https://example.com/', false, 'token')
    h = mount({
      hash: `#${code}`,
      fake,
      client: { referrer: 'https://linkedin.com/feed/' },
    })
    await settle()
    expect(click.mock.calls[0]![1].referrer).toBe('https://linkedin.com/feed/')
  })

  it('shows nothing, not even the header and footer, while the click is pending', async () => {
    let finish: (value: null) => void = () => {}
    const api = {
      ...newFake(),
      click: () => new Promise<null>((resolve) => (finish = resolve)),
    }
    h = mount({ hash: '#Zz9Zz9Z', api })
    await settle()
    for (const selector of ['.top', 'main', '.foot']) {
      expect($(h.root, selector).hidden, selector).toBe(true)
    }
    finish(null)
    await settle()
    for (const selector of ['.top', 'main', '.foot']) {
      expect($(h.root, selector).hidden, selector).toBe(false)
    }
  })

  it('keeps the page blank once it has redirected', async () => {
    await start(false)
    expect($(h.root, '.top').hidden).toBe(true)
    expect($(h.root, '.foot').hidden).toBe(true)
  })

  it('opens “Qué se guarda” inline without leaving the screen', async () => {
    const geolocation = { getCurrentPosition: vi.fn() }
    await start(true, { geolocation })
    const more = $<HTMLButtonElement>(h.root, '.fine button')
    expect($(h.root, '#loc-privacy').hidden).toBe(true)
    more.click()
    expect($(h.root, '#loc-privacy').hidden).toBe(false)
    expect($(h.root, '#loc-privacy').textContent).toContain(t('privacyClickVisitor'))
    expect($(h.root, '#loc-privacy a').getAttribute('href')).toBe('#/privacy')
    expect($(h.root, '.fine button').getAttribute('aria-expanded')).toBe('true')
    expect($(h.root, 'h1').textContent).toBe(t('locTitle'))
    expect(h.redirect).not.toHaveBeenCalled()
  })

  it('never records the same click twice in one page session', async () => {
    const fake = newFake()
    const click = vi.spyOn(fake, 'click')
    const { code } = await fake.create('https://example.com/', true, 'token')
    const geolocation = { getCurrentPosition: vi.fn() }
    h = mount({ hash: `#${code}`, fake, geolocation })
    await settle()
    expect($(h.root, 'h1').textContent).toBe(t('locTitle'))
    window.location.hash = '#/privacy'
    await vi.waitFor(() => expect($(h.root, 'h1').textContent).toBe(t('privacyTitle')))
    window.location.hash = `#${code}`
    await vi.waitFor(() => expect($(h.root, 'h1').textContent).toBe(t('locTitle')))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('does not cache failures, so a retry asks again', async () => {
    const fake = newFake()
    const click = vi.spyOn(fake, 'click')
    const { code } = await fake.create('https://example.com/', false, 'token')
    fake.failNext(new NetworkError())
    h = mount({ hash: `#${code}`, fake })
    await settle()
    $<HTMLButtonElement>(h.root, 'button.btn').click()
    await settle()
    expect(click).toHaveBeenCalledTimes(2)
    expect(h.redirect).toHaveBeenCalledTimes(1)
  })

  it('says so when the saved destination is not a web address', async () => {
    const api = {
      ...newFake(),
      click: () => Promise.reject(new InvalidTargetError()),
    }
    h = mount({ hash: '#Zz9Zz9Z', api })
    await settle()
    expect($(h.root, 'h1').textContent).toBe(t('goInvalidTitle'))
    expect(h.root.querySelector('button.btn')).toBeNull()
    expect(h.redirect).not.toHaveBeenCalled()
  })

  it('trims junk after the code', async () => {
    const fake = newFake()
    const { code } = await fake.create('https://example.com/', false, 'token')
    for (const junk of ['/', '%20', '?utm=1']) {
      h = mount({ hash: `#${code}${junk}`, fake })
      await settle()
      expect(h.redirect).toHaveBeenCalledWith('https://example.com/')
      h.dispose()
    }
    h = mount()
  })

  it('asks for the location and redirects anyway when the browser refuses', async () => {
    const geolocation = {
      getCurrentPosition: vi.fn((_ok: PositionCallback, fail?: PositionErrorCallback | null) =>
        fail?.({ code: 1 } as GeolocationPositionError),
      ),
    }
    await start(true, { geolocation })
    expect($(h.root, 'h1').textContent).toBe(t('locTitle'))
    expect(h.redirect).not.toHaveBeenCalled()
    expect($(h.root, '.dest b').textContent).toBe('xn--and-6ma2c.es/a?b=1')
    expect($(h.root, '.fine button').textContent).toBe(t('locWhatSaved'))
    const add = vi.spyOn(h.fake, 'addLocation')
    $<HTMLButtonElement>(h.root, 'button.btn').click()
    await settle()
    expect(add).not.toHaveBeenCalled()
    expect(h.redirect).toHaveBeenCalledWith('https://xn--and-6ma2c.es/a?b=1#c')
  })

  it('stores the exact coordinates and then redirects when the visitor accepts', async () => {
    const geolocation = {
      getCurrentPosition: vi.fn(
        (ok: PositionCallback, _fail?: PositionErrorCallback | null, _options?: PositionOptions) =>
          ok({ coords: { latitude: 40.41678, longitude: -3.70379 } } as GeolocationPosition),
      ),
    }
    await start(true, { geolocation })
    const add = vi.spyOn(h.fake, 'addLocation')
    $<HTMLButtonElement>(h.root, 'button.btn').click()
    await settle()
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith(
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      40.41678,
      -3.70379,
    )
    expect(h.redirect).toHaveBeenCalledTimes(1)
    expect(geolocation.getCurrentPosition.mock.calls[0]![2]).toMatchObject({ timeout: 10_000 })
  })

  it.each([true, false])('sends bot=%s from the webdriver flag', async (webdriver) => {
    const fake = newFake()
    const click = vi.spyOn(fake, 'click')
    const { code } = await fake.create('https://example.com/', false, 'token')
    h = mount({ hash: `#${code}`, fake, webdriver })
    await settle()
    expect(click.mock.calls[0]![1]).toMatchObject({ bot: webdriver })
  })

  it('lets the visitor continue without sharing', async () => {
    const geolocation = { getCurrentPosition: vi.fn() }
    await start(true, { geolocation })
    $<HTMLButtonElement>(h.root, 'button.btn.sec').click()
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled()
    expect(h.redirect).toHaveBeenCalledTimes(1)
  })

  it('redirects without asking when the browser has no geolocation', async () => {
    await start(true, { geolocation: null })
    expect(h.redirect).toHaveBeenCalledTimes(1)
  })

  it('shows the not-found screen without redirecting', async () => {
    h = mount({ hash: '#Zz9Zz9Z' })
    await settle()
    expect($(h.root, 'h1').textContent).toBe(t('goneTitle'))
    expect(h.redirect).not.toHaveBeenCalled()
    expect($(h.root, 'a.btn').getAttribute('href')).toBe('#/')
  })

  it('offers a retry after a network error', async () => {
    const fake = newFake()
    const { code } = await fake.create('https://example.com/', false, 'token')
    fake.failNext(new NetworkError())
    h = mount({ hash: `#${code}`, fake })
    await settle()
    expect($(h.root, 'h1').textContent).toBe(t('goErrTitle'))
    expect(h.redirect).not.toHaveBeenCalled()
    $<HTMLButtonElement>(h.root, 'button.btn').click()
    await settle()
    expect(h.redirect).toHaveBeenCalledWith('https://example.com/')
  })

  it('does not redirect after the visitor navigated away', async () => {
    const fake = newFake()
    const { code } = await fake.create('https://example.com/', false, 'token')
    h = mount({ hash: `#${code}`, fake })
    h.dispose()
    await settle()
    expect(h.redirect).not.toHaveBeenCalled()
  })
})
