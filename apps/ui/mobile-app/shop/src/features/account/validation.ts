// What the website's sign-in and address forms check before asking the API (storefront-core checkout/address.ts); the API checks again.
export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const phonePattern = /^\+[1-9]\d{6,14}$/

/** Spaces, dashes, dots and brackets aside. */
export const compact = (value: string): string => value.trim().replaceAll(/[\s().-]/g, '')

export const isPhone = (value: string): boolean => phonePattern.test(compact(value))

export const minPasswordLength = 10

export type Problem = 'required' | 'invalid'
