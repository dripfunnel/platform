'use client'

import { z } from 'zod'
import { useShopData } from '../render/data'
import { Image } from './media'
import { imageSchema } from './photo'

// A picture the merchant chose in Storefront › Assets (AI-STUDIO §8): the theme names it by id, from its content, and
// core fetches the address, so a theme still never writes one (ARCHITECTURE §3.4). Nothing shows until it is known.

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const query = 'query MerchantImage($id: ID!) { shopAsset(id: $id) { url } }'
const schema = z.object({ shopAsset: imageSchema })

export type MerchantImageProps = {
  /** The asset's id, written in the theme's content; one that isn't a file of this store shows nothing. */
  asset: string
  alt: string
  ratio: number
  sizes?: string
  className?: string
}

export const MerchantImage = ({ asset, alt, ratio, sizes, className }: MerchantImageProps) => {
  const valid = idPattern.test(asset)
  const loaded = useShopData(valid ? JSON.stringify(['asset', asset]) : null, (c) => c.query(query, schema, { id: asset }))
  const photo = loaded.data?.shopAsset ?? null
  if (!valid || !photo) return null
  return <Image image={photo} alt={alt} ratio={ratio} {...(sizes ? { sizes } : {})} {...(className ? { className } : {})} />
}
