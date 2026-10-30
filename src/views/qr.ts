import { h } from '@/dom'
import { t } from '@/i18n'

const QUIET = 4
const PNG_SCALE = 10
const SVG_NS = 'http://www.w3.org/2000/svg'

export interface QrTarget {
  link: string
  name: string
}

export interface QrControl {
  button: HTMLButtonElement
  panel: HTMLElement
  set: (target: QrTarget | null) => void
}

function svgEl(name: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  return el
}

function drawSvg(matrix: readonly (readonly boolean[])[], label: string): SVGElement {
  const span = matrix.length + QUIET * 2
  let d = ''
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`
    }),
  )
  const svg = svgEl('svg', {
    viewBox: `0 0 ${span} ${span}`,
    role: 'img',
    'aria-label': label,
    'shape-rendering': 'crispEdges',
  })
  svg.append(
    svgEl('rect', { width: String(span), height: String(span), fill: '#fff' }),
    svgEl('path', { d, fill: '#000' }),
  )
  return svg
}

function drawCanvas(matrix: readonly (readonly boolean[])[]): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const span = (matrix.length + QUIET * 2) * PNG_SCALE
  canvas.width = span
  canvas.height = span
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, span, span)
  ctx.fillStyle = '#000'
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) ctx.fillRect((x + QUIET) * PNG_SCALE, (y + QUIET) * PNG_SCALE, PNG_SCALE, PNG_SCALE)
    }),
  )
  return canvas
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: filename })
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function canvasAvailable(): boolean {
  try {
    return document.createElement('canvas').getContext('2d') !== null
  } catch {
    return false
  }
}

export function qrControl(): QrControl {
  const button = h(
    'button',
    { type: 'button', class: 'mini', 'aria-expanded': 'false' },
    t('qrButton'),
  )
  const panel = h('div', { class: 'qr', role: 'group', 'aria-label': t('qrButton') })
  panel.hidden = true
  let target: QrTarget | null = null
  let open = false
  let version = 0

  async function paint(): Promise<void> {
    const mine = ++version
    if (!open || !target) {
      panel.replaceChildren()
      panel.hidden = true
      return
    }
    const current = target
    panel.hidden = false
    try {
      const { encode } = await import('uqr')
      if (mine !== version) return
      const matrix = encode(current.link, { ecc: 'M', border: 0 }).data
      const svg = drawSvg(matrix, t('qrAlt', { link: current.link }))
      const downloadSvg = h(
        'button',
        {
          type: 'button',
          class: 'mini',
          onclick: () => {
            const copy = svg.cloneNode(true) as SVGElement
            const side = String((matrix.length + QUIET * 2) * PNG_SCALE)
            copy.setAttribute('width', side)
            copy.setAttribute('height', side)
            const xml = new XMLSerializer().serializeToString(copy)
            save(new Blob([xml], { type: 'image/svg+xml' }), `${current.name}.svg`)
          },
        },
        t('qrSvg'),
      )
      const downloadPng = h(
        'button',
        {
          type: 'button',
          class: 'mini',
          onclick: () => {
            drawCanvas(matrix)?.toBlob((blob) => {
              if (blob) save(blob, `${current.name}.png`)
            }, 'image/png')
          },
        },
        t('qrPng'),
      )
      downloadPng.hidden = !canvasAvailable()
      panel.replaceChildren(svg, h('div', { class: 'qr-actions' }, downloadSvg, downloadPng))
    } catch {
      if (mine !== version) return
      panel.replaceChildren(h('p', { class: 'hint', role: 'alert' }, t('qrError')))
    }
  }

  button.addEventListener('click', () => {
    open = !open
    button.setAttribute('aria-expanded', String(open))
    void paint()
  })

  return {
    button,
    panel,
    set(next) {
      target = next
      button.disabled = next === null
      if (next === null) {
        open = false
        button.setAttribute('aria-expanded', 'false')
      }
      void paint()
    },
  }
}
