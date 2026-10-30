import { h } from '@/dom'
import { t } from '@/i18n'
import type { View } from './types'

export function privacyView(container: HTMLElement): View {
  return {
    dispose: () => {},
    draw: () =>
      container.replaceChildren(
        h(
          'div',
          { class: 'card stack' },
          h('h1', { tabindex: '-1' }, t('privacyTitle')),
          h('p', {}, t('privacyBody')),
        ),
      ),
  }
}
