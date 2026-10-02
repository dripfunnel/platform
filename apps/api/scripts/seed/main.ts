import { z } from 'zod'
import { seed } from './seed'

// `pnpm --filter ./apps/api seed`: a believable local platform (card #32). Local databases only,
// refused otherwise by the same guard migrate uses; everything it owns is replaced.
const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env)

const counts = await seed(env.DATABASE_URL)
console.log(
  `Seeded ${counts.partners} partners, ${counts.partnerUsers} partner users, ${counts.plans} plans, ${counts.stores} stores, ` +
    `${counts.people} people, ${counts.jobs} signup jobs, ${counts.staff} staff and ${counts.activity} activity entries.`,
)
