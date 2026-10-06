import { z } from 'zod'
import { finishLocally } from './local'
import { seed } from './seed'

// `pnpm --filter ./apps/api seed`: a believable local platform (card #32). Local databases only,
// refused otherwise by the same guard migrate uses; everything it owns is replaced.
const env = z.object({ DATABASE_URL: z.string().min(1), SEED_PASSWORD: z.string().min(1).optional() }).parse(process.env)

const counts = await seed(env.DATABASE_URL)
console.log(
  `Seeded ${counts.partners} partners, ${counts.partnerUsers} partner users, ${counts.plans} plans, ${counts.stores} stores, ` +
    `${counts.people} people, ${counts.jobs} signup jobs, ${counts.staff} staff and ${counts.activity} activity entries.`,
)
if (counts.invitationPath) console.log(`Accept an invitation on the platform host at ${counts.invitationPath}`)
const local = await finishLocally(env.DATABASE_URL, env.SEED_PASSWORD)
console.log(`Moved ${local.hosts} partner addresses to .localhost (store.northstar.localhost, …).`)
console.log(local.passwords > 0 ? `${local.passwords} seeded people sign in with SEED_PASSWORD.` : 'No SEED_PASSWORD in .env.local: seeded people sign in after Forgot password.')
