'use client'

import { useEffect, useRef } from 'react'
import { z } from 'zod'
import type { Branded } from '../../pricing/brand'
import { useInView, useReducedMotion } from '../browser/hooks'
import { useStorefront } from '../store/context'

// Images and video from the store's media (ARCHITECTURE §2.1 `platform/media`): only core's decoders make a Photo or a
// VideoFile, so a theme shows the catalogue's pictures and never an address of its own (§3.4).

/** A picture from the Shop API; `main` is the one picture core lets load first on its page. */
export type Photo = Branded<{ url: string; alt: string | null; main: boolean }, 'Photo'>
export type VideoFile = Branded<{ url: string }, 'VideoFile'>

const url = z.string().min(1).max(2048)

export const photoOf = (address: string, alt: string | null): Photo => ({ url: address, alt, main: false }) as Photo

/** ShopPhoto as a Photo; null when it has no address. */
export const photoSchema = z
  .object({ image: z.object({ url: url.nullable().optional() }).nullable().optional(), alt: z.string().nullable().optional() })
  .transform((p) => (p.image?.url ? photoOf(p.image.url, p.alt ?? null) : null))

export const imageSchema = z
  .object({ url: url.nullable().optional() })
  .nullable()
  .optional()
  .transform((i) => (i?.url ? photoOf(i.url, null) : null))

export const videoSchema = z
  .object({ file: z.object({ url: url.nullable().optional() }).nullable().optional() })
  .nullable()
  .optional()
  .transform((v) => (v?.file?.url ? ({ url: v.file.url } as VideoFile) : null))

/** The page's first picture, the only one loaded eagerly. */
export const asMain = (photo: Photo): Photo => ({ ...photo, main: true }) as Photo

const widths = [320, 480, 640, 960, 1280, 1920] as const
// Cloudflare image resizing on the live site (decided 2026-10-05 on #337); a preview shows the original.
const resized = (source: string, width: number) => `/cdn-cgi/image/width=${width},quality=82,format=auto/${source}`

export type ImageProps = {
  image: Photo
  alt: string
  /** Width over height, which sets the width and height the browser reserves before the picture arrives. */
  ratio: number
  /** How wide the picture shows, as a sizes list; the full width when left out. */
  sizes?: string
  className?: string
}

/** Width and height always set, resized and in modern formats on the live site, lazy unless it is the page's main picture. */
export const Image = ({ image, alt, ratio, sizes = '100vw', className }: ImageProps) => {
  const { mode } = useStorefront()
  const live = mode === 'live'
  const height = Math.round(1200 / (ratio > 0 ? ratio : 1))
  return (
    <img
      src={live ? resized(image.url, 960) : image.url}
      srcSet={live ? widths.map((w) => `${resized(image.url, w)} ${w}w`).join(', ') : undefined}
      sizes={live ? sizes : undefined}
      width={1200}
      height={height}
      alt={alt}
      loading={image.main ? 'eager' : 'lazy'}
      fetchPriority={image.main ? 'high' : 'auto'}
      decoding="async"
      className={className}
    />
  )
}

export type VideoProps = {
  video: VideoFile
  poster: Photo
  label: string
  /** Plays muted and looped while on screen, unless the shopper asked for less motion; otherwise it waits for a press. */
  autoPlay?: boolean
  ratio: number
  className?: string
}

/** Never preloaded, paused off screen and under reduced motion, with its poster as its picture; its controls always show, so a playing video can be paused (WCAG 2.2.2). */
export const Video = ({ video, poster, label, autoPlay = false, ratio, className }: VideoProps) => {
  const element = useRef<HTMLVideoElement>(null)
  const seen = useInView(element)
  const still = useReducedMotion()
  const playing = autoPlay && seen && !still
  useEffect(() => {
    const v = element.current
    if (!v) return
    if (playing) void v.play().catch(() => undefined)
    else v.pause()
  }, [playing])
  return (
    <video
      ref={element}
      poster={poster.url}
      preload="none"
      muted={autoPlay}
      loop={autoPlay}
      playsInline
      controls
      width={1200}
      height={Math.round(1200 / (ratio > 0 ? ratio : 1))}
      aria-label={label}
      className={className}
    >
      <source src={video.url} />
    </video>
  )
}
