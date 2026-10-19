import { Share } from 'react-native'

/** Opens the system share sheet with the code as text; there is no clipboard dependency in the app (decided on #503 for exports). */
export const shareCode = async (code: string, onFail: () => void): Promise<void> => {
  try {
    await Share.share({ message: code })
  } catch {
    onFail()
  }
}
