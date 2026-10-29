import { parseUserAgent } from '../../supabase/functions/_shared/ua.ts'

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
