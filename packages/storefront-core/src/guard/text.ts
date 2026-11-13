// A link or a resource address: links go through core's <Link>, media through <Image> and <Video>.
const address = /:\/\/|^\s*\/\/|^\s*(?:javascript|data|vbscript|blob|file|mailto|tel|sms|https?|ftp|wss?):|url\s*\(|@import/i
const svgReference = /^url\(#[A-Za-z][\w-]*\)$/

export const isAddress = (text: string): boolean => address.test(text) && !svgReference.test(text.trim())
