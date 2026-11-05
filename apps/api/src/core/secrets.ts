/** Whether two secrets match, compared as digests so the time taken says nothing about where they differ. */
export const sameSecret = async (given: string, held: string): Promise<boolean> => {
  const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
  const [a, b] = await Promise.all([digest(given), digest(held)])
  return a.reduce((diff, byte, i) => diff | (byte ^ (b[i] ?? 0)), 0) === 0
}
