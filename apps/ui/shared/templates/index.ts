// One picture per storefront template (store FIRST-RELEASE §14), shown by the merchant portal's gallery and Admin's
// Templates. A key without a picture answers an address that fails to load, so the caller keeps its name tile.
export const templatePicture = (key: string): string => new URL(`./pictures/${encodeURIComponent(key)}.webp`, import.meta.url).href
