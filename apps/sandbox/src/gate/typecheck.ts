import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { isThemeCode } from '../paths'
import type { GateProblem } from './problems'

// The theme compiles against core's public types and the allowlisted libraries the image carries (ARCHITECTURE §3.3
// "A build that breaks"); bare imports resolve from the sandbox's own packages, never from the store's repo.
const root = '/__theme__'
const cssModules = `${root}/css-modules.d.ts`
const cssModulesText = "declare module '*.module.css' { const classes: { readonly [name: string]: string }; export default classes }\n"
const resolveFrom = fileURLToPath(import.meta.url)

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
}

// A builder program needs every source file's version; a library's text never changes in one image.
const versioned = (file: ts.SourceFile, version: string): ts.SourceFile => Object.assign(file, { version })
const libraries = new Map<string, ts.SourceFile>()

// Core's Translate names only core's own keys, so a theme's `t('pages.home.title')` can't type; the validator checks
// every such key against content/** in every language instead (ARCHITECTURE §3.4 "t()").
const notAssignable = 2345
const translateKeys = (file: ts.SourceFile): Set<number> => {
  const starts = new Set<number>()
  const visit = (node: ts.Node) => {
    const [first] = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' ? node.arguments : []
    if (first && ts.isStringLiteralLike(first)) starts.add(first.getStart(file))
    ts.forEachChild(node, visit)
  }
  visit(file)
  return starts
}

const inTheme = (f: string) => f.startsWith(`${root}/`)

const virtualOf = (files: ReadonlyMap<string, string>): Map<string, string> => {
  const virtual = new Map<string, string>([[cssModules, cssModulesText]])
  for (const [path, text] of files) if (isThemeCode(path)) virtual.set(`${root}/${path}`, text)
  return virtual
}

/** The theme's files from `virtual`, through `theme` (which may hand back a file it made before); libraries from the image. */
const hostFor = (virtual: ReadonlyMap<string, string>, theme: (fileName: string, text: string) => ts.SourceFile): ts.CompilerHost => {
  const base = ts.createCompilerHost(options, true)
  const host: ts.CompilerHost = {
    ...base,
    getCurrentDirectory: () => root,
    writeFile: () => undefined,
    fileExists: (f) => virtual.has(f) || (!inTheme(f) && base.fileExists(f)),
    readFile: (f) => virtual.get(f) ?? (inTheme(f) ? undefined : base.readFile(f)),
    directoryExists: (d) => (inTheme(`${d}/`) ? [...virtual.keys()].some((f) => f.startsWith(`${d}/`)) : (base.directoryExists?.(d) ?? false)),
    getSourceFile: (fileName, version) => {
      const text = virtual.get(fileName)
      if (text !== undefined) return theme(fileName, text)
      if (inTheme(fileName)) return undefined
      const cached = libraries.get(fileName)
      if (cached) return cached
      const parsed = base.getSourceFile(fileName, version)
      if (parsed) libraries.set(fileName, versioned(parsed, '0'))
      return parsed
    },
    resolveModuleNameLiterals: (literals, containing) =>
      literals.map((l) => ({ resolvedModule: ts.resolveModuleName(l.text, inTheme(containing) && !l.text.startsWith('.') ? resolveFrom : containing, options, host).resolvedModule })),
  }
  return host
}

const parse = (fileName: string, text: string) => ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2023, true, fileName.endsWith('.d.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX)

const problemsOf = (diagnostics: readonly ts.Diagnostic[]): GateProblem[] =>
  diagnostics
    .filter((d) => (d.file === undefined || inTheme(d.file.fileName)) && !(d.code === notAssignable && d.file && translateKeys(d.file).has(d.start ?? -1)))
    .map((d) => ({
      step: 'typecheck' as const,
      file: d.file ? d.file.fileName.slice(root.length + 1) : null,
      line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null,
      rule: `ts/${d.code}`,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    }))

/** Type errors in the theme's own .tsx files; `files` is the whole theme as it would be after the change. */
export const typecheck = (files: ReadonlyMap<string, string>): GateProblem[] => {
  const virtual = virtualOf(files)
  const program = ts.createProgram({ rootNames: [...virtual.keys()], options, host: hostFor(virtual, parse) })
  return problemsOf(ts.getPreEmitDiagnostics(program))
}

export type WarmCheck = { problems: GateProblem[]; checked: string[] }

/**
 * One slot's typecheck kept warm between changes (#1240): a builder program over the last one, so a change rechecks only
 * the files it touched and those whose types depend on them; the diagnostics are getPreEmitDiagnostics' own, in its order.
 */
export const warmTypecheck = (): ((files: ReadonlyMap<string, string>) => WarmCheck) => {
  const made = new Map<string, ts.SourceFile>()
  let builder: ts.SemanticDiagnosticsBuilderProgram | undefined
  return (files) => {
    const virtual = virtualOf(files)
    for (const name of made.keys()) if (!virtual.has(name)) made.delete(name)
    const theme = (fileName: string, text: string) => {
      const had = made.get(fileName)
      if (had?.text === text) return had
      const file = versioned(parse(fileName, text), createHash('sha256').update(text).digest('hex'))
      made.set(fileName, file)
      return file
    }
    builder = ts.createSemanticDiagnosticsBuilderProgram([...virtual.keys()], options, hostFor(virtual, theme), builder)
    const checked: string[] = []
    for (let next = builder.getSemanticDiagnosticsOfNextAffectedFile(); next; next = builder.getSemanticDiagnosticsOfNextAffectedFile()) {
      const affected = next.affected
      if ('fileName' in affected && inTheme(affected.fileName) && affected.fileName !== cssModules) checked.push(affected.fileName.slice(root.length + 1))
    }
    const diagnostics = [...builder.getConfigFileParsingDiagnostics(), ...builder.getOptionsDiagnostics(), ...builder.getSyntacticDiagnostics(), ...builder.getGlobalDiagnostics(), ...builder.getSemanticDiagnostics()]
    return { problems: problemsOf(ts.sortAndDeduplicateDiagnostics(diagnostics)), checked }
  }
}
