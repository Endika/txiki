import type { Stats } from '@/api/port'
import { icon, h } from '@/dom'
import { t } from '@/i18n'
import { encryptNote } from '@/note-crypto'
import { readNote, type NoteState } from '@/note-state'
import { loadLinks, removeLink, saveLink } from '@/storage'
import { type WorldMap } from '../map'
import type { View, ViewDeps } from '../types'
import { dashboard } from './dashboard'

type State =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'gone' } | { kind: 'ready'; stats: Stats }

export function statsView(
  container: HTMLElement,
  deps: ViewDeps,
  code: string,
  token: string,
): View {
  let state: State = { kind: 'loading' }
  let disposed = false
  let started = false
  let deleting = false
  let focused = false
  let deleteFailed = false
  let note: NoteState = { kind: 'none' }
  let mapView: WorldMap | null = null
  const { tz } = deps.client

  async function load(): Promise<void> {
    state = { kind: 'loading' }
    draw()
    try {
      const stats = await deps.api.stats(code, token, tz)
      if (disposed) return
      if (stats === null) {
        state = { kind: 'gone' }
      } else {
        if (!loadLinks(deps.storage).some((l) => l.code === code)) {
          saveLink(deps.storage, {
            code,
            token,
            target: stats.target,
            createdAt: stats.createdAt,
          })
        }
        note = await readNote(token, code, stats.note)
        if (disposed) return
        state = { kind: 'ready', stats }
      }
    } catch {
      if (disposed) return
      state = { kind: 'error' }
    }
    draw()
  }

  async function saveNote(text: string | null): Promise<boolean> {
    try {
      const blob = text === null ? null : await encryptNote(token, code, text)
      if (!(await deps.api.setNote(code, token, blob))) return false
    } catch {
      return false
    }
    note = text === null ? { kind: 'none' } : { kind: 'text', text }
    return true
  }

  async function remove(): Promise<void> {
    if (deleting || !deps.confirm(t('deleteConfirm'))) return
    deleting = true
    deleteFailed = false
    draw()
    try {
      await deps.api.remove(code, token)
    } catch {
      if (disposed) return
      deleting = false
      deleteFailed = true
      draw()
      return
    }
    removeLink(deps.storage, code)
    if (!disposed) deps.location.hash = '#/links'
  }

  function draw(): void {
    switch (state.kind) {
      case 'loading':
        container.replaceChildren(
          h(
            'section',
            { class: 'card stack', role: 'status' },
            h('p', { class: 'fine' }, icon('spinner', 'spin'), ' ', t('statsLoading')),
          ),
        )
        return
      case 'error':
        container.replaceChildren(
          h(
            'section',
            { class: 'card stack' },
            h(
              'p',
              { class: 'banner', role: 'alert' },
              icon('alert'),
              h('span', {}, t('errNetwork')),
            ),
            h('button', { type: 'button', class: 'btn', onclick: () => void load() }, t('retry')),
          ),
        )
        return
      case 'gone':
        container.replaceChildren(
          h(
            'section',
            { class: 'card stack' },
            h('div', { class: 'badge' }, icon('unlink')),
            h('h1', { tabindex: '-1' }, t('statsGoneTitle')),
            h('p', { class: 'lead' }, t('statsGoneBody')),
            h(
              'button',
              {
                type: 'button',
                class: 'btn sec',
                onclick: () => {
                  removeLink(deps.storage, code)
                  deps.location.hash = '#/links'
                },
              },
              t('statsGoneRemove'),
            ),
          ),
        )
        return
      case 'ready':
        container.replaceChildren(
          dashboard(state.stats, {
            code,
            token,
            location: deps.location,
            now: deps.now(),
            deleting,
            deleteFailed,
            onRemove: () => void remove(),
            note: { note, save: saveNote },
            map: {
              disposed: () => disposed,
              adopt: (map) => {
                mapView?.dispose()
                mapView = map
              },
            },
          }),
        )
        if (!focused) {
          focused = true
          container.querySelector<HTMLElement>('h1')?.focus()
        }
        return
    }
  }

  return {
    draw() {
      if (!started) {
        started = true
        void load()
      } else draw()
    },
    dispose() {
      disposed = true
      mapView?.dispose()
    },
  }
}
