import postgres from 'postgres'
import { z } from 'zod'
import { uniqueViolation, withSystemScope } from '#db/scoped/index'
import { startReleaseRollout } from '#saas/fleet/index'
import { assertLocalHost } from '../migrate/host-guard'

// promote.yml's last step (SAAS §10): once the API is live, stores move to the promoted commit's core.
const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
  })
  .parse(process.env)
assertLocalHost(env.DATABASE_URL)

const sql = postgres(env.DATABASE_URL, { max: 1 })
try {
  const rollout = await withSystemScope(sql, (tx) => startReleaseRollout(tx, env.VERSION, new Date())).catch((error: unknown) => {
    // Staff or the image retirement job started one in the meantime.
    if (uniqueViolation(error, 'core_rollout_one_active')) return { skipped: 'rollout_active' }
    throw error
  })
  console.log(`core ${env.VERSION}: ${JSON.stringify(rollout)}`)
} finally {
  await sql.end()
}
