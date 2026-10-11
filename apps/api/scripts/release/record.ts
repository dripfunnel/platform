import postgres from 'postgres'
import { z } from 'zod'
import { recordCoreRelease } from '#db/scoped/coreReleases'
import { withSystemScope } from '#db/scoped/index'
import { assertLocalHost } from '../migrate/host-guard'

// The release workflow's last step (storefront AI-STUDIO §1): core_release learns the version's sandbox image. Run on
// the same push as prod.yml's migrations, so it waits for the table that migration 0250 makes.
const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
    SANDBOX_IMAGE: z.string().regex(/^registry\.cloudflare\.com\/[A-Za-z0-9_./-]+@sha256:[0-9a-f]{64}$/),
  })
  .parse(process.env)
assertLocalHost(env.DATABASE_URL)

const sql = postgres(env.DATABASE_URL, { max: 1 })
try {
  for (let attempt = 1; ; attempt += 1) {
    const [found] = await sql<{ exists: boolean }[]>`select to_regclass('public.core_release') is not null as exists`
    if (found?.exists) break
    if (attempt === 30) throw new Error('core_release still does not exist; has prod.yml migrated?')
    await new Promise((resolve) => setTimeout(resolve, 30_000))
  }
  await withSystemScope(sql, (tx) => recordCoreRelease(tx, env.VERSION, env.SANDBOX_IMAGE))
  console.log(`core_release ${env.VERSION} recorded.`)
} finally {
  await sql.end()
}
