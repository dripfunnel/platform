// The AI is sent an image of 4 MB at most (apps/api ai-designer/studio.ts `imageOf`); a Retina screenshot is often three times that.
export const maxImageBytes = 3_500_000
// Models see an image at about 1,600 px on its long edge anyway, so this loses nothing they would have seen.
const maxEdge = 2560

const encode = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))

/** The image as picked when it is small enough, otherwise a JPEG of it that is; the picked file when the browser can't draw it. */
export const shrinkImage = async (file: Blob): Promise<Blob> => {
  if (file.size <= maxImageBytes || typeof createImageBitmap !== 'function') return file
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return file
    // JPEG has no transparency: a transparent PNG goes on white, not black.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.7, 0.5]) {
      const blob = await encode(canvas, quality)
      if (blob && blob.size <= maxImageBytes) return blob
    }
    return file
  } finally {
    bitmap.close()
  }
}
