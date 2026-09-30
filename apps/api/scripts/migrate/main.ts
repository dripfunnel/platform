import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { migrate } from './runner'

const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env)

await migrate(env.DATABASE_URL, fileURLToPath(new URL('../../migrations', import.meta.url)))
