import { z } from 'zod'
import { pushToRepo, upgradeBundle, upgradeFiles, type PushDeps, type PushResult, type SitesBucket } from '#saas/storefronts/index'

// The upgrade's commit reaches the repo's main only once its build is live (LIVE-SHOP §8), through #316's push API, as
// the files it changed: the platform never reads main back, so the build's own source bundle stays the record.

export const upgradePushParams = z.strictObject({
  storeId: z.uuid(),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  key: z.string().min(1).max(200),
})
export type UpgradePushParams = z.infer<typeof upgradePushParams>

const filesSchema = z.strictObject({ files: z.array(z.strictObject({ path: z.string().max(512), content: z.string().nullable() })).max(1000) })

/** Pushed once per key; the private copy goes once main has it. */
export const pushUpgrade = async (deps: PushDeps & { drafts: SitesBucket }, p: UpgradePushParams): Promise<PushResult | { ok: false; code: 'NO_FILES' }> => {
  const object = await deps.drafts.get(upgradeFiles(p.storeId, p.commit))
  const parsed = filesSchema.safeParse(object ? JSON.parse(await object.text()) : null)
  if (!parsed.success) return { ok: false, code: 'NO_FILES' }
  const files = parsed.data.files.flatMap((f) => (f.content === null ? [] : [{ path: f.path, content: f.content }]))
  const removed = parsed.data.files.flatMap((f) => (f.content === null ? [f.path] : []))
  const result = await pushToRepo(deps, { storeId: p.storeId, key: p.key, reason: { kind: 'upgrade', coreVersion: p.version }, files, removed })
  if (result.ok) await deps.drafts.delete([upgradeBundle(p.storeId, p.commit), upgradeFiles(p.storeId, p.commit)])
  return result
}
