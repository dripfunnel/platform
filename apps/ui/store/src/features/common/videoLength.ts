// A product's one video is at most 4 MB and 30 seconds (#1401); the server checks both again from the file itself.
export const maxVideoBytes = 4 * 1024 * 1024
export const maxVideoSeconds = 30

/** Whether the chosen file is a video, by what the browser says it is or, when it says nothing, by its extension. */
export const isVideoFile = (file: File): boolean => file.type.startsWith('video/') || (file.type === '' && /\.(mp4|webm)$/i.test(file.name))

/** A video's length in seconds as the browser reads it from the file's metadata; null when it can't be read. */
export const videoSeconds = (file: Blob): Promise<number | null> =>
  new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = (seconds: number | null) => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(seconds)
    }
    const timer = setTimeout(() => done(null), 10_000)
    video.preload = 'metadata'
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null)
    video.onerror = () => done(null)
    video.src = url
  })
