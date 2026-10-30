import { afterEach, describe, expect, it } from 'vitest'
import { LOCALES, t, tables } from '@/i18n'
import { $, mount, type Harness } from './helpers'

let h: Harness

afterEach(() => {
  h.dispose()
})

const SECTIONS = [
  'privacyWhoTitle',
  'privacyClickTitle',
  'privacyNotTitle',
  'privacyCreateTitle',
  'privacyBasisTitle',
  'privacyProcTitle',
  'privacyRetTitle',
  'privacyRightsTitle',
] as const

describe('privacy page', () => {
  for (const locale of LOCALES) {
    it(`renders every section in ${locale}`, () => {
      h = mount({ hash: '#/privacy', locale })
      const page = $(h.root, 'main')
      expect($(page, 'h1').textContent).toBe(tables[locale].privacyTitle)
      const headings = [...page.querySelectorAll('h2')].map((el) => el.textContent)
      expect(headings).toEqual(SECTIONS.map((key) => tables[locale][key]))
      expect(page.textContent).toContain('2026-10-30')
      expect(page.querySelectorAll('li')).toHaveLength(6 + 4 + 3)
      expect(page.textContent).not.toMatch(/\{\w+\}/)
    })
  }

  it('credits DB-IP with a safe external link', () => {
    h = mount({ hash: '#/privacy' })
    const link = $<HTMLAnchorElement>(h.root, 'main a[href="https://db-ip.com"]')
    expect(link.textContent).toBe('DB-IP')
    expect(link.rel).toContain('noopener')
    expect(h.root.querySelector('main')!.textContent).toContain('CC BY 4.0')
  })

  it('sends contact requests to the issues of the repository', () => {
    h = mount({ hash: '#/privacy' })
    const link = $<HTMLAnchorElement>(h.root, 'main a[href$="/txiki/issues"]')
    expect(link.href).toBe('https://github.com/Endika/txiki/issues')
    expect(link.rel).toContain('noopener')
  })

  it('names the delete button the page tells creators to use', () => {
    h = mount({ hash: '#/privacy' })
    expect($(h.root, 'main').textContent).toContain(`«${t('deleteLink')}»`)
  })

  it('is linked from the create card', () => {
    h = mount()
    expect($(h.root, 'form a[href="#/privacy"]').textContent).toBe(t('locWhatSaved'))
  })

  it('explains how it works with the technical details and the source', () => {
    h = mount()
    const items = [...h.root.querySelectorAll('#how li')].map((li) => li.textContent)
    expect(items).toContain(t('howSalt'))
    expect(items).toContain(t('howRls'))
    expect(items).toHaveLength(9)
    expect($<HTMLAnchorElement>(h.root, '#how a').rel).toContain('noopener')
  })

  it('is linked from the footer', () => {
    h = mount()
    expect($(h.root, '.foot a[href="#/privacy"]').textContent).toBe(t('footPrivacy'))
  })
})
