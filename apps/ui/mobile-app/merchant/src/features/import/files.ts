import * as DocumentPicker from 'expo-document-picker'

export type PickedFile = { uri: string; name: string; size: number | null; mimeType: string | null }

const byteOrderMark = new RegExp(`^${String.fromCharCode(0xfeff)}`)

/** One file from the system document picker, copied to the app's cache so it can be read; null when the person backs out. */
export const pickCsv = async (): Promise<PickedFile | null> => {
  // Any type: Android files `.csv` under several MIME types, so the extension is checked afterwards (importFile.ts).
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true })
  const asset = result.canceled ? undefined : result.assets[0]
  return asset ? { uri: asset.uri, name: asset.name, size: asset.size ?? null, mimeType: asset.mimeType ?? null } : null
}

/** The file's text, without the byte-order mark Excel writes, as a browser reads it. `fetch`, because expo-file-system refuses the picker's cache folder in Expo Go. */
export const readCsv = async (uri: string): Promise<string> => (await (await fetch(uri)).text()).replace(byteOrderMark, '')
