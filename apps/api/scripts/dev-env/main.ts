import { z } from 'zod'
import { cloudflare } from '../feature-env/cloudflare'

const env = z.object({
  CLOUDFLARE_API_TOKEN: z.string().min(1),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  DEV_ZONE_ID: z.string().min(1),
  DEV_DOMAIN: z.string().min(1),
}).parse(process.env)

const cf = cloudflare(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ACCOUNT_ID, env.DEV_ZONE_ID)

const spas = [
  { spa: 'store', project: 'dripfunnel-store-dev' },
  { spa: 'platform', project: 'dripfunnel-platform-dev' },
  { spa: 'admin', project: 'dripfunnel-admin-dev' },
] as const

for (const { spa, project } of spas) {
  const host = `dev-${spa}.${env.DEV_DOMAIN}`
  await cf.ensurePagesDomain(project, host)
  await cf.upsertCname(host, `${project}.pages.dev`, 'dev environment')
}
