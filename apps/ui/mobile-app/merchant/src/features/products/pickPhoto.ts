import * as ImagePicker from 'expo-image-picker'

export type Picked = { uri: string; mimeType: string | null }

const quality = 0.9

const filesOf = (result: ImagePicker.ImagePickerResult): Picked[] => (result.canceled ? [] : result.assets.map((asset) => ({ uri: asset.uri, mimeType: asset.mimeType ?? null })))

/** Up to `room` photos from the phone's library (CATALOG-DESIGN.md F1); an iPhone's HEIC arrives converted, as the picker does it. */
export const pickFromLibrary = async (room: number): Promise<Picked[]> =>
  filesOf(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: room > 1, selectionLimit: Math.max(1, room), quality }))

/** One photo from the camera, or `denied` when the person has not allowed it (the app says where to change that). */
export const pickFromCamera = async (): Promise<{ files: Picked[]; denied: boolean }> => {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) return { files: [], denied: true }
  return { files: filesOf(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality })), denied: false }
}
