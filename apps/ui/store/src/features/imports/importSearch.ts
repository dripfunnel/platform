import { z } from 'zod'

// Shopify's callback sends the person back to /products/import (apps/api/src/hooks/shopify.ts): `shopify=finish&key=…` or `shopify=failed`.
export const importSearch = z.object({ shopify: z.enum(['finish', 'failed']).optional(), key: z.string().optional() })
