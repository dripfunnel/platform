import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { applyCodemods, baselineWithOwn, changesBetween, notesBetween, pinCore, type GuardContext, type UpgradeNote } from '@dripfunnel/storefront-core/guard'
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

/** The upgrade bot's commit: every file it wrote or removed, package.json included, and the notes it applied. */
export type Upgraded = { commit: string; files: FileChange[]; notes: Pick<UpgradeNote, 'version' | 'kind' | 'notes'>[] }

export type UpgradeInput = { from: string; to: string; message: string; baseline: { path: string; content: string }[] | null }

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

  /** Replaces the working copy with a git bundle of the draft (or the live build's source), then bundles it. */
  async loadBundle(bytes: Buffer): Promise<Loaded> {
    await this.reset()
    const file = join(this.dir, 'incoming.bundle')
    await writeFile(file, bytes)
    await gitIn(this.dir, this.dir)(['clone', '--quiet', '--branch', branch, file, this.repo])
    await rm(file, { force: true })
    await this.git(['remote', 'remove', 'origin'])
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

  /**
   * The upgrade bot's commit on the loaded live commit (storefront ARCHITECTURE §7.1): core pinned to `to`, with the
   * codemods of every release after `from` applied, or the baseline theme with the store's own words and tokens. No gate
   * runs here: the publish's full gate judges the commit.
   */
  async upgrade(input: UpgradeInput, notes: readonly UpgradeNote[]): Promise<Upgraded> {
    const theme = await this.theme()
    const applied = input.baseline ? [] : notesBetween(input.from, input.to, notes)
    const next = input.baseline ? baselineWithOwn(new Map(input.baseline.map((f) => [f.path, f.content])), theme) : applyCodemods(theme, applied.flatMap((n) => n.codemods))
    if (![...next.keys()].every(isThemePath)) throw new Error('An upgrade wrote outside the theme.')
    const changes = changesBetween(theme, next)
    const pkg = pinCore(await readFile(join(this.repo, 'package.json'), 'utf8'), input.to)
    try {
      for (const f of changes) {
        if (f.content === null) await rm(join(this.repo, f.path), { force: true })
        else await this.write(f.path, f.content)
      }
      await this.write('package.json', pkg)
      await this.git(['add', '--all'])
      if ((await this.git(['diff', '--cached', '--name-only'])).trim() !== '') await this.git(['commit', '--quiet', '--message', input.message])
    } catch (error) {
      // Nothing half-written may ride along with the next operation's commit.
      await this.discard()
      throw error
    }
    return { commit: await this.head(), files: [...changes, { path: 'package.json', content: pkg }], notes: applied.map(({ version, kind, notes: words }) => ({ version, kind, notes: words })) }
  }

  /** The bundle a rebase moves the draft onto, kept beside the working copy until the rebase reads it. */
  async receiveOnto(bytes: Buffer): Promise<void> {
    this.mustBeLoaded()
    await writeFile(join(this.dir, 'onto.bundle'), bytes)
  }

  /**
   * The draft's own changes moved onto `onto`, the upgrade bot's commit (AI-STUDIO §6 step 2), then the fast gate again;
   * a conflict or a refusal leaves the draft exactly as it was.
   */
  async rebase(onto: string, context: GuardContext): Promise<ChangeResult> {
    this.mustBeLoaded()
    const file = join(this.dir, 'onto.bundle')
    const before = await this.head()
    try {
      await this.git(['fetch', '--quiet', file, `+${branch}:refs/df/onto`])
      const reached = await this.git(['merge-base', '--is-ancestor', onto, before]).then(() => true, () => false)
      if (reached) return { ok: true, changed: false, commit: before, bundle: this.current ?? (await this.rebundle()) }
      try {
        await this.git(['rebase', '--quiet', onto])
      } catch {
        await this.git(['rebase', '--abort']).catch(() => undefined)
        await this.git(['reset', '--quiet', '--hard', before])
        return { ok: false, problems: [{ step: 'validator', file: null, line: null, rule: 'rebase/conflict', message: 'The draft and the core update change the same lines of the theme.' }] }
      }
      const next = join(this.client, 'next')
      try {
        const theme = await this.theme()
        const refused = validate([...theme].map(([path, content]) => ({ path, content })), context)
        const gated = refused.length > 0 ? { ok: false as const, problems: refused } : await build(theme, this.repo, next)
        if (!gated.ok) {
          await this.git(['reset', '--quiet', '--hard', before])
          await rm(next, { recursive: true, force: true })
          return gated
        }
        await this.promote(next, gated.bundle)
        return { ok: true, changed: true, commit: await this.head(), bundle: gated.bundle }
      } catch (error) {
        await this.git(['reset', '--quiet', '--hard', before])
        await rm(next, { recursive: true, force: true })
        throw error
      }
    } finally {
      await rm(file, { force: true })
      await this.git(['update-ref', '-d', 'refs/df/onto']).catch(() => undefined)
    }
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

  private async rebundle(): Promise<ClientBundle> {
    const next = join(this.client, 'next')
    const bundled = await bundle(this.repo, next)
    if (!bundled.ok) throw new Error('The draft no longer bundles.')
    await this.promote(next, bundled.bundle)
    return bundled.bundle
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
