// IndexNow (indexnow.org; storefront ARCHITECTURE §8): tells Bing, Yandex and the others which addresses changed. No account:
// the key is proved by the file the edge Worker serves at `https://{host}/{key}.txt`. Up to 10,000 addresses a call.

export const indexNowEndpoint = 'https://api.indexnow.org/indexnow'
export const maxIndexNowUrls = 10_000
const timeoutMs = 10_000

/** The search engines may answer later: no answer, 429 or a 5xx. */
export class IndexNowUnavailable extends Error {
  override name = 'IndexNowUnavailable'
}
/** Refused for good (400, 403 key not valid, 422 addresses not of this host): trying again won't help. */
export class IndexNowRefused extends Error {
  override name = 'IndexNowRefused'
}

export interface IndexNow {
  submit: (input: { host: string; key: string; urls: readonly string[] }) => Promise<void>
}

export const indexNowClient = ({ fetchImpl = fetch, endpoint = indexNowEndpoint }: { fetchImpl?: typeof fetch; endpoint?: string } = {}): IndexNow => ({
  submit: async ({ host, key, urls }) => {
    for (let i = 0; i < urls.length; i += maxIndexNowUrls) {
      let response: Response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls.slice(i, i + maxIndexNowUrls) }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch {
        throw new IndexNowUnavailable('no answer')
      }
      await response.body?.cancel()
      if (response.status === 429 || response.status >= 500) throw new IndexNowUnavailable(`answered ${response.status}`)
      if (!response.ok) throw new IndexNowRefused(`answered ${response.status}`)
    }
  },
})
