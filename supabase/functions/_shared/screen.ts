export type ScreenClass = 'small-phone' | 'phone' | 'tablet' | 'laptop' | 'large'

export function screenClass(w: unknown, h: unknown): ScreenClass | null {
  if (typeof w !== 'number' || typeof h !== 'number') return null
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null
  if (w <= 0 || h <= 0 || w > 10000 || h > 10000) return null
  const short = Math.min(w, h)
  const long = Math.max(w, h)
  if (long >= 1920) return 'large'
  if (short < 360) return 'small-phone'
  if (short < 600) return 'phone'
  if (long < 1280) return 'tablet'
  return 'laptop'
}
