export type Browser =
  | 'Chrome'
  | 'Safari'
  | 'Firefox'
  | 'Edge'
  | 'Samsung Internet'
  | 'Opera'
  | 'Instagram'
  | 'Facebook'
  | 'Other'
export type Os = 'Android' | 'iOS' | 'iPadOS' | 'Windows' | 'macOS' | 'Linux' | 'ChromeOS' | 'Other'
export type Device = 'mobile' | 'tablet' | 'desktop'

const BROWSERS: [RegExp, Browser][] = [
  [/Instagram/, 'Instagram'],
  [/FBAN|FBAV|FB_IAB/, 'Facebook'],
  [/EdgA?\/|EdgiOS\/|Edge\//, 'Edge'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/OPR\/|Opera|OPT\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const OSES: [RegExp, Os][] = [
  [/iPad/, 'iPadOS'],
  [/iPhone|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux|X11/, 'Linux'],
]

const BOT_UA =
  /HeadlessChrome|(?<!cu)bot\b|crawler|spider|Lighthouse|PhantomJS|facebookexternalhit|^WhatsApp\/|TelegramBot|Slackbot|Discordbot|Twitterbot|LinkedInBot|SkypeUriPreview|Google-InspectionTool|GoogleOther/i

export function isBot(ua: string | null, webdriver: boolean): boolean {
  return webdriver || BOT_UA.test(ua ?? '')
}

export function parseUserAgent(ua: string | null): { browser: Browser; os: Os; device: Device } {
  const s = ua ?? ''
  const browser = BROWSERS.find(([re]) => re.test(s))?.[1] ?? 'Other'
  const os = OSES.find(([re]) => re.test(s))?.[1] ?? 'Other'
  let device: Device = 'desktop'
  if (os === 'iPadOS') device = 'tablet'
  else if (os === 'iOS') device = 'mobile'
  else if (os === 'Android') device = /Mobile/.test(s) ? 'mobile' : 'tablet'
  return { browser, os, device }
}
