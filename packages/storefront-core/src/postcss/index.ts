/// <reference types="node" />
import { join, relative, sep } from 'node:path'
import { readThemeStyling, themeStylesheet } from '../guard/tailwind.js'

// A store repo's `next dev` builds the theme's classes with core's own compiler and checks, so the locked build makes
// exactly the CSS the sandbox would (storefront ARCHITECTURE §2.2, §3.4 "Classes"; #1239).

const name = 'dripfunnel-storefront-tailwind'
/** The locked file the plugin fills; every other stylesheet passes through untouched. */
export const tailwindEntry = 'src/app/tailwind.css'

type Root = { source?: { input: { file?: string } }; removeAll: () => unknown; append: (...nodes: unknown[]) => unknown }
type Helpers = { result: { messages: unknown[] }; postcss: { parse: (css: string, options: { from: string }) => unknown } }

export const storefrontTailwind = (options: { root?: string } = {}) => {
  const root = options.root ?? process.cwd()
  return {
    postcssPlugin: name,
    async Once(css: Root, { result, postcss }: Helpers) {
      const from = css.source?.input.file
      if (!from || relative(root, from).split(sep).join('/') !== tailwindEntry) return
      result.messages.push({ type: 'dir-dependency', plugin: name, dir: join(root, 'src/theme'), glob: '**/*', parent: from })
      const built = await themeStylesheet(readThemeStyling(root))
      if (!built.ok) throw new Error(`The theme's classes break the theme rules; run pnpm check:\n${built.problems.map((p) => `${p.file ?? 'theme'}:${p.line ?? 1}  ${p.rule}  ${p.message}`).join('\n')}`)
      css.removeAll()
      if (built.css) css.append(postcss.parse(built.css, { from }))
    },
  }
}
storefrontTailwind.postcss = true

// eslint-disable-next-line no-restricted-syntax -- Next's postcss.config names a plugin as a module, loaded by its default export.
export default storefrontTailwind
