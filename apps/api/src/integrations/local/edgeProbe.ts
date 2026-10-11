import type { EdgeProbe } from '../http/edgeProbe'

// The post-deploy checks' edge on this machine (docs/setup/local.md §6.1, with GITHUB_LOCAL): no store host resolves
// here, so a page is read from the live build's folder as store-proxy would serve it, and the Shop API isn't reached.

interface Readable {
  get: (key: string) => Promise<{ text: () => Promise<string>; httpMetadata?: { contentType?: string } } | null>
}

export interface LocalEdge {
  sites: Readable
  assets: Readable
  /** `sf-assets.<EDGE_ZONE>`: its paths are keys in the assets bucket (LIVE-SHOP §2). */
  assetHost: string
  /** The store and live build a host serves, as the edge Worker's lookup answers it. */
  liveBuild: (host: string) => Promise<{ storeId: string; buildId: string } | null>
}

/** store-proxy's mapping (files.ts), kept to plain names: a page is its folder's `index.html`. */
const keyOf = (pathname: string): string => {
  const names = pathname.split('/').filter((n) => n !== '')
  const last = names.at(-1)
  return last === undefined || pathname.endsWith('/') || !last.includes('.') ? [...names, 'index.html'].join('/') : names.join('/')
}

export const localEdgeProbe = (edge: LocalEdge): EdgeProbe => ({
  get: async (raw) => {
    const url = new URL(raw)
    if (url.host === edge.assetHost) {
      const object = await edge.assets.get(url.pathname.slice(1))
      return object ? { status: 200, contentType: object.httpMetadata?.contentType ?? '', build: null, body: '' } : { status: 404, contentType: '', build: null, body: '' }
    }
    const live = await edge.liveBuild(url.host)
    if (!live) return null
    const object = await edge.sites.get(`stores/${live.storeId}/builds/${live.buildId}/${keyOf(url.pathname)}`)
    if (!object) return { status: 404, contentType: 'text/html', build: live.buildId, body: '' }
    return { status: 200, contentType: object.httpMetadata?.contentType ?? '', build: live.buildId, body: await object.text() }
  },
  shop: async () => null,
})
