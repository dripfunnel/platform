'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { Image } from './media'
import { photoOf } from './photo'

// An image the store repo's theme holds in src/theme/media/ (#1405): the theme names the file, and the build gives core
// each file's address, so a theme still never writes one (ARCHITECTURE §3.4).

type ThemeMedia = Readonly<Record<string, string>>

const ThemeMediaContext = createContext<ThemeMedia>({})

/** The build's addresses for the theme's images, by file name; given by whatever boots or renders the theme. */
export const ThemeMediaProvider = ({ media, children }: { media: ThemeMedia; children: ReactNode }) => <ThemeMediaContext.Provider value={media}>{children}</ThemeMediaContext.Provider>

export type ThemeImageProps = {
  /** The file's name in src/theme/media/, such as "haldi-home.webp"; the validator holds it to a file that is there. */
  src: string
  alt: string
  ratio: number
  sizes?: string
  className?: string
}

export const ThemeImage = ({ src, alt, ratio, sizes, className }: ThemeImageProps) => {
  const media = useContext(ThemeMediaContext)
  const address = Object.hasOwn(media, src) ? media[src] : undefined
  if (!address) return null
  return <Image image={photoOf(address, null)} alt={alt} ratio={ratio} {...(sizes ? { sizes } : {})} {...(className ? { className } : {})} />
}
