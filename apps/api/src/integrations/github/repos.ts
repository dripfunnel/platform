import { z } from 'zod'
import { GitHubUnavailable, type GitHubCall } from './app'

// Store repos through the App (storefront LIVE-SHOP.md §3): public, opaque names, `main` moved only by fast-forward.
// Everything is text: theme code, content, JSON and the locked workflow.

export interface RepoChange {
  path: string
  /** The new text, or null to delete the file. */
  content: string | null
}

export interface NewCommit {
  tree: string
  parent: string
  message: string
  /** Author and committer date: the same inputs make the same commit, so a retried push can't make a second one. */
  at: Date
}

export interface StoreRepos {
  find: (name: string) => Promise<{ id: number } | null>
  /** Creates the public repo with its first commit on `main`, or returns it when it already exists. */
  create: (name: string) => Promise<{ id: number }>
  /** A repo GitHub doesn't know is already gone. */
  remove: (name: string) => Promise<void>
  /** Actions on, GitHub's own actions only, read-only workflow token, every outside contributor's run approved first. */
  lockActions: (name: string) => Promise<void>
  head: (name: string) => Promise<string | null>
  treeOf: (name: string, commit: string) => Promise<string>
  paths: (name: string, tree: string) => Promise<string[]>
  /** The text of the theme's files at `commit` (the only files a design reads a merchant's image from, AI-STUDIO §8). */
  themeText: (name: string, commit: string) => Promise<string>
  /** The images in `src/theme/media/` at `commit` (ARCHITECTURE §3.4 "Images"), named without their extension, within its caps. */
  themeMedia: (name: string, commit: string) => Promise<ThemeImageFile[]>
  /** A tree from `base` (or empty) with the changes applied. */
  writeTree: (name: string, base: string | null, changes: readonly RepoChange[]) => Promise<string>
  commit: (name: string, commit: NewCommit) => Promise<string>
  /** Moves `main` to `commit` only as a fast-forward; false when `main` has moved on. */
  advance: (name: string, commit: string) => Promise<boolean>
  /** Whether `commit` is `head` or in its history. */
  reaches: (name: string, head: string, commit: string) => Promise<boolean>
  /** Starts the locked workflow on `main` (storefront LIVE-SHOP §4 step 4); a repo GitHub doesn't know is false. */
  dispatchBuild: (name: string, inputs: { build_id: string; api: string }) => Promise<boolean>
  /** The id of `.github`'s tree at `commit`, which changes with any file under it; null when there is none. */
  lockedTree: (name: string, commit: string) => Promise<string | null>
}

export interface ThemeImageFile {
  name: string
  bytes: Uint8Array<ArrayBuffer>
}

/** The store repo's one workflow (LIVE-SHOP §3). */
export const buildWorkflow = 'build.yml'

// A copy of core's guard (`mediaPath`, `maxMedia*`), which can't be bundled into the Worker (saas/storefronts/paths.ts).
const mediaPath = /^src\/theme\/media\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.(?:png|jpg|jpeg|webp)$/
const mediaCaps = { files: 100, bytes: 2 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 }

const sha = z.string().regex(/^[0-9a-f]{40}$/)
const repoSchema = z.object({ id: z.number() }).loose()
const refSchema = z.object({ object: z.object({ sha }).loose() }).loose()
const commitSchema = z.object({ sha, tree: z.object({ sha }).loose() }).loose()
const treeSchema = z.object({ sha, truncated: z.boolean().optional(), tree: z.array(z.object({ path: z.string(), type: z.string(), sha: sha.optional(), size: z.number().optional() }).loose()) }).loose()
const blobSchema = z.object({ content: z.string() }).loose()
const created = z.object({ sha }).loose()
const compareSchema = z.object({ status: z.string() }).loose()
const entriesSchema = z.object({ tree: z.array(z.object({ path: z.string(), type: z.string(), sha }).loose()) }).loose()

// The platform's own name on every commit; never a merchant's (AI-STUDIO.md §6).
const author = { name: 'DripFunnel', email: 'noreply@dripfunnel.com' }

const read = <S extends z.ZodType>(schema: S, body: unknown): z.infer<S> => {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new GitHubUnavailable('GitHub answered in a shape we do not read')
  return parsed.data
}

export const storeRepos = (call: GitHubCall, org: string): StoreRepos => {
  const repo = (name: string) => `/repos/${encodeURIComponent(org)}/${encodeURIComponent(name)}`

  const find = async (name: string) => {
    const answer = await call('GET', repo(name), undefined, [404])
    return answer.status === 404 ? null : { id: read(repoSchema, answer.body).id }
  }

  const filesAt = async (name: string, commit: string): Promise<{ path: string; sha: string; size?: number | undefined }[]> => {
    const tree = read(commitSchema, (await call('GET', `${repo(name)}/git/commits/${commit}`)).body).tree.sha
    const listed = read(treeSchema, (await call('GET', `${repo(name)}/git/trees/${tree}?recursive=1`)).body)
    if (listed.truncated) throw new GitHubUnavailable('GitHub listed the tree in part')
    return listed.tree.flatMap((e) => (e.type === 'blob' && e.sha ? [{ path: e.path, sha: e.sha, size: e.size }] : []))
  }

  const blob = async (name: string, sha: string): Promise<Uint8Array<ArrayBuffer>> => {
    const text = atob(read(blobSchema, (await call('GET', `${repo(name)}/git/blobs/${sha}`)).body).content.replaceAll('\n', ''))
    // A plain loop: `Uint8Array.from` with a map callback is far slower on a push's 20 MB of images (#1427).
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i)
    return bytes
  }

  return {
    find,
    create: async (name) => {
      const answer = await call(
        'POST',
        `/orgs/${encodeURIComponent(org)}/repos`,
        { name, private: false, auto_init: true, has_issues: false, has_wiki: false, has_projects: false, has_discussions: false },
        [422],
      )
      if (answer.status !== 422) return { id: read(repoSchema, answer.body).id }
      // 422 is "name already exists" when a retry follows a create whose answer was lost.
      const existing = await find(name)
      if (!existing) throw new GitHubUnavailable('GitHub refused the repo and has none by its name')
      return existing
    },
    remove: async (name) => {
      await call('DELETE', repo(name), undefined, [404])
    },
    lockActions: async (name) => {
      await call('PUT', `${repo(name)}/actions/permissions`, { enabled: true, allowed_actions: 'selected' })
      await call('PUT', `${repo(name)}/actions/permissions/selected-actions`, { github_owned_allowed: true, verified_allowed: false, patterns_allowed: [] })
      await call('PUT', `${repo(name)}/actions/permissions/workflow`, { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false })
      await call('PUT', `${repo(name)}/actions/permissions/fork-pr-contributor-approval`, { approval_policy: 'all_external_contributors' })
    },
    head: async (name) => {
      // 409 is an empty repo, which `create` never leaves.
      const answer = await call('GET', `${repo(name)}/git/ref/heads/main`, undefined, [404, 409])
      return answer.status === 200 ? read(refSchema, answer.body).object.sha : null
    },
    treeOf: async (name, commit) => read(commitSchema, (await call('GET', `${repo(name)}/git/commits/${commit}`)).body).tree.sha,
    paths: async (name, tree) => {
      const listed = read(treeSchema, (await call('GET', `${repo(name)}/git/trees/${tree}?recursive=1`)).body)
      if (listed.truncated) throw new GitHubUnavailable('GitHub listed the tree in part')
      return listed.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path)
    },
    themeText: async (name, commit) => {
      const theme = (await filesAt(name, commit)).filter((e) => e.path.startsWith('src/theme/') || e.path.startsWith('content/') || e.path === 'routes.json')
      const texts = await Promise.all(theme.map(async (e) => new TextDecoder().decode(await blob(name, e.sha))))
      return texts.join('\n')
    },
    themeMedia: async (name, commit) => {
      const images: ThemeImageFile[] = []
      let total = 0
      for (const e of await filesAt(name, commit)) {
        const image = mediaPath.exec(e.path)?.[1]
        if (!image || (e.size ?? 0) > mediaCaps.bytes) continue
        const bytes = await blob(name, e.sha)
        if (bytes.byteLength > mediaCaps.bytes || total + bytes.byteLength > mediaCaps.totalBytes) continue
        total += bytes.byteLength
        images.push({ name: image, bytes })
        if (images.length === mediaCaps.files) break
      }
      return images
    },
    writeTree: async (name, base, changes) => {
      const tree = changes.map((c) => (c.content === null ? { path: c.path, mode: '100644', type: 'blob', sha: null } : { path: c.path, mode: '100644', type: 'blob', content: c.content }))
      return read(created, (await call('POST', `${repo(name)}/git/trees`, base === null ? { tree } : { base_tree: base, tree })).body).sha
    },
    commit: async (name, c) => {
      const signature = { ...author, date: c.at.toISOString() }
      return read(created, (await call('POST', `${repo(name)}/git/commits`, { message: c.message, tree: c.tree, parents: [c.parent], author: signature, committer: signature })).body).sha
    },
    advance: async (name, commit) => {
      const answer = await call('PATCH', `${repo(name)}/git/refs/heads/main`, { sha: commit, force: false }, [422])
      return answer.status !== 422
    },
    reaches: async (name, head, commit) => {
      const answer = await call('GET', `${repo(name)}/compare/${commit}...${head}`, undefined, [404])
      return answer.status !== 404 && ['ahead', 'identical'].includes(read(compareSchema, answer.body).status)
    },
    dispatchBuild: async (name, inputs) => (await call('POST', `${repo(name)}/actions/workflows/${buildWorkflow}/dispatches`, { ref: 'main', inputs }, [404], { once: true })).status !== 404,
    lockedTree: async (name, commit) => {
      const root = read(commitSchema, (await call('GET', `${repo(name)}/git/commits/${commit}`)).body).tree.sha
      const entries = read(entriesSchema, (await call('GET', `${repo(name)}/git/trees/${root}`)).body).tree
      return entries.find((entry) => entry.path === '.github' && entry.type === 'tree')?.sha ?? null
    },
  }
}
