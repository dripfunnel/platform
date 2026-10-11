import { execFileSync } from 'node:child_process'
import postgres from 'postgres'
import { z } from 'zod'
import { markImageDeleted, selectImagesToDelete } from '#db/scoped/coreReleases'
import { withSystemScope } from '#db/scoped/index'
import { assertLocalHost } from '../migrate/host-guard'

// retire-images.yml's step (storefront AI-STUDIO §9): each version the daily job retired loses its studio image in
// Cloudflare's registry. Wrangler is the only documented way to delete one; ghcr.io's public copy stays.
const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env)
assertLocalHost(env.DATABASE_URL)

const sql = postgres(env.DATABASE_URL, { max: 1 })
try {
  for (const version of await withSystemScope(sql, selectImagesToDelete)) {
    execFileSync('pnpm', ['exec', 'wrangler', 'containers', 'images', 'delete', `storefront-build:${version}`], { stdio: 'inherit' })
    await withSystemScope(sql, (tx) => markImageDeleted(tx, version, new Date()))
    console.log(`storefront-build:${version} deleted from Cloudflare's registry.`)
  }
} finally {
  await sql.end()
}
