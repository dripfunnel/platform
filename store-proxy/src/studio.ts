// The studio frame on a store's preview origin (storefront AI-STUDIO §3 step 6): `{key}.<PREVIEW_DOMAIN>/__studio/…`
// goes to the API's StorefrontEdge, which asks the store's Durable Object before anything is read. Nothing else here
// reads the path, so the session id in it is never logged (LOGGING §9).

export const isStudioRequest = (url: URL, previewDomain: string | undefined): boolean =>
  previewDomain !== undefined && url.hostname.endsWith(`.${previewDomain}`) && (url.pathname === '/__studio' || url.pathname.startsWith('/__studio/'))
