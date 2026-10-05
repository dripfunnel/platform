import { useEffect, useState } from 'react'
import { actingHeaders } from '../../acting'

// A store file (`/api/assets/{id}`) needs the acting store's headers, which an <img> can't send, so it is
// fetched and shown from memory; until then, or if it can't be read, the placeholder holds its place.
export const AssetImage = ({ url, alt, className, placeholder }: { url: string; alt: string; className: string; placeholder: string }) => {
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
  return src ? <img className={className} src={src} alt={alt} /> : <span className={`${className} ${className}--none`}>{placeholder}</span>
}
