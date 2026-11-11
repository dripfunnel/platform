import { useEffect, useState } from 'react'
import { actingHeaders } from '../../acting'

// A store file (`/api/assets/{id}`) needs the acting store's headers, which a <video> can't send, so it is fetched
// and shown from memory, as AssetImage does a photo. A product video is at most 4 MB (#1401), so holding it is cheap.
export const AssetVideo = ({ url, label, className, placeholder }: { url: string; label: string; className: string; placeholder: string }) => {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let made: string | null = null
    void fetch(url, { credentials: 'same-origin', headers: actingHeaders(), signal: AbortSignal.timeout(30_000) })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || !live) return
        made = URL.createObjectURL(blob)
        setSrc(made)
      })
      .catch(() => undefined)
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
      setSrc(null)
    }
  }, [url])
  return src ? <video className={className} src={src} aria-label={label} muted playsInline preload="metadata" /> : <span className={`${className} ${className}--none`}>{placeholder}</span>
}
