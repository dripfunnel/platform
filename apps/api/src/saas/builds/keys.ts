// The build's keys in the storefront buckets (storefront LIVE-SHOP.md §2 "The keys"), always from the store's id and the
// build id, never from what a caller sends.

const storePrefix = (storeId: string) => `stores/${storeId}/`

/** `storefront-sites`: the write-once build folder, and the staging folder an upload credential names. */
export const buildFolder = (storeId: string, buildId: string) => `${storePrefix(storeId)}builds/${buildId}/`
export const stagingFolder = (storeId: string, buildId: string) => `${storePrefix(storeId)}uploads/${buildId}/`

/** `storefront-drafts`: the build's frozen input (LIVE-SHOP §4 step 3). */
export const sourceBundle = (storeId: string, buildId: string) => `sources/${storeId}/${buildId}.bundle`
export const snapshotFile = (storeId: string, buildId: string) => `snapshots/${storeId}/${buildId}.json`

/** A build folder's own list of its files (LIVE-SHOP §4 step 8), at the same name in the staging folder. */
export const manifestName = '_manifest.json'
