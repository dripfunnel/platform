// Where a store's files are kept in the three storefront buckets (storefront LIVE-SHOP.md §2, PREVIEW.md §3). Every key is
// built from the store's id, never from a request's path, so nothing names another store's folder (LIVE-SHOP §9).

/** `storefront-sites` (private): build folders, staging folders and preview folders. */
export const storePrefix = (storeId: string) => `stores/${storeId}/`
export const buildFolder = (storeId: string, buildId: string) => `${storePrefix(storeId)}builds/${buildId}/`
export const stagingFolder = (storeId: string, buildId: string) => `${storePrefix(storeId)}uploads/${buildId}/`
export const previewRoot = (storeId: string) => `${storePrefix(storeId)}preview/`
export const previewFolder = (storeId: string, ref: string) => `${previewRoot(storeId)}${ref}/`

/** `storefront-assets` (public, behind the asset host): the same build folder, its hashed JS and CSS under `assets/`. */
export const assetsFolder = (storeId: string, buildId: string) => `${buildFolder(storeId, buildId)}assets/`

/** `storefront-drafts` (private): the draft, each build's source bundle and catalogue snapshot (LIVE-SHOP §4 step 3). */
export const draftBundle = (storeId: string) => `drafts/${storeId}.bundle`
export const sourcesPrefix = (storeId: string) => `sources/${storeId}/`
export const sourceBundle = (storeId: string, buildId: string) => `${sourcesPrefix(storeId)}${buildId}.bundle`
/** A published commit's theme, kept by the studio for the push once that publish is live (AI-STUDIO §6 step 4). */
export const publishedTheme = (storeId: string, commit: string) => `${sourcesPrefix(storeId)}themes/${commit}.json`
export const snapshotsPrefix = (storeId: string) => `snapshots/${storeId}/`
export const snapshotFile = (storeId: string, buildId: string) => `${snapshotsPrefix(storeId)}${buildId}.json`

/** The build's own list of its files and each one's headers, written by the copy of LIVE-SHOP §4 step 9 (#517). */
export const manifestName = '_manifest.json'
