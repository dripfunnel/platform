// A sample site's screenshot for the designer (storefront ARCHITECTURE §6.2): Cloudflare Browser Rendering takes it,
// never the store's container. The caller has already checked the address is public https (docs/ARCHITECTURE.md §7).

export interface Screenshotter {
  /** The page from the top, in up to `maxSlices` JPEG slices at the device's width; empty when none could be taken. */
  take: (url: URL, device: 'desktop' | 'tablet' | 'phone') => Promise<Uint8Array<ArrayBuffer>[]>
}

/** Each slice is about one screen tall, so the model reads it at full size; a whole page in one image would shrink unreadably. */
const slices = { desktop: { width: 1440, height: 1440 }, tablet: { width: 834, height: 1112 }, phone: { width: 390, height: 844 } } as const
export const maxSlices = 4
const timeoutMs = 30_000
/** The model takes images up to a few MB; a larger answer is refused rather than sent. */
export const maxScreenshotBytes = 4 * 1024 * 1024
// A slice past the page's end is one flat colour (about 13 KB at 1440×1440); a slice of a real page is several times that.
const blankBytesPerPixel = 0.012

export const browserScreenshots = ({ accountId, token, fetchImpl = fetch }: { accountId: string; token: string; fetchImpl?: typeof fetch }): Screenshotter => ({
  take: async (url, device) => {
    const { width, height } = slices[device]
    const slice = async (y: number): Promise<Uint8Array<ArrayBuffer> | null> => {
      let response: Response
      try {
        response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            url: url.href,
            viewport: { width, height: Math.round(width * 0.75) },
            // Scrolled first, so sections that load as they come into view are drawn in the lower slices.
            scrollPage: true,
            screenshotOptions: { type: 'jpeg', quality: 70, captureBeyondViewport: true, clip: { x: 0, y, width, height } },
            rejectResourceTypes: ['media'],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch {
        return null
      }
      if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      return bytes.byteLength > 0 && bytes.byteLength <= maxScreenshotBytes ? bytes : null
    }
    const taken = await Promise.all(Array.from({ length: maxSlices }, (_, i) => slice(i * height)))
    const blank = width * height * blankBytesPerPixel
    const shown: Uint8Array<ArrayBuffer>[] = []
    for (const [i, bytes] of taken.entries()) {
      if (bytes === null || (i > 0 && bytes.byteLength < blank)) break
      shown.push(bytes)
    }
    return shown
  },
})
