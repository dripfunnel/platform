/** Puts text on the clipboard; answers whether it got there, so each app says so in its own words. */
export const copyText = (text: string): Promise<boolean> =>
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(
      () => true,
      () => false,
    )
