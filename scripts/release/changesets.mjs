import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const corePackage = '@dripfunnel/storefront-core'
const coreDir = 'packages/storefront-core/'

// The changelog is written by `changeset version`, so changing it alone needs no changeset.
export const touchesCore = (files) => files.some((f) => f.startsWith(coreDir) && f !== `${coreDir}CHANGELOG.md`)

const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/

/** The bump a changeset file gives the core package, or undefined when it doesn't name it. */
export const coreBump = (text) => {
  const head = frontMatter.exec(text)?.[1] ?? ''
  for (const line of head.split(/\r?\n/)) {
    const match = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/.exec(line)
    if (match?.[1]?.trim() === corePackage) return match[2]
  }
  return undefined
}

/** docs/code/ARCHITECTURE.md §5: a change to storefront-core carries a changeset naming it. */
export const changesetProblem = (changedFiles, addedChangesets) => {
  if (!touchesCore(changedFiles)) return undefined
  if (addedChangesets.some((text) => coreBump(text))) return undefined
  return `This pull request changes ${corePackage} but adds no changeset for it. Run \`pnpm changeset\`, pick the bump (docs/code/ARCHITECTURE.md §5) and commit the file.`
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const checkPullRequest = () => {
  const { BASE_SHA: base, HEAD_SHA: head } = process.env
  if (!base || !head) throw new Error('BASE_SHA and HEAD_SHA are required')
  const lines = (s) => s.split('\n').filter(Boolean)
  const changed = lines(git('diff', '--name-only', `${base}...${head}`))
  const added = lines(git('diff', '--name-only', '--diff-filter=A', `${base}...${head}`, '--', '.changeset/*.md'))
  const problem = changesetProblem(changed, added.map((f) => git('show', `${head}:${f}`)))
  if (problem) {
    console.error(problem)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv[2] !== 'check-pr') {
    console.error('Usage: changesets.mjs check-pr')
    process.exit(2)
  }
  checkPullRequest()
}
