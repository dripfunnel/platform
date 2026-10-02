import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { cloudflare } from './cloudflare'
import { attachHosts, destroy, existingSlugs, prepare, staleSlugs } from './lifecycle'
import { isFeatureBranch, namesFor, slugOf, spas } from './names'
import { neon } from './neon'

const cloudflareEnv = z.object({
  CLOUDFLARE_API_TOKEN: z.string().min(1),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  FEATURE_ZONE_ID: z.string().min(1),
  FEATURE_DOMAIN: z.string().min(1),
})
const neonEnv = z.object({ NEON_API_KEY: z.string().min(1), NEON_PROJECT_ID: z.string().min(1) })

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { branch: { type: 'string' }, tips: { type: 'string' } },
})
const [command] = positionals

const featureNames = (domain: string) => {
  const branch = z.string().min(1).parse(values.branch)
  if (!isFeatureBranch(branch)) throw new Error(`"${branch}" isn't an <issue>/feature/<short-name> branch; it gets no environment.`)
  return namesFor(slugOf(branch), domain)
}

const clients = () => {
  const cfEnv = cloudflareEnv.parse(process.env)
  const neonVars = neonEnv.parse(process.env)
  return {
    domain: cfEnv.FEATURE_DOMAIN,
    cf: cloudflare(cfEnv.CLOUDFLARE_API_TOKEN, cfEnv.CLOUDFLARE_ACCOUNT_ID, cfEnv.FEATURE_ZONE_ID),
    db: neon(neonVars.NEON_API_KEY, neonVars.NEON_PROJECT_ID),
  }
}

const readTips = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [branch = '', date = ''] = line.split('|')
      return { branch, committedAt: new Date(date) }
    })

const run = async () => {
  switch (command) {
    case 'names': {
      const n = featureNames(z.string().min(1).parse(process.env.FEATURE_DOMAIN))
      const lines = [
        `slug=${n.slug}`,
        `worker=${n.worker}`,
        `neon_branch=${n.neonBranch}`,
        `pages_branch=${n.pagesBranch}`,
        ...spas.flatMap((spa) => [`${spa}_project=${n.pagesProject(spa)}`, `${spa}_url=https://${n.host(spa)}`]),
        `hooks_url=https://${n.host('hooks')}`,
      ]
      console.log(lines.join('\n'))
      return
    }
    case 'prepare': {
      const { cf, domain } = clients()
      await prepare(cf, featureNames(domain), domain, z.string().url().parse(process.env.FEATURE_DATABASE_URL))
      return
    }
    case 'attach': {
      const { cf, domain } = clients()
      await attachHosts(cf, featureNames(domain))
      return
    }
    case 'destroy': {
      const { cf, db, domain } = clients()
      await destroy(cf, db, featureNames(domain))
      return
    }
    case 'prune': {
      const { cf, db, domain } = clients()
      const stale = staleSlugs(await existingSlugs(cf, db), readTips(z.string().min(1).parse(values.tips)), new Date())
      const failures: string[] = []
      for (const slug of stale) {
        console.log(`Removing feature env "${slug}"`)
        await destroy(cf, db, namesFor(slug, domain)).catch((error: unknown) => failures.push(String(error)))
      }
      if (failures.length) throw new Error(failures.join('\n'))
      return
    }
    default:
      throw new Error('Usage: main.ts <names|prepare|attach|destroy> --branch <branch> | prune --tips <file>')
  }
}

await run()
