import { uploadVideo } from '../../api/productEditor'
import { messages } from '../../messages'
import { maxVideoBytes, maxVideoSeconds, videoSeconds } from './videoLength'

/**
 * A video picked for a product or an A+ Video block (#1401, #1448): its size and length checked before uploading, then
 * uploaded; its asset id, or the sentence that says why not. The server checks both again from the file.
 */
export const uploadCheckedVideo = async (file: File): Promise<{ ok: true; assetId: string } | { ok: false; message: string }> => {
  const words = messages.editor.photos
  if (file.size > maxVideoBytes) return { ok: false, message: words.videoTooBig }
  const seconds = await videoSeconds(file)
  if (seconds !== null && seconds > maxVideoSeconds) return { ok: false, message: words.videoTooLong }
  const result = await uploadVideo(file)
  return result.ok ? result : { ok: false, message: words.videoRefused[result.code] }
}
