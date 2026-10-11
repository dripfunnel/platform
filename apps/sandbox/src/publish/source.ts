import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ThemeFile } from '@dripfunnel/storefront-core/guard'
import { gitIn } from '../git'
import { isThemePath } from '../paths'

// The frozen source (storefront LIVE-SHOP §4 step 3): a git bundle and the commit to build, checked out offline into a
// folder of the step's own, so the build and the check each read the same theme without trusting the other.

export const commitPattern = /^[0-9a-f]{40}$/

/** Checks `commit` out of `bundle` into `dir` (replaced whole), and answers the theme's files at it. */
export const checkout = async (bundle: string, commit: string, dir: string): Promise<ThemeFile[]> => {
  if (!commitPattern.test(commit)) throw new Error('Name the commit to build by its full id.')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const git = gitIn(dir, dir)
  await git(['init', '--quiet'])
  await git(['fetch', '--quiet', '--no-tags', bundle, `+refs/heads/*:refs/remotes/source/*`])
  await git(['checkout', '--quiet', '--detach', commit])
  const paths = (await git(['ls-files', '-z'])).split('\0').filter(isThemePath).sort()
  return Promise.all(paths.map(async (path) => ({ path, content: await readFile(join(dir, path), 'utf8') })))
}
