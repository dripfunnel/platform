import { isStudioRequest } from './studio'

interface Env {
  API: Fetcher
  OWN_ZONE: string
  PAGES_HOST: string
  // The preview domain and the API's StorefrontEdge entrypoint; both unset until the preview zone's route exists (#287, #517).
  PREVIEW_DOMAIN?: string
  STOREFRONT?: Fetcher
}

const isOwnHost = (host: string, zone: string) => host === zone || host.endsWith(`.${zone}`)
const isApi = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/')

export const route = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)
  if (env.STOREFRONT && isStudioRequest(url, env.PREVIEW_DOMAIN)) return env.STOREFRONT.fetch(request)
  if (isOwnHost(url.hostname, env.OWN_ZONE)) return fetch(request)
  if (isApi(url.pathname)) return env.API.fetch(request)
  // Pages answers only the host it knows, so the request goes to its own name; the partner
  // host is not needed there.
  url.hostname = env.PAGES_HOST
  url.port = ''
  return fetch(new Request(url, request))
}

export default { fetch: route } satisfies ExportedHandler<Env>
