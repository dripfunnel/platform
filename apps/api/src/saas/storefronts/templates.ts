import { z } from 'zod'
import { lockedWorkflowFile } from '#integrations/github/oidc'
import { isRepoPath, isThemePath } from './paths'

// Where the Worker reads the templates (storefront ARCHITECTURE §2.3): the release workflow writes each core version's
// skeleton, themes and prebuilt preview bundles under `templates/{core}/` in the sites bucket, then points
// `templates/current.json` at it.

/** The parts of an R2 binding the storefront steps use; R2Bucket is one. */
export interface SitesBucket {
  get: (key: string) => Promise<{ text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>
  put: (key: string, value: ArrayBuffer, options: { sha256: string; httpMetadata?: { contentType?: string } }) => Promise<{ checksums: { sha256?: ArrayBuffer } } | null>
  list: (options: { prefix: string; cursor?: string }) => Promise<{ objects: { key: string; uploaded: Date }[]; truncated: boolean; cursor?: string }>
  delete: (keys: string[]) => Promise<void>
}

/** The release hasn't uploaded what the step asks for: retrying won't bring it. */
export class TemplateMissing extends Error {
  override name = 'TemplateMissing'
}

const semver = z.string().regex(/^\d+\.\d+\.\d+$/)
const fileSchema = z.strictObject({ path: z.string().refine(isRepoPath), content: z.string() })
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

/** The skeleton (everything but the theme, the locked workflow included) and the template's theme. */
export const templateFiles = async (bucket: SitesBucket, core: string, template: string): Promise<{ skeleton: RepoFiles; theme: RepoFiles }> => {
  const skeleton = (await readJson(bucket, `templates/${core}/skeleton.json`, sourceSchema)).files
  const theme = (await readJson(bucket, `${templateRoot(core, template)}source.json`, sourceSchema)).files
  const paths = new Set(skeleton.map((f) => f.path))
  if (!paths.has(lockedWorkflowFile) || !paths.has('package.json') || skeleton.some((f) => isThemePath(f.path))) throw new TemplateMissing('the skeleton lacks its workflow or package.json, or carries a theme')
  if (theme.length === 0 || !theme.every((f) => isThemePath(f.path))) throw new TemplateMissing(`the ${template} theme writes outside ARCHITECTURE §3.4's paths`)
  return { skeleton, theme }
}

export const previewManifest = async (bucket: SitesBucket, core: string, template: string) =>
  (await readJson(bucket, `${templateRoot(core, template)}preview/manifest.json`, manifestSchema)).files

export const previewSource = (core: string, template: string, path: string) => `${templateRoot(core, template)}preview/files/${path}`

export const deletePrefix = async (bucket: SitesBucket, prefix: string): Promise<void> => {
  for (;;) {
    const listed = await bucket.list({ prefix })
    if (listed.objects.length > 0) await bucket.delete(listed.objects.map((o) => o.key))
    if (!listed.truncated) return
  }
}
