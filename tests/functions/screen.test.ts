import { describe, expect, it } from 'vitest'
import { screenClass } from '../../supabase/functions/_shared/screen.ts'

describe('screenClass', () => {
  it.each([
    [320, 568, 'small-phone'],
    [375, 667, 'phone'],
    [412, 915, 'phone'],
    [768, 1024, 'tablet'],
    [820, 1180, 'tablet'],
    [1366, 768, 'laptop'],
    [1440, 900, 'laptop'],
    [1536, 864, 'laptop'],
    [1920, 1080, 'large'],
    [2560, 1440, 'large'],
    [568, 320, 'small-phone'],
    [1024, 768, 'tablet'],
  ])('%i x %i is %s', (w, h, expected) => {
    expect(screenClass(w, h)).toBe(expected)
  })

  it.each([
    [0, 0],
    [NaN, 900],
    [900, Infinity],
    [-1, 800],
    [10001, 800],
    ['375', 667],
    [null, undefined],
  ])('%j x %j is null', (w, h) => {
    expect(screenClass(w, h)).toBeNull()
  })
})
