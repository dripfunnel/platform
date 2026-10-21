import * as DocumentPicker from 'expo-document-picker'

export type PickedFile = { uri: string; name: string; size: number | null; mimeType: string | null }

/** One file of any type from the system document picker, copied to the app's cache so it can be read; null when the person backs out. */
export const pickDocument = async (): Promise<PickedFile | null> => {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true })
  const asset = result.canceled ? undefined : result.assets[0]
  return asset ? { uri: asset.uri, name: asset.name, size: asset.size ?? null, mimeType: asset.mimeType ?? null } : null
}
