import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { assertLocalHost } from './host-guard'
import { migrate } from './runner'

const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env)
assertLocalHost(env.DATABASE_URL)

await migrate(env.DATABASE_URL, fileURLToPath(new URL('../../migrations', import.meta.url)))
