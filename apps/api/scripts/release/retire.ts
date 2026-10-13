import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import postgres from 'postgres'
import { z } from 'zod'
import { selectImagesToDelete } from '#db/scoped/coreReleases'
import { withSystemScope } from '#db/scoped/index'
import { recordImageDeleted } from '#saas/fleet/index'
import { assertLocalHost } from '../migrate/host-guard'
import { deleteRetiredImages, stderrOf } from './delete-images'

// retire-images.yml's step (storefront AI-STUDIO §9): each version the daily job retired loses its studio image in
// Cloudflare's registry. Wrangler is the only documented way to delete one; ghcr.io's public copy stays.
const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env)
assertLocalHost(env.DATABASE_URL)

const run = promisify(execFile)
const sql = postgres(env.DATABASE_URL, { max: 1 })
try {
  const { deleted, failed } = await deleteRetiredImages(await withSystemScope(sql, selectImagesToDelete), {
    remove: async (version) => {
      const { stdout } = await run('pnpm', ['exec', 'wrangler', 'containers', 'images', 'delete', `storefront-build:${version}`]).catch((error: unknown) => {
        process.stderr.write(stderrOf(error))
        throw error
      })
      process.stdout.write(stdout)
    },
    markDeleted: (version) => withSystemScope(sql, (tx) => recordImageDeleted(tx, version, new Date())),
  })
  for (const version of deleted) console.log(`storefront-build:${version} deleted from Cloudflare's registry.`)
  for (const version of failed) console.error(`storefront-build:${version} could not be deleted; it is tried again on the next run.`)
  if (failed.length > 0) process.exitCode = 1
} finally {
  await sql.end()
}
