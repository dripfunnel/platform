import * as ImagePicker from 'expo-image-picker'

export type PhotoSource = 'camera' | 'library'
export type PickedPhoto = { uri: string; mimeType: string }

const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 }

/** The rider's photo from the camera or the library: null when they back out, `denied` when the camera is not allowed. */
export const pickPhoto = async (source: PhotoSource): Promise<PickedPhoto | 'denied' | null> => {
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return 'denied'
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options)
  const asset = result.canceled ? undefined : result.assets[0]
  return asset ? { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' } : null
}
