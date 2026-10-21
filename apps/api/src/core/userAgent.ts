// "Where you're signed in" names a device the person recognises, never the raw header (PortalProfile).

const browsers: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
const systems: [RegExp, string][] = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
]

const first = (list: [RegExp, string][], ua: string): string | null => list.find(([re]) => re.test(ua))?.[1] ?? null

/** `Chrome on Windows`; null when the header names neither. */
export const deviceOf = (userAgent: string | null): string | null => {
  if (!userAgent) return null
  const browser = first(browsers, userAgent)
  const system = first(systems, userAgent)
  if (browser && system) return `${browser} on ${system}`
  return browser ?? system
}
