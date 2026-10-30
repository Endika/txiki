import { describe, expect, it } from 'vitest'
import { fitViewBox, groupPoints, project, tier, type World } from '@/map'
import { WORLD } from '@/world-data'

const world: World = { viewBox: [-180, -84, 360, 144], countries: [] }

const at = (lat: number, lon: number, when = '2026-10-01T10:00:00Z') => ({ lat, lon, at: when })

describe('project', () => {
  it('uses lon as x and flips lat into y', () => {
    expect(project(40.4, -3.7)).toEqual({ x: -3.7, y: -40.4 })
  })
})

describe('groupPoints', () => {
  it('groups coordinates equal at two decimals and keeps the latest time', () => {
    const groups = groupPoints([
      at(40.4168, -3.7038, '2026-10-01T10:00:00Z'),
      at(40.4171, -3.7041, '2026-10-03T10:00:00Z'),
      at(40.4199, -3.7038, '2026-10-02T10:00:00Z'),
    ])
    expect(groups).toEqual([{ lat: 40.42, lon: -3.7, count: 3, lastAt: '2026-10-03T10:00:00Z' }])
  })

  it('keeps nearby but different coordinates apart', () => {
    expect(groupPoints([at(40.41, -3.7), at(40.43, -3.7)])).toHaveLength(2)
  })

  it('orders groups by most recent click first', () => {
    const groups = groupPoints([
      at(1, 1, '2026-10-01T10:00:00Z'),
      at(2, 2, '2026-10-03T10:00:00Z'),
      at(3, 3, '2026-10-02T10:00:00Z'),
    ])
    expect(groups.map((g) => g.lat)).toEqual([2, 3, 1])
  })

  it('is deterministic when times tie', () => {
    const a = groupPoints([at(5, 5), at(1, 9), at(1, 2)])
    const b = groupPoints([at(1, 2), at(5, 5), at(1, 9)])
    expect(a).toEqual(b)
  })

  it('returns nothing for no points', () => {
    expect(groupPoints([])).toEqual([])
  })
})

describe('fitViewBox', () => {
  it('shows the whole world with no points', () => {
    expect(fitViewBox([], world)).toBe(world.viewBox)
  })

  it('zooms to the minimum size around a single point and keeps the aspect ratio', () => {
    const [x, y, w, h] = fitViewBox(groupPoints([at(40.42, -3.7)]), world)
    expect(w).toBeGreaterThanOrEqual(8)
    expect(w / h).toBeCloseTo(360 / 144)
    expect(x + w / 2).toBeCloseTo(-3.7)
    expect(y + h / 2).toBeCloseTo(-40.42)
  })

  it('covers two far apart points with margin', () => {
    const [x, y, w, h] = fitViewBox(groupPoints([at(40.4, -3.7), at(-33.9, 151.2)]), world)
    expect(x).toBeLessThan(-3.7)
    expect(x + w).toBeGreaterThan(151.2)
    expect(y).toBeLessThan(-40.4)
    expect(y + h).toBeGreaterThan(33.9)
    expect(w / h).toBeCloseTo(360 / 144)
  })

  it('falls back to the world when the points span all of it', () => {
    const groups = groupPoints([at(0, -179), at(0, 179)])
    expect(fitViewBox(groups, world)).toBe(world.viewBox)
  })

  it('never leaves the world', () => {
    for (const [lat, lon] of [
      [83, 179.9],
      [-59, -179.9],
      [83, -179.9],
      [-59, 179.9],
    ] as const) {
      const [x, y, w, h] = fitViewBox(groupPoints([at(lat, lon)]), world)
      expect(x).toBeGreaterThanOrEqual(-180)
      expect(y).toBeGreaterThanOrEqual(-84)
      expect(x + w).toBeLessThanOrEqual(180 + 1e-9)
      expect(y + h).toBeLessThanOrEqual(60 + 1e-9)
    }
  })
})

describe('tier', () => {
  it('is 0 without clicks and 4 at the maximum', () => {
    expect(tier(0, 10)).toBe(0)
    expect(tier(10, 10)).toBe(4)
    expect(tier(1, 1)).toBe(4)
  })

  it('splits the maximum into quartiles, rounding up', () => {
    expect(tier(1, 100)).toBe(1)
    expect(tier(25, 100)).toBe(1)
    expect(tier(26, 100)).toBe(2)
    expect(tier(50, 100)).toBe(2)
    expect(tier(51, 100)).toBe(3)
    expect(tier(75, 100)).toBe(3)
    expect(tier(76, 100)).toBe(4)
  })
})

describe('WORLD', () => {
  const codes = WORLD.countries.map((c) => c.code)

  it('has the countries we need and no Antarctica', () => {
    expect(codes.length).toBeGreaterThanOrEqual(170)
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true)
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of ['ES', 'FR', 'US', 'XK']) expect(codes).toContain(c)
    expect(codes).not.toContain('AQ')
  })

  it('has a drawable path for every country', () => {
    for (const c of WORLD.countries) expect(c.d).toMatch(/^(M[^MZ]+Z)+$/)
  })
})
