import { z } from 'zod'
import { lockedWorkflowFile } from '#integrations/github/oidc'
import { coreVersionPattern, isRefreshedPath, isRepoPath, isThemeMediaPath, isThemePath } from './paths'

// Where the Worker reads the templates (storefront ARCHITECTURE §2.3): the release workflow writes each core version's
// skeleton, themes and prebuilt preview bundles under `templates/{core}/` in the sites bucket, then points
// `templates/current.json` at it.

/** The parts of an R2 binding the storefront steps use; R2Bucket is one. */
export interface SitesBucket {
  get: (key: string) => Promise<{ size: number; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>
  put: (key: string, value: ArrayBuffer, options: { sha256: string; httpMetadata?: { contentType?: string } }) => Promise<{ checksums: { sha256?: ArrayBuffer } } | null>
  list: (options: { prefix: string; cursor?: string }) => Promise<{ objects: { key: string; uploaded: Date }[]; truncated: boolean; cursor?: string }>
  delete: (keys: string[]) => Promise<void>
}

/** The release hasn't uploaded what the step asks for: retrying won't bring it. */
export class TemplateMissing extends Error {
  override name = 'TemplateMissing'
}

const semver = z.string().regex(coreVersionPattern)
// A theme image is its bytes as base64, and only an image is (ARCHITECTURE §3.4 "Images", `ThemeFile.encoding`).
const fileSchema = z
  .strictObject({ path: z.string().refine(isRepoPath), content: z.string(), encoding: z.literal('base64').optional() })
  .refine((f) => (f.encoding === 'base64') === isThemeMediaPath(f.path))
const sourceSchema = z.strictObject({ files: z.array(fileSchema).max(1000) })
const manifestSchema = z.strictObject({ files: z.array(z.strictObject({ path: z.string().refine(isRepoPath), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(2000) })

const templateRoot = (core: string, template: string) => `templates/${core}/themes/${template}/`

const readJson = async <S extends z.ZodType>(bucket: SitesBucket, key: string, schema: S): Promise<z.infer<S>> => {
  const object = await bucket.get(key)
  if (!object) throw new TemplateMissing(`${key} is missing`)
  let json: unknown
  try {
    json = JSON.parse(await object.text())
  } catch {
    throw new TemplateMissing(`${key} isn't JSON`)
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new TemplateMissing(`${key} isn't in the shape the release writes`)
  return parsed.data
}

export const currentCore = async (bucket: SitesBucket): Promise<string> => (await readJson(bucket, 'templates/current.json', z.strictObject({ core: semver }))).core

export type RepoFiles = z.infer<typeof sourceSchema>['files']

/** Everything but the theme, the locked workflow and package.json included. */
const skeletonOf = async (bucket: SitesBucket, core: string): Promise<RepoFiles> => {
  const skeleton = (await readJson(bucket, `templates/${core}/skeleton.json`, sourceSchema)).files
  const paths = new Set(skeleton.map((f) => f.path))
  if (!paths.has(lockedWorkflowFile) || !paths.has('package.json') || skeleton.some((f) => isThemePath(f.path))) throw new TemplateMissing('the skeleton lacks its workflow or package.json, or carries a theme')
  return skeleton
}

/** The skeleton and the template's theme. */
export const templateFiles = async (bucket: SitesBucket, core: string, template: string): Promise<{ skeleton: RepoFiles; theme: RepoFiles }> => {
  const skeleton = await skeletonOf(bucket, core)
  const theme = (await readJson(bucket, `${templateRoot(core, template)}source.json`, sourceSchema)).files
  if (!theme.some((f) => isThemePath(f.path)) || !theme.every((f) => isThemePath(f.path) || isThemeMediaPath(f.path))) throw new TemplateMissing(`the ${template} theme writes outside ARCHITECTURE §3.4's paths`)
  return { skeleton, theme }
}

/** An upgrade's template files (ARCHITECTURE §7.1): `to`'s skeleton, and as null the files only `from`'s had. */
export const skeletonRefresh = async (bucket: SitesBucket, from: string, to: string): Promise<{ path: string; content: string | null }[]> => {
  const next = (await skeletonOf(bucket, to)).filter((f) => isRefreshedPath(f.path))
  const kept = new Set(next.map((f) => f.path))
  const dropped = from === to ? [] : (await skeletonOf(bucket, from)).filter((f) => isRefreshedPath(f.path) && !kept.has(f.path))
  return [...next, ...dropped.map((f) => ({ path: f.path, content: null }))]
}

export const previewManifest = async (bucket: SitesBucket, core: string, template: string) =>
  (await readJson(bucket, `${templateRoot(core, template)}preview/manifest.json`, manifestSchema)).files

export const previewSource = (core: string, template: string, path: string) => `${templateRoot(core, template)}preview/files/${path}`

/** R2 copies a preview's files side by side, this many at once, so a template's ~30 files take one delivery's time. */
const copiesAtOnce = 8
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** The template's prebuilt preview copied into `folder` whole, each file confirmed by its hash (SAAS §5 step 7). */
export const copyTemplatePreview = async (bucket: SitesBucket, core: string, template: string, folder: string): Promise<void> => {
  const files = await previewManifest(bucket, core, template)
  const copy = async (file: (typeof files)[number]) => {
    const source = await bucket.get(previewSource(core, template, file.path))
    if (!source) throw new TemplateMissing(`the ${template} preview lacks ${file.path}`)
    const copied = await bucket.put(`${folder}${file.path}`, await source.arrayBuffer(), { sha256: file.sha256, ...(source.httpMetadata ? { httpMetadata: source.httpMetadata } : {}) })
    const written = copied?.checksums.sha256
    // Confirmed from the copy's result, never assumed.
    if (!written || hex(written) !== file.sha256) throw new Error(`template preview: ${file.path} wasn't copied whole`)
  }
  for (let at = 0; at < files.length; at += copiesAtOnce) await Promise.all(files.slice(at, at + copiesAtOnce).map(copy))
}

export const deletePrefix = async (bucket: SitesBucket, prefix: string): Promise<void> => {
  for (;;) {
    const listed = await bucket.list({ prefix })
    if (listed.objects.length > 0) await bucket.delete(listed.objects.map((o) => o.key))
    if (!listed.truncated) return
  }
}
