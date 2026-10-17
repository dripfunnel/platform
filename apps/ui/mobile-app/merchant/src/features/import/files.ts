import * as DocumentPicker from 'expo-document-picker'
import { maxImportBytes } from '../../api/imports'
import { CsvTooLarge } from './importFile'

export type PickedFile = { uri: string; name: string; size: number | null; mimeType: string | null }

const byteOrderMark = new RegExp(`^${String.fromCharCode(0xfeff)}`)

/** One file from the system document picker, copied to the app's cache so it can be read; null when the person backs out. */
export const pickCsv = async (): Promise<PickedFile | null> => {
  // Any type: Android files `.csv` under several MIME types, so the extension is checked afterwards (importFile.ts).
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true })
  const asset = result.canceled ? undefined : result.assets[0]
  return asset ? { uri: asset.uri, name: asset.name, size: asset.size ?? null, mimeType: asset.mimeType ?? null } : null
}

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
