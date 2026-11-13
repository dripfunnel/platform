import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, sep } from 'node:path'
import { applyCodemods, baselineWithOwn, changesBetween, mediaFolder, notesBetween, pinCore, type GuardContext, type UpgradeNote } from '@dripfunnel/storefront-core/guard'
import { runtimeFolder, type ClientBundle } from './gate/bundle'
import { WarmGate, type GateProblem, type Lane, type ThemeImages } from './gate/index'
import { imageThemeFiles } from './gate/media'
import { laneOf } from './gate/lanes'
import { pagePicture, type Device, type Picture } from './gate/picture'
import { gitIn, type Git } from './git'
import { isRepoPath, isRefreshedPath, isThemePath } from './paths'

/** One file the model's diff writes, or removes when `content` is null (storefront AI-STUDIO §4 step 2). */
export type FileChange = { path: string; content: string | null }

/** How the frame takes a new bundle: the stylesheet alone when every script is the one it has (AI-STUDIO §4 step 5). */
export type Swap = 'stylesheet' | 'modules'

/** `typechecked`: the theme files the warm typecheck checked again, null when the lane skipped it (#1240). */
export type ChangeResult =
  | { ok: true; changed: boolean; commit: string; bundle: ClientBundle; lane?: Lane; swap?: Swap; typechecked?: string[] | null }
  | { ok: false; problems: GateProblem[] }

/** A pre-check of the change so far, while the model is still writing it: nothing is written or kept but the warm state. */
export type Prechecked = { lane: Lane; problems: GateProblem[] }

export type Loaded = { head: string; bundle: ClientBundle | null; problems: GateProblem[] }
export type Shown = { ok: true; bundle: ClientBundle; swap: Swap } | { ok: false }

/** The upgrade bot's commit: every file it wrote or removed, package.json included, and the notes it applied. */
export type Upgraded = { commit: string; files: FileChange[]; notes: Pick<UpgradeNote, 'version' | 'kind' | 'notes'>[] }

/** `skeleton`: core `to`'s template files, and as null those only `from`'s had (storefront ARCHITECTURE §7.1). */
export type UpgradeInput = { from: string; to: string; message: string; baseline: { path: string; content: string }[] | null; skeleton: FileChange[] }

export class NotLoaded extends Error {
  override name = 'NotLoaded'
  constructor() {
    super('No draft is loaded in this slot.')
  }
}

const branch = 'main'
const refused = (rule: string, message: string): ChangeResult => ({ ok: false, problems: [{ step: 'validator', file: null, line: null, rule, message }] })

const withChange = (theme: ReadonlyMap<string, string>, files: readonly FileChange[]): Map<string, string> => {
  const next = new Map(theme)
  for (const f of files) {
    if (f.content === null) next.delete(f.path)
    else next.set(f.path, f.content)
  }
  return next
}

const scripts = (b: ClientBundle) => b.files.filter((f) => f.path.endsWith('.js')).map((f) => f.path).sort().join('\n')

// A theme's own images come only from a person's push (#1405); the studio picks from Assets instead.
const studioImageProblems = (files: readonly FileChange[]): GateProblem[] =>
  files
    .filter((f) => f.path.startsWith(mediaFolder))
    .map((f) => ({ step: 'validator', file: f.path, line: null, rule: 'studio/media-not-allowed', message: "The studio can't add, change or remove the theme's own images in src/theme/media/; use an image from Assets." }))

/** One store's working copy and its current client bundle; the server keeps one per slot. */
export class Workspace {
  private readonly repo: string
  private readonly client: string
  private readonly git: Git
  private current: ClientBundle | null = null
  private loaded = false
  private gate: WarmGate
  // The theme's own images by the git tree that holds them: a studio change never touches them, so each is read once.
  private images: ThemeImages | null = null

  constructor(private readonly dir: string) {
    this.repo = join(dir, 'repo')
    this.client = join(dir, 'client')
    this.git = gitIn(this.repo, dir)
    this.gate = new WarmGate(this.repo, join(this.client, 'next'))
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

  /** The head's own images, read again only when the git tree holding them changes. */
  private async headImages(): Promise<ThemeImages> {
    const tree = await this.git(['rev-parse', `HEAD:${mediaFolder.slice(0, -1)}`]).then((t) => t.trim(), () => '')
    if (this.images?.tree !== tree) this.images = { tree, files: tree ? await imageThemeFiles(this.repo) : [] }
    return this.images
  }

  /** The validator, then the typecheck unless the lane skips it, on the theme with `files`; nothing is written. */
  async precheck(files: readonly FileChange[], context: GuardContext): Promise<Prechecked> {
    const before = await this.theme()
    const theme = withChange(before, files)
    const lane = laneOf(before, files)
    const touched = studioImageProblems(files)
    if (touched.length > 0) return { lane, problems: touched }
    const problems = await this.gate.validate(theme, context, await this.headImages())
    return { lane, problems: lane === 'full' ? [...problems, ...this.gate.typecheck(theme).problems] : problems }
  }

  /** The agent's passing work, bundled for the frame and never committed (AI-STUDIO §4 "The agent"); no `files` shows the head again. */
  async show(files: readonly FileChange[], context: GuardContext): Promise<Shown> {
    if (studioImageProblems(files).length > 0 || !files.every((f) => isThemePath(f.path))) return { ok: false }
    const theme = withChange(await this.theme(), files)
    if ((await this.gate.validate(theme, context, await this.headImages())).length > 0) return { ok: false }
    const next = join(this.client, 'next')
    try {
      for (const f of files) {
        if (f.content === null) await rm(join(this.repo, f.path), { force: true })
        else await this.write(f.path, f.content)
      }
      const bundled = await this.gate.bundle()
      if (!bundled.ok) return { ok: false }
      const swap: Swap = this.current && scripts(this.current) === scripts(bundled.bundle) ? 'stylesheet' : 'modules'
      await this.promote(next, bundled.bundle)
      return { ok: true, bundle: bundled.bundle, swap }
    } finally {
      await this.discard()
      await rm(next, { recursive: true, force: true })
    }
  }

  /** Checks the loaded theme once, so the first change's typecheck is already warm. */
  async prime(): Promise<void> {
    if (this.loaded) this.gate.typecheck(await this.theme())
  }

  /** Applies a change and runs the fast gate; on a pass it is a local commit, on a failure nothing changed at all. */
  async change(files: readonly FileChange[], message: string, context: GuardContext): Promise<ChangeResult> {
    const touched = studioImageProblems(files)
    if (touched.length > 0) return { ok: false, problems: touched }
    const before = await this.theme()
    const theme = withChange(before, files)
    // The sandbox chooses the lane from the diff, never the model (ARCHITECTURE §6.2).
    const lane = laneOf(before, files)
    const refused = await this.gate.validate(theme, context, await this.headImages())
    if (refused.length > 0) return { ok: false, problems: refused }
    // The validator accepted every path, so each is one of §3.4's; checked again before it touches the disk.
    if (!files.every((f) => isThemePath(f.path))) throw new Error('A validated path is outside the theme.')
    for (const f of files) {
      if (f.content === null) await rm(join(this.repo, f.path), { force: true })
      else await this.write(f.path, f.content)
    }
    const next = join(this.client, 'next')
    const gated = await this.gate.build(theme, lane, context)
    if (!gated.ok) {
      await this.discard()
      await rm(next, { recursive: true, force: true })
      return { ok: false, problems: gated.problems }
    }
    await this.git(['add', '--all'])
    const staged = (await this.git(['diff', '--cached', '--name-only'])).trim()
    if (staged !== '') await this.git(['commit', '--quiet', '--message', message])
    const swap: Swap = this.current && scripts(this.current) === scripts(gated.bundle) ? 'stylesheet' : 'modules'
    await this.promote(next, gated.bundle)
    return { ok: true, changed: staged !== '', commit: await this.head(), bundle: gated.bundle, lane, swap, typechecked: gated.checked }
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
   * codemods of every release after `from` applied, or the baseline theme with the store's own words and tokens, and the
   * template files of `to`. No gate runs here: the publish's full gate judges the commit.
   */
  async upgrade(input: UpgradeInput, notes: readonly UpgradeNote[]): Promise<Upgraded> {
    const theme = await this.theme()
    const applied = input.baseline ? [] : notesBetween(input.from, input.to, notes)
    const next = input.baseline ? baselineWithOwn(new Map(input.baseline.map((f) => [f.path, f.content])), theme) : applyCodemods(theme, applied.flatMap((n) => n.codemods))
    if (![...next.keys()].every(isThemePath)) throw new Error('An upgrade wrote outside the theme.')
    if (!input.skeleton.every((f) => isRefreshedPath(f.path))) throw new Error('An upgrade wrote a file it never refreshes.')
    const changes = [...changesBetween(theme, next), ...(await this.skeletonChanges(input.skeleton))]
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

  /** The skeleton files that differ from the working copy's; removing one it doesn't have changes nothing. */
  private async skeletonChanges(skeleton: readonly FileChange[]): Promise<FileChange[]> {
    const current = await Promise.all(skeleton.map((f) => readFile(join(this.repo, f.path), 'utf8').catch(() => null)))
    return skeleton.filter((f, i) => f.content !== current[i])
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
    const before = await this.head()
    // Only a real conflict is called one: a missing or unrelated commit is a fault in what was sent.
    return this.withOnto(onto, refused('rebase/missing-onto', 'The core update’s commit is not in the bundle sent for it.'), async () => {
      if (!(await this.git(['merge-base', onto, before]).then(() => true, () => false))) return refused('rebase/unrelated', 'The draft and the core update share no history.')
      const reached = await this.git(['merge-base', '--is-ancestor', onto, before]).then(() => true, () => false)
      if (reached) return { ok: true, changed: false, commit: before, bundle: this.current ?? (await this.rebundle()) }
      try {
        await this.git(['rebase', '--quiet', onto])
      } catch {
        await this.git(['rebase', '--abort']).catch(() => undefined)
        await this.git(['reset', '--quiet', '--hard', before])
        return refused('rebase/conflict', 'The draft and the core update change the same lines of the theme.')
      }
      const next = join(this.client, 'next')
      try {
        const theme = await this.theme()
        const refused = await this.gate.validate(theme, context, await this.headImages())
        const gated = refused.length > 0 ? { ok: false as const, problems: refused } : await this.gate.build(theme, 'full', context)
        if (!gated.ok) {
          await this.git(['reset', '--quiet', '--hard', before])
          await rm(next, { recursive: true, force: true })
          return { ok: false, problems: gated.problems }
        }
        await this.promote(next, gated.bundle)
        return { ok: true, changed: true, commit: await this.head(), bundle: gated.bundle }
      } catch (error) {
        await this.git(['reset', '--quiet', '--hard', before])
        await rm(next, { recursive: true, force: true })
        throw error
      }
    })
  }

  /**
   * #1211: the theme files that changed between `from`, the version the draft is based on, and `onto`, a live commit of
   * the received bundle, written into the draft as one change, the live version winning. Nothing is taken when the draft
   * already holds `onto` (a "Publish everything before" of its own earlier change); an unknown `from` is refused.
   */
  async takeLive(from: string, onto: string, context: GuardContext): Promise<ChangeResult> {
    this.mustBeLoaded()
    return this.withOnto(onto, refused('take/missing-onto', 'The live commit is not in the bundle sent for it.'), async () => {
      const has = (args: string[]) => this.git(args).then(() => true, () => false)
      if (!(await has(['cat-file', '-e', `${from}^{commit}`]))) return refused('take/missing-base', 'The commit the draft is based on is not in the draft or the live bundle.')
      const held = await has(['merge-base', '--is-ancestor', onto, 'HEAD'])
      // `-z --name-status` gives a status then a path per file, each ended by NUL; D is a file the live commit deleted.
      const listed = held ? [] : (await this.git(['diff', '--name-status', '-z', '--no-renames', from, onto])).split('\0')
      const files: FileChange[] = []
      for (let i = 0; i + 1 < listed.length; i += 2) {
        const [status, path] = [listed[i], listed[i + 1] ?? '']
        if (isThemePath(path)) files.push({ path, content: status === 'D' ? null : await this.git(['show', `${onto}:${path}`]) })
      }
      if (files.length === 0) return { ok: true, changed: false, commit: await this.head(), bundle: this.current ?? (await this.rebundle()) }
      return this.change(files, `Take the theme live at ${onto.slice(0, 12)}`, context)
    })
  }

  /** `work` with the received bundle fetched as refs/df/onto, or `missing` when `onto` isn't in it; both are gone after. */
  private async withOnto(onto: string, missing: ChangeResult, work: () => Promise<ChangeResult>): Promise<ChangeResult> {
    const file = join(this.dir, 'onto.bundle')
    try {
      const fetched = await this.git(['fetch', '--quiet', file, `+${branch}:refs/df/onto`]).then(() => true, () => false)
      const found = fetched && (await this.git(['merge-base', '--is-ancestor', onto, 'refs/df/onto']).then(() => true, () => false))
      return found ? await work() : missing
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

  /** The current bundle's own files and core's runtime under assets/core/, with their hashes, for the preview folder (PREVIEW §3, §4 step 2). */
  async previewFiles(runtimeDir: string): Promise<{ id: string; files: { path: string; sha256: string; base64: string }[] } | null> {
    if (!this.current) return null
    const runtime = (await readdir(runtimeDir)).map((name) => ({ path: `${runtimeFolder}${name}`, file: join(runtimeDir, name) }))
    const own = this.current.files.map((f) => ({ path: f.path, file: join(this.client, 'current', f.path) }))
    const files = await Promise.all(
      [...own, ...runtime].map(async ({ path, file }) => {
        const bytes = await readFile(file)
        return { path, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') }
      }),
    )
    return { id: this.current.id, files }
  }

  private async rebundle(): Promise<ClientBundle> {
    const next = join(this.client, 'next')
    const bundled = await this.gate.bundle()
    if (!bundled.ok) throw new Error('The draft no longer bundles.')
    await this.promote(next, bundled.bundle)
    return bundled.bundle
  }

  private async afterLoad(): Promise<Loaded> {
    this.loaded = true
    const next = join(this.client, 'next')
    const bundled = await this.gate.bundle()
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

  /**
   * A picture of one page with `files` over the head (AI-STUDIO §4 "The agent"), drawn from a copy: the draft, its commits
   * and its warm gate are never touched, and the copy is gone afterwards.
   */
  async picture(files: readonly FileChange[], page: string, device: Device, context: GuardContext): Promise<Picture> {
    if (!files.every((f) => isThemePath(f.path))) return { images: [], problem: 'A path in the change is outside the theme.' }
    // Nothing reaches the disk, or runs, before every path and line passed the validator (as in change and precheck).
    if ((await this.gate.validate(withChange(await this.theme(), files), context, await this.headImages())).length > 0) return { images: [], problem: 'Call check and fix what it names first.' }
    const scratch = await mkdtemp(join(tmpdir(), 'df-picture-'))
    try {
      const copy = join(scratch, 'repo')
      await cp(this.repo, copy, { recursive: true, filter: (from) => !from.split(sep).includes('.git') })
      for (const f of files) {
        const at = join(copy, normalize(f.path))
        if (f.content === null) await rm(at, { force: true })
        else {
          await mkdir(dirname(at), { recursive: true })
          await writeFile(at, f.content)
        }
      }
      return await pagePicture(copy, join(scratch, 'work'), page, device, context)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }

  private async write(path: string, content: string) {
    const file = join(this.repo, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }

  /** A new draft gets new warm services: nothing checked for the last one is reused (#1240). */
  private async reset() {
    this.loaded = false
    this.current = null
    await this.gate.dispose()
    this.gate = new WarmGate(this.repo, join(this.client, 'next'))
    await rm(this.dir, { recursive: true, force: true })
    await mkdir(this.dir, { recursive: true })
  }

  private mustBeLoaded() {
    if (!this.loaded) throw new NotLoaded()
  }
}
