/** Whether core version `a` (`x.y.z`) is newer than `b`, by number, never by text. */
export const isNewerVersion = (a: string, b: string): boolean => {
  const [pa, pb] = [a.split('.').map(Number), b.split('.').map(Number)]
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}
