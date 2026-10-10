import { z } from 'zod'

/** Every rule the validator applies (storefront ARCHITECTURE §3.4). The ids are stable: the repair loop keys on them. */
export const ruleIds = [
  'files/path-not-allowed',
  'files/duplicate-path',
  'files/symlink',
  'files/locale-not-offered',
  'files/file-too-large',
  'files/too-many-files',
  'files/theme-too-large',
  'code/unreadable',
  'code/import-not-allowed',
  'code/motion-outside-interactive',
  'code/dynamic-import',
  'code/script-url',
  'code/browser-global',
  'code/string-timer',
  'code/dom-walking',
  'code/prototype-access',
  'code/declaration-not-allowed',
  'code/directive-not-allowed',
  'code/use-client-outside-interactive',
  'code/text-in-string',
  'code/url-in-code',
  'code/brand-literal',
  'code/t-key-not-literal',
  'code/core-type-cast',
  'jsx/element-not-allowed',
  'jsx/attribute-not-allowed',
  'jsx/dangerous-html',
  'jsx/text-literal',
  'jsx/loading-hint',
  'jsx/core-marker',
  'jsx/animated-property',
  'css/unreadable',
  'css/selector-not-scoped',
  'css/global',
  'css/pseudo-not-allowed',
  'css/at-rule-not-allowed',
  'css/url-not-media',
  'css/function-not-allowed',
  'css/core-selector',
  'css/z-index',
  'css/animated-property',
  'css/text',
  'css/composes',
  'content/unreadable',
  'content/missing-file',
  'content/missing-key',
  'content/price',
  'content/scarcity',
  'content/urgency',
  'content/rating',
  'content/countdown',
  'content/brand-literal',
  'routes/missing',
  'routes/invalid',
  'routes/route-not-mapped',
  'routes/page-not-found',
  'routes/path-reserved',
  'routes/path-in-use',
  'routes/commerce-page',
] as const

export type RuleId = (typeof ruleIds)[number]

/** One reason a change is refused. `line` is null when the rule judges a whole file; `file` is null when it judges the whole change. */
export type Problem = { file: string | null; line: number | null; rule: RuleId; message: string }

/** `ok` only when there is no problem at all: one bad file refuses the whole change. */
export type GuardResult = { ok: boolean; problems: Problem[] }

export const problem = (file: string | null, line: number | null, rule: RuleId, message: string): Problem => ({ file, line, rule, message })

/** A language as the store lists it, such as "en", "hi" or "en-IN". */
export const localePattern = /^[a-z]{2,3}(?:-[A-Z]{2})?$/

/** One file of the theme as it would be after the change; `symlink` when the caller found a link rather than a file. */
export const themeFileSchema = z.strictObject({
  path: z.string(),
  content: z.string(),
  symlink: z.boolean().optional(),
})

export type ThemeFile = z.infer<typeof themeFileSchema>

const brandText = z.string().trim().max(500).nullable()

/** What the platform knows about the store, passed in so the sandbox needs no network (ARCHITECTURE §3.1). */
export const guardContextSchema = z.strictObject({
  /** The languages the store offers; the theme's words exist in every one. */
  locales: z.array(z.string().regex(localePattern)).min(1).max(50),
  /** The paths the store's content pages and blog posts already use (SAPI 24). */
  usedPaths: z.array(z.string().max(512)).max(10_000),
  /** The store's media ids, the only values a CSS url() may name. */
  mediaIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(10_000),
  /** Site settings the theme reads through useStorefront() and never copies (DESIGN §2). */
  brand: z.strictObject({
    name: z.string().trim().min(1).max(200),
    tagline: brandText,
    email: brandText,
    phone: brandText,
    address: z.array(z.string().trim().max(200)).max(10),
    socialLinks: z.array(z.string().trim().max(500)).max(20),
  }),
})

export type GuardContext = z.infer<typeof guardContextSchema>
