import { useState, type ReactNode } from 'react'

// A brand file read back from the API: if it can't load (removed from the bucket, no bucket bound),
// the fallback shows instead of a broken image.
export const BrandFileImage = ({ src, alt, className, fallback }: { src: string; alt: string; className?: string; fallback: ReactNode }) => {
  const [failed, setFailed] = useState<string | null>(null)
  if (failed === src) return <>{fallback}</>
  return <img className={className} src={src} alt={alt} onError={() => setFailed(src)} />
}
