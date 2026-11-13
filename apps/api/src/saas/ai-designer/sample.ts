// A site the merchant names in the words, as `https://shop.example/` or `www.shop.example`, used as the sample when none is attached.
const named = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/i
const trailing = /[.,;:!?)\]}]+$/

/** The first web address in `text`, as https, or null; the screenshot's own checks still judge it. */
export const siteIn = (text: string, maxLength: number): string | null => {
  const found = named.exec(text)?.[0].replace(trailing, '')
  if (!found) return null
  const site = /^https?:\/\//i.test(found) ? found.replace(/^http:/i, 'https:') : `https://${found}`
  return site.length <= maxLength ? site : null
}
