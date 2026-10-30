import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encode } from 'uqr'
import { shortLink } from '@/route'
import { canvasAvailable } from '@/views/qr'
import { $, mount, newFake, settle, type, type Harness } from './helpers'

let h: Harness

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(async () => {
  vi.restoreAllMocks()
  h.dispose()
  await settle()
})

const base = () => window.location.origin + window.location.pathname

async function openStats() {
  const fake = newFake()
  const { code, token } = await fake.create('https://example.com/', false, 'tok')
  h = mount({ hash: `#s/${code}.${token}`, fake })
  await settle()
  return code
}

function expected(link: string) {
  const { data, size } = encode(link, { ecc: 'M', border: 0 })
  const dark = data.flat().filter(Boolean).length
  return { span: size + 8, dark }
}

function rendered(svg: Element) {
  const d = $(svg as HTMLElement, 'path').getAttribute('d') ?? ''
  return { viewBox: svg.getAttribute('viewBox'), dark: (d.match(/M/g) ?? []).length, d }
}

function matrixFromPath(d: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  for (const [, x, y] of d.matchAll(/M(\d+) (\d+)h/g)) grid[Number(y) - 4]![Number(x) - 4] = true
  return grid
}

function captureDownload() {
  const blobs: Blob[] = []
  const names: string[] = []
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      blobs.push(blob)
      return 'blob:txiki-test'
    },
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download)
  })
  return { blobs, names }
}

describe('QR on the dashboard', () => {
  it('stays closed until the button is pressed, then draws the short link', async () => {
    const code = await openStats()
    const button = $<HTMLButtonElement>(h.root, '.actions button:last-child')
    expect(button.textContent).toBe('Código QR')
    expect(h.root.querySelector('.dash > .qr svg')).toBeNull()
    button.click()
    await settle()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const svg = $(h.root, '.dash > .qr svg')
    const link = shortLink(code, base())
    const want = expected(link)
    const got = rendered(svg)
    expect(got.viewBox).toBe(`0 0 ${want.span} ${want.span}`)
    expect(got.dark).toBe(want.dark)
    expect(matrixFromPath(got.d, want.span - 8)).toEqual(encode(link, { ecc: 'M', border: 0 }).data)
    expect(svg.getAttribute('aria-label')).toBe(`Código QR de ${link}`)
    button.click()
    expect($(h.root, '.dash > .qr').hidden).toBe(true)
  })

  it('downloads the SVG as a blob with the right name', async () => {
    const code = await openStats()
    const { blobs, names } = captureDownload()
    $<HTMLButtonElement>(h.root, '.actions button:last-child').click()
    await settle()
    const [save] = [...h.root.querySelectorAll<HTMLButtonElement>('.dash > .qr .qr-actions button')]
    save!.click()
    expect(names).toEqual([`txiki-${code}.svg`])
    expect(blobs[0]!.type).toBe('image/svg+xml')
    const text = await blobs[0]!.text()
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(text).toContain('width="')
  })

  it('hides the PNG button when there is no canvas', async () => {
    expect(canvasAvailable()).toBe(false)
    await openStats()
    $<HTMLButtonElement>(h.root, '.actions button:last-child').click()
    await settle()
    const [svgBtn, pngBtn] = [
      ...h.root.querySelectorAll<HTMLButtonElement>('.dash > .qr .qr-actions button'),
    ]
    expect(svgBtn!.hidden).toBe(false)
    expect(pngBtn!.textContent).toBe('Descargar PNG')
    expect(pngBtn!.hidden).toBe(true)
  })
})

describe('QR in the channel generator', () => {
  it('is disabled when empty and encodes the channel link as it changes', async () => {
    const code = await openStats()
    const button = $<HTMLButtonElement>(h.root, '.chan-row > button')
    expect(button.disabled).toBe(true)
    type($<HTMLInputElement>(h.root, '.chan input'), 'tv')
    expect(button.disabled).toBe(false)
    button.click()
    await settle()
    const first = rendered($(h.root, '.chan .qr svg'))
    expect(first.dark).toBe(expected(shortLink(code, base(), 'tv')).dark)
    type($<HTMLInputElement>(h.root, '.chan input'), 'instagram')
    await settle()
    const second = rendered($(h.root, '.chan .qr svg'))
    const link = shortLink(code, base(), 'instagram')
    expect(matrixFromPath(second.d, expected(link).span - 8)).toEqual(
      encode(link, { ecc: 'M', border: 0 }).data,
    )
    const { names } = captureDownload()
    $<HTMLButtonElement>(h.root, '.chan .qr .qr-actions button').click()
    expect(names).toEqual([`txiki-${code}-instagram.svg`])
    type($<HTMLInputElement>(h.root, '.chan input'), '')
    await settle()
    expect(button.disabled).toBe(true)
    expect($(h.root, '.chan .qr').hidden).toBe(true)
  })
})

describe('QR on the create screen', () => {
  it('encodes the plain short link of the new code', async () => {
    h = mount()
    await settle()
    type($<HTMLInputElement>(h.root, '#url'), 'https://endika.dev/cv-2026.pdf')
    $<HTMLFormElement>(h.root, 'form').requestSubmit()
    await settle()
    const code = $<HTMLInputElement>(h.root, '#short-link').value.slice(-7)
    $<HTMLButtonElement>(h.root, '.copyrow .mini:last-child').click()
    await settle()
    const link = shortLink(code, base())
    const want = expected(link)
    const got = rendered($(h.root, '.qr svg'))
    expect(matrixFromPath(got.d, want.span - 8)).toEqual(encode(link, { ecc: 'M', border: 0 }).data)
  })
})
