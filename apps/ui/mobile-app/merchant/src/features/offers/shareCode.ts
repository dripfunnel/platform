import { Share } from 'react-native'

/** Opens the system share sheet with the code as text: an offer code is not a secret, and the clipboard module is only for one (#510). */
export const shareCode = async (code: string, onFail: () => void): Promise<void> => {
  try {
    await Share.share({ message: code })
  } catch {
    onFail()
  }
}
