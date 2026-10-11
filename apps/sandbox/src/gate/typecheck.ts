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

/** Type errors in the theme's own .tsx files; `files` is the whole theme as it would be after the change. */
export const typecheck = (files: ReadonlyMap<string, string>): GateProblem[] => {
  const virtual = new Map<string, string>([[cssModules, cssModulesText]])
  for (const [path, text] of files) if (isThemeCode(path)) virtual.set(`${root}/${path}`, text)
  const base = ts.createCompilerHost(options, true)
  const inTheme = (f: string) => f.startsWith(`${root}/`)
  const host: ts.CompilerHost = {
    ...base,
    getCurrentDirectory: () => root,
    writeFile: () => undefined,
    fileExists: (f) => virtual.has(f) || (!inTheme(f) && base.fileExists(f)),
    readFile: (f) => virtual.get(f) ?? (inTheme(f) ? undefined : base.readFile(f)),
    directoryExists: (d) => (inTheme(`${d}/`) ? [...virtual.keys()].some((f) => f.startsWith(`${d}/`)) : (base.directoryExists?.(d) ?? false)),
    getSourceFile: (fileName, version) => {
      const text = virtual.get(fileName)
      if (text !== undefined) return ts.createSourceFile(fileName, text, version, true, fileName.endsWith('.d.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX)
      if (inTheme(fileName)) return undefined
      const cached = libraries.get(fileName)
      if (cached) return cached
      const parsed = base.getSourceFile(fileName, version)
      if (parsed) libraries.set(fileName, parsed)
      return parsed
    },
    resolveModuleNameLiterals: (literals, containing) =>
      literals.map((l) => ({ resolvedModule: ts.resolveModuleName(l.text, inTheme(containing) && !l.text.startsWith('.') ? resolveFrom : containing, options, host).resolvedModule })),
  }
  const program = ts.createProgram({ rootNames: [...virtual.keys()], options, host })
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => (d.file === undefined || inTheme(d.file.fileName)) && !(d.code === notAssignable && d.file && translateKeys(d.file).has(d.start ?? -1)))
    .map((d) => ({
      step: 'typecheck' as const,
      file: d.file ? d.file.fileName.slice(root.length + 1) : null,
      line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null,
      rule: `ts/${d.code}`,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    }))
}
