import { h } from '@/dom'
import { t, type MessageKey } from '@/i18n'
import type { View } from './types'

const SOURCE_URL = 'https://github.com/Endika/txiki'
const ISSUES_URL = `${SOURCE_URL}/issues`
const DBIP_URL = 'https://db-ip.com'

function list(keys: readonly MessageKey[]): HTMLElement {
  return h('ul', {}, ...keys.map((key) => h('li', {}, t(key))))
}

export function clickList(): HTMLElement {
  return list([
    'privacyClickCountry',
    'privacyClickNetwork',
    'privacyClickDevice',
    'privacyClickModel',
    'privacyClickScreen',
    'privacyClickLang',
    'privacyClickReferrer',
    'privacyClickChannel',
    'privacyClickVisitor',
    'privacyClickLocation',
  ])
}

function external(href: string, text: string): HTMLElement {
  return h('a', { href, rel: 'noopener noreferrer' }, text)
}

function attribution(): HTMLElement {
  const [before = '', after = ''] = t('privacyAttr').split('{link}')
  return h('p', { class: 'cap' }, before, external(DBIP_URL, 'DB-IP'), after)
}

function section(title: MessageKey, ...body: (HTMLElement | string)[]): HTMLElement {
  return h('section', { class: 'prv' }, h('h2', {}, t(title)), ...body)
}

export function privacyView(container: HTMLElement): View {
  return {
    dispose: () => {},
    draw: () =>
      container.replaceChildren(
        h(
          'div',
          { class: 'card stack' },
          h('h1', { tabindex: '-1' }, t('privacyTitle')),
          h('p', { class: 'cap' }, t('privacyUpdated')),
          section(
            'privacyWhoTitle',
            h('p', {}, t('privacyWho')),
            h('p', {}, external(ISSUES_URL, t('privacyIssues'))),
          ),
          section('privacyClickTitle', h('p', {}, t('privacyClickLead')), clickList()),
          section('privacyNotTitle', h('p', {}, t('privacyNot'))),
          section(
            'privacyCreateTitle',
            list([
              'privacyCreateTarget',
              'privacyCreateRate',
              'privacyCreateNote',
              'privacyCreateLocal',
            ]),
          ),
          section('privacyBasisTitle', h('p', {}, t('privacyBasis'))),
          section(
            'privacyProcTitle',
            list(['privacyProcSupabase', 'privacyProcTurnstile', 'privacyProcPages']),
          ),
          section('privacyRetTitle', h('p', {}, t('privacyRet'))),
          section(
            'privacyRightsTitle',
            h('p', {}, t('privacyRights', { delete: t('deleteLink') })),
          ),
          attribution(),
        ),
      ),
  }
}
