import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import type { GuardContext } from '@dripfunnel/storefront-core/guard'
import { bundle, runtimeFolder, type ClientBundle } from './gate/bundle'
import { build, validate, type GateProblem } from './gate/index'
import { gitIn, type Git } from './git'
import { isRepoPath, isThemePath } from './paths'

/** One file the model's diff writes, or removes when `content` is null (storefront AI-STUDIO §4 step 2). */
export type FileChange = { path: string; content: string | null }

export type ChangeResult =
  | { ok: true; changed: boolean; commit: string; bundle: ClientBundle }
  | { ok: false; problems: GateProblem[] }

export type Loaded = { head: string; bundle: ClientBundle | null; problems: GateProblem[] }

export class NotLoaded extends Error {
  override name = 'NotLoaded'
  constructor() {
    super('No draft is loaded in this slot.')
  }
}

const branch = 'main'

/** One store's working copy and its current client bundle; the server keeps one per slot. */
export class Workspace {
  private readonly repo: string
  private readonly client: string
  private readonly git: Git
  private current: ClientBundle | null = null
  private loaded = false

  constructor(private readonly dir: string) {
    this.repo = join(dir, 'repo')
    this.client = join(dir, 'client')
    this.git = gitIn(this.repo, dir)
  }

  /**
   * Replaces the working copy with a git bundle of the draft (or the live build's source), then bundles it. `at` resets
   * the branch to that commit, which must be in the bundle: a live build's source may hold commits past the build's own.
   */
  async loadBundle(bytes: Buffer, at: string | null = null): Promise<Loaded> {
    await this.reset()
    const file = join(this.dir, 'incoming.bundle')
    await writeFile(file, bytes)
    await gitIn(this.dir, this.dir)(['clone', '--quiet', '--branch', branch, file, this.repo])
    await rm(file, { force: true })
    await this.git(['remote', 'remove', 'origin'])
    if (at) await this.git(['reset', '--quiet', '--hard', `${at}^{commit}`])
    return this.afterLoad()
  }

  /** Starts a working copy from files (a template's skeleton and theme) as its first commit. */
  async loadFiles(files: readonly { path: string; content: string }[], message: string): Promise<Loaded> {
    if (!files.every((f) => isRepoPath(f.path))) throw new Error('A file path climbs out of the repo.')
    await this.reset()
    await mkdir(this.repo, { recursive: true })
    await this.git(['init', '--quiet', '--initial-branch', branch])
    for (const f of files) await this.write(f.path, f.content)
    await this.git(['add', '--all'])
    await this.git(['commit', '--quiet', '--message', message])
    return this.afterLoad()
  }

  async head(): Promise<string> {
    this.mustBeLoaded()
    return (await this.git(['rev-parse', 'HEAD'])).trim()
  }

  /** The theme as it is at the head: the paths ARCHITECTURE §3.4 lets the AI write, and nothing else. */
  async theme(): Promise<Map<string, string>> {
    this.mustBeLoaded()
    const paths = (await this.git(['ls-files', '-z'])).split('\0').filter(isThemePath)
    return new Map(await Promise.all(paths.map(async (p) => [p, await readFile(join(this.repo, p), 'utf8')] as const)))
  }

  /** The theme at an earlier commit of the draft, for the push once a publish of it is live (AI-STUDIO §6 step 4). */
  async themeAt(commit: string): Promise<Map<string, string>> {
    this.mustBeLoaded()
    const paths = (await this.git(['ls-tree', '-r', '-z', '--name-only', `${commit}^{commit}`])).split('\0').filter(isThemePath)
    return new Map(await Promise.all(paths.map(async (p) => [p, await this.git(['show', `${commit}:${p}`])] as const)))
  }

  /** Applies a change and runs the fast gate; on a pass it is a local commit, on a failure nothing changed at all. */
  async change(files: readonly FileChange[], message: string, context: GuardContext): Promise<ChangeResult> {
    const theme = await this.theme()
    for (const f of files) {
      if (f.content === null) theme.delete(f.path)
      else theme.set(f.path, f.content)
    }
    const refused = validate([...theme].map(([path, content]) => ({ path, content })), context)
    if (refused.length > 0) return { ok: false, problems: refused }
    // The validator accepted every path, so each is one of §3.4's; checked again before it touches the disk.
    if (!files.every((f) => isThemePath(f.path))) throw new Error('A validated path is outside the theme.')
    for (const f of files) {
      if (f.content === null) await rm(join(this.repo, f.path), { force: true })
      else await this.write(f.path, f.content)
    }
    const next = join(this.client, 'next')
    const gated = await build(theme, this.repo, next)
    if (!gated.ok) {
      await this.discard()
      await rm(next, { recursive: true, force: true })
      return gated
    }
    await this.git(['add', '--all'])
    const staged = (await this.git(['diff', '--cached', '--name-only'])).trim()
    if (staged !== '') await this.git(['commit', '--quiet', '--message', message])
    await this.promote(next, gated.bundle)
    return { ok: true, changed: staged !== '', commit: await this.head(), bundle: gated.bundle }
  }

  /** "Undo this change" (AI-STUDIO §5): the files `commit` changed, put back as they were before it, through the gate. */
  async undo(commit: string, message: string, context: GuardContext): Promise<ChangeResult> {
    this.mustBeLoaded()
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Name a commit by its full id.')
    const parent = (await this.git(['rev-list', '--parents', '-n', '1', commit])).trim().split(' ')[1]
    if (!parent) return { ok: false, problems: [{ step: 'validator', file: null, line: null, rule: 'undo/first-commit', message: 'The first version of the draft has nothing before it to go back to.' }] }
    const paths = (await this.git(['diff', '--name-only', '-z', parent, commit])).split('\0').filter((p) => p !== '')
    const files = await Promise.all(paths.map(async (path): Promise<FileChange> => ({ path, content: await this.at(parent, path) })))
    return this.change(files, message, context)
  }

  /** The repo and its history as one file, for `drafts/{store}.bundle` (AI-STUDIO §4 step 6). */
  async exportBundle(): Promise<Buffer> {
    this.mustBeLoaded()
    const file = join(this.dir, 'outgoing.bundle')
    await this.git(['bundle', 'create', '--quiet', file, branch])
    const bytes = await readFile(file)
    await rm(file, { force: true })
    return bytes
  }

  bundleNow(): ClientBundle | null {
    return this.current
  }

  /** A file of the current client bundle; `assets/core/*` comes from the image's runtime (gate/bundle.ts). */
  async clientFile(path: string, runtimeDir: string): Promise<Buffer | null> {
    const clean = normalize(path)
    if (clean.startsWith('..') || clean.startsWith('/') || !this.current) return null
    const file = clean.startsWith(runtimeFolder) ? join(runtimeDir, clean.slice(runtimeFolder.length)) : join(this.client, 'current', clean)
    if (!clean.startsWith(runtimeFolder) && !this.current.files.some((f) => f.path === clean)) return null
    return readFile(file).catch(() => null)
  }

  /** The current bundle's own files with their hashes, for the preview folder (PREVIEW §4 step 2). */
  async previewFiles(): Promise<{ id: string; files: { path: string; sha256: string; base64: string }[] } | null> {
    if (!this.current) return null
    const files = await Promise.all(
      this.current.files.map(async (f) => {
        const bytes = await readFile(join(this.client, 'current', f.path))
        return { path: f.path, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') }
      }),
    )
    return { id: this.current.id, files }
  }

  private async afterLoad(): Promise<Loaded> {
    this.loaded = true
    const next = join(this.client, 'next')
    const bundled = await bundle(this.repo, next)
    if (bundled.ok) await this.promote(next, bundled.bundle)
    return { head: await this.head(), bundle: bundled.ok ? bundled.bundle : null, problems: bundled.ok ? [] : bundled.problems }
  }

  private async promote(next: string, b: ClientBundle) {
    const current = join(this.client, 'current')
    await rm(current, { recursive: true, force: true })
    await rename(next, current)
    this.current = b
  }

  private async at(rev: string, path: string): Promise<string | null> {
    const listed = (await this.git(['ls-tree', '--name-only', rev, '--', path])).trim()
    return listed === path ? this.git(['show', `${rev}:${path}`]) : null
  }

  private async discard() {
    await this.git(['reset', '--quiet', '--hard', 'HEAD'])
    await this.git(['clean', '--quiet', '-fd'])
  }

  private async write(path: string, content: string) {
    const file = join(this.repo, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }

  private async reset() {
    this.loaded = false
    this.current = null
    await rm(this.dir, { recursive: true, force: true })
    await mkdir(this.dir, { recursive: true })
  }

  private mustBeLoaded() {
    if (!this.loaded) throw new NotLoaded()
  }
}
