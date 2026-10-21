/** Whether core version `a` (`x.y.z` or `x.y.z-dev.<run>`) is newer than `b`, by number, never by text; kept in step with core_version_key in migration 0356. */
export const isNewerVersion = (a: string, b: string): boolean => {
  const key = (v: string) => [...(v.split('-')[0] ?? '').split('.').map(Number), Number(v.split('-dev.')[1] ?? Number.POSITIVE_INFINITY)]
  const [ka, kb] = [key(a), key(b)]
  for (let i = 0; i < 4; i += 1) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}
