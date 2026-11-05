import { describe, expect, it, vi } from 'vitest'

// Tailwind's compiler refusing a theme.css the CSS rules let through: the validator refuses it, and doesn't keep the failure.
vi.mock('tailwindcss', async (original) => {
  const real = await original<typeof import('tailwindcss')>()
  return { ...real, __unstable__loadDesignSystem: vi.fn(real.__unstable__loadDesignSystem).mockRejectedValueOnce(new Error('Unknown theme value')) }
})

const { checkClasses } = await import('./tailwind')

const files = new Map([
  ['src/theme/styles/theme.css', '@theme {\n  --color-ink: #1d1b18;\n}\n'],
  ['src/theme/pages/HomePage.tsx', 'export const HomePage = () => <p className="bg-ink" />\n'],
])
const context = { locales: ['en'], usedPaths: [], mediaIds: [], brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] } }

describe('a theme.css Tailwind can’t read', () => {
  it('is refused with its rule, and the next check reads it afresh', async () => {
    expect((await checkClasses(files, context)).map((p) => ({ file: p.file, rule: p.rule, message: p.message }))).toEqual([
      { file: 'src/theme/styles/theme.css', rule: 'css/theme-entry', message: "Tailwind can't read theme.css: Unknown theme value" },
    ])
    expect(await checkClasses(files, context)).toEqual([])
  })
})
