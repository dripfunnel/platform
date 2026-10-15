import { Share } from 'react-native'

/** Opens the system share sheet with the export's CSV as text (decided on #503: no file dependency). True when the person shared it. */
export const shareCsv = async (title: string, csv: string): Promise<boolean> => {
  const result = await Share.share({ title, message: csv })
  return result.action !== Share.dismissedAction
}
