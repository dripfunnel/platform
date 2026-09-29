import { createHash } from 'node:crypto'
import { parseBranch } from '../../../../scripts/git/naming.mjs'

const maxSlug = 20

export const isFeatureBranch = (branch: string) => parseBranch(branch)?.kind === 'feature'

export const slugOf = (branch: string) => {
  const parsed = parseBranch(branch)
  if (!parsed) throw new Error(`"${branch}" is not a #<issue>/<kind>/<short-name> branch.`)
  const slug = `${parsed.issue}-${parsed.name}`
  if (slug.length <= maxSlug) return slug
  const hash = createHash('sha1').update(branch).digest('hex').slice(0, 4)
  return `${slug.slice(0, maxSlug - 5).replace(/-+$/, '')}-${hash}`
}

export const spas = ['store', 'platform', 'admin'] as const
type Spa = (typeof spas)[number]

export const workerPrefix = 'dripfunnel-feature-'
export const hyperdrivePrefix = 'feature-'
export const neonPrefix = 'feature/'

export const namesFor = (slug: string, domain: string) => ({
  slug,
  worker: `${workerPrefix}${slug}`,
  hyperdrive: `${hyperdrivePrefix}${slug}`,
  neonBranch: `${neonPrefix}${slug}`,
  pagesBranch: slug,
  pagesProject: (spa: Spa) => `dripfunnel-feature-${spa}`,
  host: (area: Spa | 'hooks') => `${slug}-${area}.${domain}`,
})

export type Names = ReturnType<typeof namesFor>
