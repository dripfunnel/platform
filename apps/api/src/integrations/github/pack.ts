import { GitHubUnavailable, noAnswer } from './app'

// A pushed commit's whole history as a git bundle (#968; storefront LIVE-SHOP.md §4 step 3), read from the public repo
// with git's own HTTP protocol (version 2 `fetch`), since the Worker has no git. Nothing is sent but the commit's id.

export const gitHost = 'https://github.com'

/** A store repo is a theme and its history; the answer and the bundle must both fit in a Worker's 128 MB. */
export const maxPackBytes = 25 * 1024 * 1024
const timeoutMs = 60_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const pkt = (line: string) => `${(line.length + 4).toString(16).padStart(4, '0')}${line}`

/** `command=fetch` for one commit, ending with `done` so the answer is the pack itself. */
export const fetchRequest = (commit: string): string => `${pkt('command=fetch\n')}${pkt('agent=dripfunnel\n')}0001${pkt(`want ${commit}\n`)}${pkt('ofs-delta\n')}${pkt('no-progress\n')}${pkt('done\n')}0000`

/** The pack's pieces from an answer's `packfile` section, in order; null when GitHub refused or the answer is cut short. */
export const packOf = (answer: Uint8Array): Uint8Array[] | null => {
  const chunks: Uint8Array[] = []
  let at = 0
  let inPack = false
  for (;;) {
    const length = decoder.decode(answer.subarray(at, at + 4))
    if (!/^[0-9a-f]{4}$/.test(length)) return null
    const size = Number.parseInt(length, 16)
    if (size < 4) {
      at += 4
      // The flush after the pack ends it; before it, a flush or a delimiter only ends a section.
      if (inPack && size === 0) break
      continue
    }
    if (at + size > answer.length) return null
    const line = answer.subarray(at + 4, at + size)
    at += size
    if (!inPack) {
      const text = decoder.decode(line)
      if (text.startsWith('ERR ')) return null
      inPack = text === 'packfile\n'
      continue
    }
    // Band 1 is the pack, 2 progress, 3 a fatal error (gitprotocol-v2, `packfile`).
    if (line[0] === 3) return null
    if (line[0] === 1) chunks.push(line.subarray(1))
  }
  return decoder.decode(chunks[0]?.subarray(0, 4)) === 'PACK' ? chunks : null
}

/** A bundle with `main` at `commit` and no prerequisites, as `git bundle create` writes it; the build fetches `refs/heads/*`. */
export const bundleOf = (commit: string, pack: readonly Uint8Array[]): ArrayBuffer => {
  const header = encoder.encode(`# v2 git bundle\n${commit} refs/heads/main\n\n`)
  const bundle = new Uint8Array(header.length + pack.reduce((n, chunk) => n + chunk.length, 0))
  bundle.set(header)
  let at = header.length
  for (const chunk of pack) {
    bundle.set(chunk, at)
    at += chunk.length
  }
  return bundle.buffer
}

/** The answer's bytes, read no further than the cap; null past it. */
const readCappedAnswer = async (response: Response): Promise<Uint8Array | null> => {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxPackBytes) {
      void reader.cancel()
      return null
    }
    parts.push(value)
  }
  const answer = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    answer.set(part, at)
    at += part.length
  }
  return answer
}

/** The bundle, or null when GitHub has no such repo or commit, or it is too large; GitHubUnavailable for a retry. */
export const fetchCommitBundle = async (org: string, repo: string, commit: string, fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer | null> => {
  let response: Response
  let answer: Uint8Array | null
  try {
    response = await fetchImpl(`${gitHost}/${encodeURIComponent(org)}/${encodeURIComponent(repo)}.git/git-upload-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-git-upload-pack-request', accept: 'application/x-git-upload-pack-result', 'git-protocol': 'version=2' },
      body: fetchRequest(commit),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 404) return null
    if (!response.ok) throw new GitHubUnavailable(`GitHub answered the fetch with ${response.status}`, response.status)
    answer = await readCappedAnswer(response)
  } catch (error) {
    if (error instanceof GitHubUnavailable) throw error
    throw new GitHubUnavailable(noAnswer)
  }
  const pack = answer ? packOf(answer) : null
  return pack ? bundleOf(commit, pack) : null
}
