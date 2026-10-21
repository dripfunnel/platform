import { maxImportBytes } from '../../api/imports'
import { pickDocument } from '../common/pickDocument'
import { CsvTooLarge } from './importFile'

const byteOrderMark = new RegExp(`^${String.fromCharCode(0xfeff)}`)

// Any type: Android files `.csv` under several MIME types, so the extension is checked afterwards (importFile.ts).
export const pickCsv = pickDocument

// `fetch`, not expo-file-system, which refuses the picker's cache folder in Expo Go. A picker that gave no size is checked here
// by the declared length and the text's length (never more than its bytes), so an oversize file is refused before it is sent.
export const readCsv = async (uri: string): Promise<string> => {
  const response = await fetch(uri)
  const declared = Number(response.headers.get('content-length'))
  if (declared > maxImportBytes) throw new CsvTooLarge(declared)
  const text = await response.text()
  if (text.length > maxImportBytes) throw new CsvTooLarge(text.length)
  return text.replace(byteOrderMark, '')
}
