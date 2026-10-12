// A sample site's screenshot for the designer (storefront ARCHITECTURE §6.2): Cloudflare Browser Rendering takes it,
// never the store's container. The caller has already checked the address is public https (docs/ARCHITECTURE.md §7).

export interface Screenshotter {
  /** A JPEG of the page's first screen at the device's width, or null when it couldn't be taken. */
  take: (url: URL, device: 'desktop' | 'tablet' | 'phone') => Promise<Uint8Array<ArrayBuffer> | null>
}

const widths = { desktop: 1440, tablet: 834, phone: 390 } as const
const timeoutMs = 30_000
/** The model takes images up to a few MB; a larger answer is refused rather than sent. */
export const maxScreenshotBytes = 4 * 1024 * 1024

export const browserScreenshots = ({ accountId, token, fetchImpl = fetch }: { accountId: string; token: string; fetchImpl?: typeof fetch }): Screenshotter => ({
  take: async (url, device) => {
    const width = widths[device]
    let response: Response
    try {
      response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.href, viewport: { width, height: Math.round(width * 0.75) }, screenshotOptions: { type: 'jpeg', quality: 70 }, rejectResourceTypes: ['media'] }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      return null
    }
    if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.byteLength > 0 && bytes.byteLength <= maxScreenshotBytes ? bytes : null
  },
})
