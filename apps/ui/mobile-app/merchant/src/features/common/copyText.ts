import * as Clipboard from 'expo-clipboard'

/** Puts text on the clipboard; false when the phone refused, so the caller can say so. */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    return await Clipboard.setStringAsync(text)
  } catch {
    return false
  }
}
