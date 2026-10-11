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
  /** A tree from `base` (or empty) with the changes applied. */
  writeTree: (name: string, base: string | null, changes: readonly RepoChange[]) => Promise<string>
  commit: (name: string, commit: NewCommit) => Promise<string>
  /** Moves `main` to `commit` only as a fast-forward; false when `main` has moved on. */
  advance: (name: string, commit: string) => Promise<boolean>
  /** Whether `commit` is `head` or in its history. */
  reaches: (name: string, head: string, commit: string) => Promise<boolean>
  /** Starts the locked workflow on `main` (storefront LIVE-SHOP §4 step 4); a repo GitHub doesn't know is false. */
  dispatchBuild: (name: string, inputs: { build_id: string; api: string }) => Promise<boolean>
}

/** The store repo's one workflow (LIVE-SHOP §3). */
export const buildWorkflow = 'build.yml'

const sha = z.string().regex(/^[0-9a-f]{40}$/)
const repoSchema = z.object({ id: z.number() }).loose()
const refSchema = z.object({ object: z.object({ sha }).loose() }).loose()
const commitSchema = z.object({ sha, tree: z.object({ sha }).loose() }).loose()
const treeSchema = z.object({ sha, truncated: z.boolean().optional(), tree: z.array(z.object({ path: z.string(), type: z.string() }).loose()) }).loose()
const created = z.object({ sha }).loose()
const compareSchema = z.object({ status: z.string() }).loose()

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
  }
}
