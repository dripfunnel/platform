'use client'

import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from '../browser/hooks'
import { studioBasePath } from '../render/studio'
import { useStorefront } from '../store/context'
import type { Photo, VideoFile } from './photo'

const widths = [320, 480, 640, 960, 1280, 1920] as const
// Cloudflare image resizing on the live site (decided 2026-10-05 on #337); a preview shows the original.
const resized = (source: string, width: number) => `/cdn-cgi/image/width=${width},quality=82,format=auto/${source}`

/** In the studio frame the shop's files are asked for under `/__studio/{session}/`, since the frame carries no cookie (AI-STUDIO §3 step 6). */
export const frameAddress = (address: string, base: string | null): string => {
  if (!base) return address
  try {
    const { pathname } = new URL(address, 'https://frame.invalid')
    return pathname.startsWith('/shop-api/') ? `${base}${pathname.slice(1)}` : address
  } catch {
    return address
  }
}

// The catalogue file the Shop API's `/shop-api/assets/{id}` and a built page's copy of it name (LIVE-SHOP §5 step 7).
const catalogueFile = /(?:\/shop-api\/assets|\/media)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const fileOf = (address: string): string | null => catalogueFile.exec(address)?.[1] ?? null

/** The first address given for a catalogue file: a built page keeps its copy when the Shop API's fresh answer names it too. */
const useSteadyAddress = (address: string): string => {
  const [kept, keep] = useState(address)
  const file = fileOf(address)
  const same = kept === address || (file !== null && fileOf(kept) === file)
  if (!same) keep(address)
  return same ? kept : address
}

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
  const address = useSteadyAddress(image.url)
  const source = mode === 'studio' ? frameAddress(address, studioBasePath(import.meta.url)) : address
  const height = Math.round(1200 / (ratio > 0 ? ratio : 1))
  return (
    <img
      src={live ? resized(address, 960) : source}
      srcSet={live ? widths.map((w) => `${resized(address, w)} ${w}w`).join(', ') : undefined}
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
