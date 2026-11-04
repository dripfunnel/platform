'use client'

import { useState } from 'react'
import { Image, useStorefront, Video, type Photo, type VideoFile } from '@dripfunnel/storefront-core/theme'

/** The chosen picture large, the rest as thumbnails, and the product's video last. */
export const Gallery = ({ photos, video, name }: { photos: readonly Photo[]; video: VideoFile | null; name: string }) => {
  const { t } = useStorefront()
  const [shown, setShown] = useState(0)
  const first = photos[0]
  // Core's <Video> needs a poster (storefront ARCHITECTURE §2.1), so a product with no photo shows no video either.
  if (!first) return <div className="aspect-[4/5] rounded-card [background:var(--picture-alt)]" />
  const playing = video !== null && shown === photos.length
  const photo = photos[Math.min(shown, photos.length - 1)] ?? first
  return (
    <div className="flex min-w-0 flex-col gap-y-2.5 gap-x-2.5">
      <div className="overflow-hidden aspect-[4/5] rounded-card [background:var(--picture-alt)]">
        {playing && video ? <Video video={video} poster={first} label={name} ratio={0.8} className="block w-full h-full object-cover" /> : <Image image={photo} alt={photo.alt ?? name} ratio={0.8} sizes="(min-width: 900px) 50vw, 100vw" className="block w-full h-full object-cover" />}
      </div>
      {photos.length > 1 || video ? (
        <div className="flex flex-wrap gap-y-2 gap-x-2">
          {photos.map((p, i) => (
            <button key={p.url} type="button" className={i === shown ? 'p-0 border-[2px] border-ink inline-flex overflow-hidden w-15 h-15 items-center justify-center rounded-[8px] bg-soft text-ink cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]' : 'p-0 border-[2px] border-transparent inline-flex overflow-hidden w-15 h-15 items-center justify-center rounded-[8px] bg-soft text-ink cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]'} aria-label={p.alt ?? name} aria-pressed={i === shown} onClick={() => setShown(i)}>
              <Image image={p} alt="" ratio={1} sizes="64px" className="block w-full h-full object-cover" />
            </button>
          ))}
          {video ? (
            <button type="button" className={playing ? 'p-0 border-[2px] border-ink inline-flex overflow-hidden w-15 h-15 items-center justify-center rounded-[8px] bg-soft text-ink cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]' : 'p-0 border-[2px] border-transparent inline-flex overflow-hidden w-15 h-15 items-center justify-center rounded-[8px] bg-soft text-ink cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]'} aria-label={t('shop.product.video')} aria-pressed={playing} onClick={() => setShown(photos.length)}>
              <svg className="w-5.5 h-5.5 [fill:currentcolor]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M9 7l8 5-8 5z" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
