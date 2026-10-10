import ts from 'typescript'

/** Where the theme's files sit in the in-memory program; nothing is read from or written to it on disk. */
const virtualRoot = '/__dripfunnel_theme__'
export const coreThemeModule = '@dripfunnel/storefront-core/theme'

const cssModules = `${virtualRoot}/css-modules.d.ts`
const cssModulesText = "declare module '*.module.css' { const classes: { readonly [name: string]: string }; export default classes }\n"

const here = (relative: string) => decodeURIComponent(new URL(relative, import.meta.url).pathname)
// Core's theme entry next to this file: the built .d.ts in a store's image, the source in core's own tests.
const themeEntry = [here('../theme/index.d.ts'), here('../theme/index.ts')].find((f) => ts.sys.fileExists(f))
const coreFolder = here('../')
const resolveFrom = here('./program.js')

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

export const inTheme = (fileName: string) => fileName.startsWith(`${virtualRoot}/`)

/** Outside the theme the program reads only type declarations and core's own files, never anything else on the disk. */
const readable = (fileName: string) => fileName.endsWith('.d.ts') || fileName.endsWith('/package.json') || fileName.startsWith(coreFolder)

// Libraries and core's types are parsed once per process; only the theme's files are new each run.
const libraries = new Map<string, ts.SourceFile>()

export type ThemeProgram = { checker: ts.TypeChecker; program: ts.Program; sourceFile: (path: string) => ts.SourceFile | undefined }

/** A type-checked program over the theme's .tsx files, with react and core resolved from where the validator runs. */
export const themeProgram = (code: ReadonlyMap<string, string>): ThemeProgram => {
  if (themeEntry === undefined) throw new Error(`The validator can't find ${coreThemeModule}'s types next to it.`)
  const files = new Map<string, string>([[cssModules, cssModulesText]])
  for (const [path, text] of code) files.set(`${virtualRoot}/${path}`, text)
  const base = ts.createCompilerHost(options, true)

  const resolve = (spec: string, containingFile: string): ts.ResolvedModuleFull | undefined => {
    if (spec === coreThemeModule) return { resolvedFileName: themeEntry, extension: themeEntry.endsWith('.d.ts') ? ts.Extension.Dts : ts.Extension.Ts, isExternalLibraryImport: true }
    const from = inTheme(containingFile) && !spec.startsWith('.') ? resolveFrom : containingFile
    return ts.resolveModuleName(spec, from, options, host).resolvedModule
  }

  const host: ts.CompilerHost = {
    ...base,
    getCurrentDirectory: () => virtualRoot,
    writeFile: () => undefined,
    fileExists: (f) => files.has(f) || (!inTheme(f) && readable(f) && base.fileExists(f)),
    readFile: (f) => files.get(f) ?? (!inTheme(f) && readable(f) ? base.readFile(f) : undefined),
    directoryExists: (d) => (inTheme(`${d}/`) ? [...files.keys()].some((f) => f.startsWith(`${d}/`)) : (base.directoryExists?.(d) ?? false)),
    getSourceFile: (fileName, languageVersion) => {
      const text = files.get(fileName)
      if (text !== undefined) return ts.createSourceFile(fileName, text, languageVersion, true, fileName.endsWith('.d.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX)
      if (!readable(fileName)) return undefined
      const cached = libraries.get(fileName)
      if (cached) return cached
      const parsed = base.getSourceFile(fileName, languageVersion)
      if (parsed) libraries.set(fileName, parsed)
      return parsed
    },
    resolveModuleNameLiterals: (literals, containingFile) => literals.map((l) => ({ resolvedModule: resolve(l.text, containingFile) })),
  }
  if (resolve('react', `${virtualRoot}/x.tsx`) === undefined) throw new Error("The validator can't find react's types.")

  const program = ts.createProgram({ rootNames: [...files.keys()], options, host })
  return { checker: program.getTypeChecker(), program, sourceFile: (path) => program.getSourceFile(`${virtualRoot}/${path}`) }
}

export const lineOf = (node: ts.Node): number => {
  const sf = node.getSourceFile()
  const lead = ts.isJsxText(node) ? node.text.length - node.text.trimStart().length : 0
  return sf.getLineAndCharacterOfPosition(node.getStart(sf) + lead).line + 1
}

export const parts = (type: ts.Type): readonly ts.Type[] => (type.isUnion() ? type.types : [type])

export const isOpen = (type: ts.Type) => parts(type).some((t) => (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0)

/** Every string a type can hold when it is a literal or a union of them, else undefined. */
export const literalStrings = (type: ts.Type): string[] | undefined => {
  const all = parts(type)
  return all.every((t) => t.isStringLiteral()) ? all.map((t) => (t as ts.StringLiteralType).value) : undefined
}

/** The module an identifier was imported from, or undefined when the theme declared it itself. */
export const importedFrom = (checker: ts.TypeChecker, id: ts.Identifier): string | undefined => {
  const decl = checker.getSymbolAtLocation(id)?.declarations?.[0]
  if (!decl) return undefined
  const statement = ts.isImportSpecifier(decl) ? decl.parent.parent.parent : ts.isNamespaceImport(decl) ? decl.parent.parent : ts.isImportClause(decl) ? decl.parent : undefined
  return statement && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined
}
