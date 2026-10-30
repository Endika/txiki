import { isBot, parseUserAgent } from '../../supabase/functions/_shared/ua.ts'

const UA = {
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36',
  chromeAndroidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  safariIpad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  safariIpadAsMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0',
  instagramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 345.0.1.14.109 (iPhone15,2; iOS 17_5; es_ES; es; scale=3.00; 1170x2532; 612304432)',
  facebookAndroid:
    'Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.40.109;]',
  facebookIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.109;FBBV/600000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBLC/es_ES;FBOP/5]',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  chromeos:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  firefoxIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
}

describe('parseUserAgent', () => {
  it.each([
    ['chromeAndroid', 'Chrome', 'Android', 'mobile'],
    ['chromeAndroidTablet', 'Chrome', 'Android', 'tablet'],
    ['safariIphone', 'Safari', 'iOS', 'mobile'],
    ['safariIpad', 'Safari', 'iPadOS', 'tablet'],
    // iPadOS 13+ sends a Mac UA; without maxTouchPoints it is indistinguishable from a Mac
    ['safariIpadAsMac', 'Safari', 'macOS', 'desktop'],
    ['edgeWindows', 'Edge', 'Windows', 'desktop'],
    ['samsung', 'Samsung Internet', 'Android', 'mobile'],
    ['operaWindows', 'Opera', 'Windows', 'desktop'],
    ['instagramIos', 'Instagram', 'iOS', 'mobile'],
    ['facebookAndroid', 'Facebook', 'Android', 'mobile'],
    ['facebookIos', 'Facebook', 'iOS', 'mobile'],
    ['firefoxLinux', 'Firefox', 'Linux', 'desktop'],
    ['chromeos', 'Chrome', 'ChromeOS', 'desktop'],
    ['chromeMac', 'Chrome', 'macOS', 'desktop'],
    ['chromeIos', 'Chrome', 'iOS', 'mobile'],
    ['firefoxIos', 'Firefox', 'iOS', 'mobile'],
  ] as const)('%s', (key, browser, os, device) => {
    expect(parseUserAgent(UA[key])).toEqual({ browser, os, device })
  })

  it('returns Other/Other/desktop for null, empty and unknown agents', () => {
    const other = { browser: 'Other', os: 'Other', device: 'desktop' }
    expect(parseUserAgent(null)).toEqual(other)
    expect(parseUserAgent('')).toEqual(other)
    expect(parseUserAgent('curl/8.5.0')).toEqual(other)
  })
})

const BOTS = {
  headless:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
  googlebot:
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  whatsapp: 'WhatsApp/2.23.20.0 A',
  whatsappIos: 'WhatsApp/2.23.20.76 i',
  telegram: 'TelegramBot (like TwitterBot)',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  twitter: 'Twitterbot/1.0',
  linkedin: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  lighthouse:
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  googleOther: 'Mozilla/5.0 (compatible; GoogleOther)',
  inspection: 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)',
  crawler: 'Mozilla/5.0 (compatible; ExampleCrawler/1.0)',
}

describe('isBot', () => {
  it.each(Object.keys(BOTS) as (keyof typeof BOTS)[])('flags %s', (key) => {
    expect(isBot(BOTS[key], false)).toBe(true)
  })

  it.each(Object.keys(UA) as (keyof typeof UA)[])('does not flag %s', (key) => {
    expect(isBot(UA[key], false)).toBe(false)
  })

  it('does not flag a phone whose model ends in bot', () => {
    const cubot =
      'Mozilla/5.0 (Linux; Android 13; Cubot X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    expect(isBot(cubot, false)).toBe(false)
  })

  it('does not flag a WhatsApp token inside a browser user agent', () => {
    const inApp =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.10.80'
    expect(isBot(inApp, false)).toBe(false)
  })

  it('flags webdriver whatever the user agent says', () => {
    expect(isBot(UA.chromeMac, true)).toBe(true)
    expect(isBot(null, true)).toBe(true)
  })

  it('does not flag a missing user agent on its own', () => {
    expect(isBot(null, false)).toBe(false)
    expect(isBot('', false)).toBe(false)
  })
})
