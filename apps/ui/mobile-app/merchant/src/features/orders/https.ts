/** A tracking address is https only (store FIRST-RELEASE §19); the API refuses any other, this saves the round trip. */
export const isHttps = (value: string): boolean => /^https:\/\/\S+$/i.test(value)
