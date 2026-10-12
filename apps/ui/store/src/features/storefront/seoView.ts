import { seoLimits } from '../../api/storefront'
import { fill, formatCount, messages } from '../../messages'

const words = messages.storefront.seo

/** "48 / 60", saying so in words once it's too long, so the count isn't colour alone. */
export const counterText = (length: number, limit: number): string => fill(length > limit ? words.countOver : words.count, { count: formatCount(length), limit: formatCount(limit) })

/** Search results cut a long title or description short; the preview does the same. */
const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 2)}…` : text)

export const googleTitle = (title: string, shopName: string): string => cut(title.trim() || shopName, seoLimits.title)
export const googleDescription = (description: string): string => cut(description.trim(), seoLimits.description)

export const seoTooLong = (form: { title: string; description: string }): boolean => form.title.length > seoLimits.title || form.description.length > seoLimits.description
