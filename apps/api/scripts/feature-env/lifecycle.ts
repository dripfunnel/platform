import type { Cloudflare } from './cloudflare'
import { hyperdrivePrefix, isFeatureBranch, neonPrefix, slugOf, spas, workerPrefix, type Names } from './names'
import type { Neon } from './neon'
import { featureConfig, readBaseConfig, writeFeatureConfig } from './wrangler-config'

export const idleDays = 14

export const prepare = async (cf: Cloudflare, names: Names, zone: string, databaseUrl: string) => {
  for (const spa of spas) await cf.ensurePagesProject(names.pagesProject(spa))
  const hyperdriveId = await cf.ensureHyperdrive(names.hyperdrive, databaseUrl)
  writeFeatureConfig(featureConfig(readBaseConfig(), names, zone, hyperdriveId))
}

export const attachHosts = async (cf: Cloudflare, names: Names) => {
  for (const spa of spas) {
    const project = names.pagesProject(spa)
    await cf.ensurePagesDomain(project, names.host(spa))
    await cf.upsertCname(names.host(spa), `${names.pagesBranch}.${project}.pages.dev`, `feature env ${names.slug}`)
  }
}

export const destroy = async (cf: Cloudflare, db: Neon, names: Names) => {
  const steps: [string, () => Promise<unknown>][] = [
    ['worker', () => cf.deleteWorker(names.worker)],
    ...spas.flatMap((spa): [string, () => Promise<unknown>][] => [
      [`${spa} domain`, () => cf.deletePagesDomain(names.pagesProject(spa), names.host(spa))],
      [`${spa} DNS`, () => cf.deleteDnsRecords(names.host(spa))],
      [`${spa} deployments`, () => cf.deletePagesBranchDeployments(names.pagesProject(spa), names.pagesBranch)],
    ]),
    ['hooks DNS', () => cf.deleteDnsRecords(names.host('hooks'))],
    ['hyperdrive', () => cf.deleteHyperdrive(names.hyperdrive)],
    ['neon branch', () => db.deleteBranch(names.neonBranch)],
  ]
  const failures: string[] = []
  for (const [label, step] of steps) {
    try {
      await step()
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures.length) throw new Error(`Feature env "${names.slug}" was only partly removed:\n${failures.join('\n')}`)
}

export const existingSlugs = async (cf: Cloudflare, db: Neon) => {
  const strip = (prefix: string) => (names: string[]) => names.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length))
  const [workers, hyperdrives, branches] = await Promise.all([cf.workerNames(), cf.hyperdriveNames(), db.branchNames()])
  return [...new Set([...strip(workerPrefix)(workers), ...strip(hyperdrivePrefix)(hyperdrives), ...strip(neonPrefix)(branches)])]
}

export type BranchTip = { branch: string; committedAt: Date }

export const staleSlugs = (existing: string[], tips: BranchTip[], now: Date) => {
  const lastActivity = new Map<string, number>()
  for (const { branch, committedAt } of tips.filter((tip) => isFeatureBranch(tip.branch))) {
    const slug = slugOf(branch)
    lastActivity.set(slug, Math.max(lastActivity.get(slug) ?? 0, committedAt.getTime()))
  }
  const cutoff = now.getTime() - idleDays * 24 * 60 * 60 * 1000
  return existing.filter((slug) => (lastActivity.get(slug) ?? 0) < cutoff)
}
