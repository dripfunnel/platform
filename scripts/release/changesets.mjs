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

/**
 * docs/code/ARCHITECTURE.md §5: a change to storefront-core adds a changeset naming it. Exempt: a release PR
 * (new version, its changelog heading, the core changesets it consumed) and a promotion to main carrying one.
 */
export const changesetProblem = (changedFiles, addedChangesets, { deletedChangesets = [], versionChanged = false, changelogHeading = false, intoMain = false } = {}) => {
  if (!touchesCore(changedFiles)) return undefined
  if (addedChangesets.some((text) => coreBump(text))) return undefined
  const released = versionChanged && changelogHeading
  if (released && (intoMain || deletedChangesets.some((text) => coreBump(text)))) return undefined
  return `This pull request changes ${corePackage} but adds no changeset for it. Run \`pnpm changeset\`, pick the bump (docs/code/ARCHITECTURE.md §5) and commit the file.`
}

/** Whether a changelog diff adds the `## <version>` heading `changeset version` writes. */
export const addsChangelogHeading = (diff, version) => diff.split('\n').some((line) => line.trim() === `+## ${version}`)

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const checkPullRequest = () => {
  const { BASE_SHA: base, HEAD_SHA: head } = process.env
  if (!base || !head) throw new Error('BASE_SHA and HEAD_SHA are required')
  const lines = (s) => s.split('\n').filter(Boolean)
  const changed = lines(git('diff', '--name-only', '--no-renames', `${base}...${head}`))
  const changesets = (filter) => lines(git('diff', '--name-only', '--no-renames', `--diff-filter=${filter}`, `${base}...${head}`, '--', '.changeset/*.md'))
  const mergeBase = git('merge-base', base, head)
  const version = (rev) => JSON.parse(git('show', `${rev}:${coreDir}package.json`)).version
  const problem = changesetProblem(
    changed,
    changesets('A').map((f) => git('show', `${head}:${f}`)),
    {
      deletedChangesets: changesets('D').map((f) => git('show', `${mergeBase}:${f}`)),
      versionChanged: version(mergeBase) !== version(head),
      changelogHeading: addsChangelogHeading(git('diff', `${base}...${head}`, '--', `${coreDir}CHANGELOG.md`), version(head)),
      intoMain: process.env.BASE_REF === 'main',
    },
  )
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
