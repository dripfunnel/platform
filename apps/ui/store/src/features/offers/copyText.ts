/** Copies text to the clipboard: false where the browser gives no clipboard (an insecure page) or refuses, so the screen says so. */
export const copyText = async (text: string): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
