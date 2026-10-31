import type postgres from 'postgres'
import { z } from 'zod'
import { withSystemScope } from '#db/scoped/index'
import { selectAssetsBuild, selectLiveBuildId, selectRun, setAssetsBuild, type PageRender } from '#db/scoped/publishing'
import { selectUpload } from '#db/scoped/builds'
import { buildFolder, manifestName } from './layout'
import { manifestSchema, maxBuildFiles, type Manifest } from './manifest'
import { copyObject, sealBuild, type VerifyDeps } from './verify'

// The single-page render (storefront LIVE-SHOP.md §7): a page run builds only its addresses in the store's workflow, and
// the API completes its new build folder from the live build's other files, so every build folder is whole on its own.

/** Addresses a page run takes before it becomes a full automatic publish, which renders every page anyway. */
export const maxRenderPages = 100
/** Files one Workflow step copies, within the step's five minutes. */
export const inheritBatch = 500

// Plain names only: no `.` or `..` segment, no `//host` (LIVE-SHOP §5 step 6).
const address = z.string().max(2048).regex(/^\/(?:(?!\.{1,2}(?:\/|$))[A-Za-z0-9._~@+,=-]+\/?)*$/)

/** `storefront.render`: what the product triggers (migrations 0287, 0378: a hidden product's drop alone) and #471's home page save queue. */
export const renderRequest = z
  .strictObject({ storeId: z.uuid(), pages: z.array(address).max(maxRenderPages), drop: z.array(address).max(maxRenderPages) })
  .refine((r) => r.pages.length + r.drop.length > 0, 'nothing to render')
export type RenderRequest = z.infer<typeof renderRequest>

/** Two renders waiting together render both; the later one wins where they disagree (a page asked for, then moved). */
export const mergeRender = (earlier: PageRender, later: PageRender): PageRender => ({
  pages: [...new Set([...earlier.pages.filter((p) => !later.drop.includes(p)), ...later.pages])],
  drop: [...new Set([...earlier.drop.filter((d) => !later.pages.includes(d)), ...later.drop])],
})

/** A page's files in the build folder: `/products/x` is everything under `products/x/` (store-proxy's relativeKey). */
const folderOf = (path: string) => {
  const trimmed = path.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? null : `${trimmed}/`
}

/** What #483's dispatch hands the workflow for a page run: the addresses, and the build whose JS and CSS they load. */
export const renderInputs = (sql: postgres.Sql, runId: string): Promise<{ pages: string[]; assetsBuildId: string } | null> =>
  withSystemScope(sql, async (tx) => {
    const run = await selectRun(tx, runId)
    const live = run?.render ? await selectLiveBuildId(tx, run.store_id) : null
    const assets = live ? await selectAssetsBuild(tx, live) : null
    return run?.render && assets ? { pages: run.render.pages, assetsBuildId: assets } : null
  })

export class RenderBaseMissing extends Error {
  override name = 'RenderBaseMissing'
}

const readManifest = async (deps: VerifyDeps, storeId: string, buildId: string): Promise<Manifest> => {
  const object = await deps.sites.get(`${buildFolder(storeId, buildId)}${manifestName}`)
  const parsed = manifestSchema.safeParse(object ? JSON.parse(await object.text()) : null)
  if (!parsed.success) throw new RenderBaseMissing('the live build has no manifest')
  return parsed.data
}

export interface InheritPlan {
  base: string
  files: Manifest['files']
}

/** The live build's files the render didn't upload and doesn't leave out, in the manifest's order. */
export const inheritPlan = async (deps: VerifyDeps, storeId: string, runId: string): Promise<InheritPlan> => {
  const found = await withSystemScope(deps.sql, async (tx) => {
    const run = await selectRun(tx, runId)
    const upload = await selectUpload(tx, storeId, runId)
    const live = await selectLiveBuildId(tx, storeId)
    return { run, upload, live }
  })
  const uploaded = manifestSchema.safeParse(found.upload?.upload_manifest)
  if (!found.run?.render || !found.live || !uploaded.success) throw new RenderBaseMissing('no live build to render beside')
  const own = new Set(uploaded.data.files.map((f) => f.path))
  const dropped = found.run.render.drop.map(folderOf).filter((f): f is string => f !== null)
  const base = await readManifest(deps, storeId, found.live)
  return { base: found.live, files: base.files.filter((f) => !own.has(f.path) && !dropped.some((d) => f.path.startsWith(d))) }
}

/** Copies one batch from the live build's folder; each object's bytes must hash to its manifest entry, as at a publish. */
export const copyInherited = async (deps: VerifyDeps, storeId: string, runId: string, plan: InheritPlan, batch: number): Promise<void> => {
  for (const file of plan.files.slice(batch * inheritBatch, (batch + 1) * inheritBatch)) {
    const object = await deps.sites.get(`${buildFolder(storeId, plan.base)}${file.path}`)
    if (!object) throw new RenderBaseMissing(`the live build lost ${file.path}`)
    await copyObject(deps.sites, `${buildFolder(storeId, runId)}${file.path}`, await object.arrayBuffer(), file.sha256, file.path)
  }
}

/** The render's files and the inherited ones as one manifest, written last; its pages load the live build's assets. */
export const sealRender = async (deps: VerifyDeps, storeId: string, runId: string, plan: InheritPlan): Promise<void> => {
  const upload = await withSystemScope(deps.sql, (tx) => selectUpload(tx, storeId, runId))
  const uploaded = manifestSchema.parse(upload?.upload_manifest)
  const files = [...uploaded.files, ...plan.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  if (files.length > maxBuildFiles) throw new RenderBaseMissing('the build would pass the file limit')
  await withSystemScope(deps.sql, async (tx) => setAssetsBuild(tx, runId, (await selectAssetsBuild(tx, plan.base)) ?? plan.base))
  await sealBuild(deps, storeId, runId, { files })
}
