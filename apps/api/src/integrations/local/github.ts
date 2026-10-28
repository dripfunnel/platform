import { jwtVerify } from 'jose'

// GitHub's REST API for store repos, in memory (docs/setup/local.md §6.1): the stand-in GITHUB_LOCAL runs the real App
// client against, and the tests' fake. Repos last as long as the isolate; nothing reaches GitHub.

interface Commit {
  tree: string
  parents: string[]
  message: string
  date: string
}

interface Repo {
  id: number
  name: string
  private: boolean
  main: string | null
  commits: Map<string, Commit>
  trees: Map<string, Map<string, string>>
  settings: Record<string, unknown>
}

export interface LocalGitHub {
  fetch: typeof fetch
  /** Every repo by name, in the one org the stand-in serves. */
  repos: Map<string, Repo>
  /** Each workflow run the platform started, in order; nothing runs it locally. */
  dispatches: { repo: string; workflow: string; ref: string; inputs: Record<string, unknown> }[]
  /** The permissions each installation token asked for. */
  grants: Record<string, string>[]
  /** Every request as `METHOD path`, in order. */
  calls: string[]
  /** The next `times` requests `matching` answer `status`. */
  fail: (matching: RegExp, status: number, times?: number) => void
  /** The files at `main`, or null when the repo doesn't exist. */
  files: (name: string) => Map<string, string> | null
  history: (name: string) => Commit[]
  /** Every installation token stops working, as at expiry or revocation. */
  revokeTokens: () => void
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
const hash = async (value: unknown) => hex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(value))))
const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Unique across stand-ins and restarts, as GitHub's own ids are: `storefront.repo_id` keeps them (#517).
const repoId = (): number => {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2))
  return (high % 2 ** 20) * 2 ** 32 + low + 1
}

/** `verifyKey` checks the App's JWT as GitHub would; without it any JWT-shaped bearer gets a token. */
export const localGitHub = ({ org, installationId, appId, verifyKey }: { org: string; installationId: string; appId: string; verifyKey?: CryptoKey }): LocalGitHub => {
  const repos = new Map<string, Repo>()
  const tokens = new Set<string>()
  const grants: Record<string, string>[] = []
  const calls: string[] = []
  const dispatches: LocalGitHub['dispatches'] = []
  const failures: { matching: RegExp; status: number; times: number }[] = []

  const storeTree = async (repo: Repo, files: Map<string, string>) => {
    const sha = await hash([...files].sort(([a], [b]) => a.localeCompare(b)))
    repo.trees.set(sha, files)
    return sha
  }

  const storeCommit = async (repo: Repo, commit: Commit) => {
    const sha = await hash(commit)
    repo.commits.set(sha, commit)
    return sha
  }

  const descends = (repo: Repo, from: string, ancestor: string): boolean => {
    const seen = new Set<string>()
    const queue = [from]
    while (queue.length > 0) {
      const at = queue.pop() ?? ''
      if (at === ancestor) return true
      if (seen.has(at)) continue
      seen.add(at)
      queue.push(...(repo.commits.get(at)?.parents ?? []))
    }
    return false
  }

  const handle = async (method: string, path: string, authorization: string, body: Record<string, unknown>): Promise<Response> => {
    const bearer = authorization.replace(/^Bearer /, '')
    if (method === 'POST' && path === `/app/installations/${installationId}/access_tokens`) {
      if (verifyKey) {
        const verified = await jwtVerify(bearer, verifyKey, { issuer: appId, algorithms: ['RS256'] }).catch(() => null)
        if (!verified) return reply(401, { message: 'A JSON web token could not be decoded' })
      } else if (bearer.split('.').length !== 3) return reply(401, { message: 'A JSON web token could not be decoded' })
      const token = `ghs_local${crypto.randomUUID().replaceAll('-', '')}`
      tokens.add(token)
      grants.push(body['permissions'] as Record<string, string>)
      return reply(201, { token, expires_at: new Date(Date.now() + 3_600_000).toISOString() })
    }
    if (!tokens.has(bearer)) return reply(401, { message: 'Bad credentials' })

    if (method === 'POST' && path === `/orgs/${org}/repos`) {
      const name = String(body['name'])
      if (repos.has(name)) return reply(422, { message: 'name already exists on this account' })
      const repo: Repo = { id: repoId(), name, private: body['private'] === true, main: null, commits: new Map(), trees: new Map(), settings: {} }
      if (body['auto_init'] === true) {
        const tree = await storeTree(repo, new Map([['README.md', `# ${name}\n`]]))
        repo.main = await storeCommit(repo, { tree, parents: [], message: 'Initial commit', date: new Date().toISOString() })
      }
      repos.set(name, repo)
      return reply(201, { id: repo.id, name, private: repo.private })
    }
    const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path)
    const repo = match?.[1] === org ? repos.get(decodeURIComponent(match[2] ?? '')) : undefined
    if (!repo) return reply(404, { message: 'Not Found' })
    const rest = match?.[3] ?? ''

    if (rest === '' && method === 'GET') return reply(200, { id: repo.id, name: repo.name, private: repo.private, default_branch: 'main' })
    if (rest === '' && method === 'DELETE') {
      repos.delete(repo.name)
      return reply(204)
    }
    if (method === 'PUT' && rest.startsWith('/actions/permissions')) {
      repo.settings[rest] = body
      return reply(204)
    }
    if (method === 'GET' && rest === '/git/ref/heads/main') return repo.main ? reply(200, { object: { sha: repo.main } }) : reply(409, { message: 'Git Repository is empty.' })
    const commitPath = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest)
    if (method === 'GET' && commitPath) {
      const commit = repo.commits.get(commitPath[1] ?? '')
      return commit ? reply(200, { sha: commitPath[1], tree: { sha: commit.tree }, parents: commit.parents.map((sha) => ({ sha })), message: commit.message }) : reply(404, { message: 'Not Found' })
    }
    const treePath = /^\/git\/trees\/([0-9a-f]{40})\?recursive=1$/.exec(rest)
    if (method === 'GET' && treePath) {
      const files = repo.trees.get(treePath[1] ?? '')
      return files ? reply(200, { sha: treePath[1], truncated: false, tree: [...files.keys()].map((p) => ({ path: p, type: 'blob', mode: '100644' })) }) : reply(404, { message: 'Not Found' })
    }
    if (method === 'POST' && rest === '/git/trees') {
      const base = typeof body['base_tree'] === 'string' ? repo.trees.get(body['base_tree']) : new Map<string, string>()
      if (!base) return reply(422, { message: 'base_tree is not a valid tree' })
      const files = new Map(base)
      for (const entry of body['tree'] as { path: string; content?: string; sha?: null }[]) {
        if (entry.content === undefined) files.delete(entry.path)
        else files.set(entry.path, entry.content)
      }
      return reply(201, { sha: await storeTree(repo, files) })
    }
    if (method === 'POST' && rest === '/git/commits') {
      const parents = body['parents'] as string[]
      const tree = String(body['tree'])
      if (!repo.trees.has(tree) || parents.some((p) => !repo.commits.has(p))) return reply(422, { message: 'Tree or parent SHA does not exist' })
      const date = (body['committer'] as { date?: string } | undefined)?.date ?? new Date().toISOString()
      return reply(201, { sha: await storeCommit(repo, { tree, parents, message: String(body['message']), date }) })
    }
    const comparePath = /^\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(rest)
    if (method === 'GET' && comparePath) {
      const [, base = '', head = ''] = comparePath
      if (!repo.commits.has(base) || !repo.commits.has(head)) return reply(404, { message: 'Not Found' })
      const status = base === head ? 'identical' : descends(repo, head, base) ? 'ahead' : descends(repo, base, head) ? 'behind' : 'diverged'
      return reply(200, { status })
    }
    const dispatch = /^\/actions\/workflows\/([^/]+)\/dispatches$/.exec(rest)
    if (method === 'POST' && dispatch) {
      dispatches.push({ repo: repo.name, workflow: decodeURIComponent(dispatch[1] ?? ''), ref: String(body['ref']), inputs: (body['inputs'] ?? {}) as Record<string, unknown> })
      return reply(204)
    }
    if (method === 'PATCH' && rest === '/git/refs/heads/main') {
      const sha = String(body['sha'])
      if (!repo.commits.has(sha)) return reply(422, { message: 'Object does not exist' })
      if (body['force'] !== true && repo.main && !descends(repo, sha, repo.main)) return reply(422, { message: 'Update is not a fast forward' })
      repo.main = sha
      return reply(200, { object: { sha } })
    }
    return reply(404, { message: 'Not Found' })
  }

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = `${url.pathname}${url.search}`
    calls.push(`${method} ${path}`)
    const failure = failures.find((f) => f.times > 0 && f.matching.test(`${method} ${path}`))
    if (failure) {
      failure.times -= 1
      return reply(failure.status, { message: 'Injected failure' })
    }
    const headers = new Headers(init?.headers)
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    return handle(method, path, headers.get('authorization') ?? '', body)
  }

  return {
    fetch: fetchImpl as typeof fetch,
    repos,
    dispatches,
    grants,
    calls,
    fail: (matching, status, times = 1) => {
      failures.push({ matching, status, times })
    },
    files: (name) => {
      const repo = repos.get(name)
      const main = repo?.main ? repo.commits.get(repo.main) : undefined
      return repo && main ? new Map(repo.trees.get(main.tree)) : null
    },
    revokeTokens: () => {
      tokens.clear()
    },
    history: (name) => {
      const repo = repos.get(name)
      const out: Commit[] = []
      for (let at = repo?.main ?? null; at && repo; at = repo.commits.get(at)?.parents[0] ?? null) {
        const commit = repo.commits.get(at)
        if (commit) out.push(commit)
      }
      return out
    },
  }
}
