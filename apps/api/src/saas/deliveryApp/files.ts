// Where a store's delivery app APK lives in R2 and what makes a file one (api/DELIVERY.md §5).

/** A signed release APK is tens of megabytes; a Worker request body is held to about 100 MB. */
export const maxApkBytes = 100 * 1024 * 1024
export const apkContentType = 'application/vnd.android.package-archive'

/** Apart from the store's catalogue (`stores/<id>/assets/`) and its app images (`stores/<id>/app/`). */
export const apkPrefix = (storeId: string): string => `stores/${storeId}/delivery-app/`
export const apkKey = (storeId: string): string => `${apkPrefix(storeId)}${crypto.randomUUID()}.apk`

/** An APK is a ZIP: it starts with `PK\x03\x04`. */
export const looksLikeApk = (head: Uint8Array): boolean => head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
