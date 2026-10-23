import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const appRoot = __dirname
const eslintBin = join(dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js')

type Message = { ruleId: string | null; line: number; message: string }

// Runs the root eslint.config.js on the source as if it were that file of the app.
function lint(file: string, source: string): Message[] {
  const run = spawnSync(process.execPath, [eslintBin, '--stdin', '--stdin-filename', join(appRoot, file), '--format', 'json'], { cwd: appRoot, input: source, encoding: 'utf8' })
  const [result] = JSON.parse(run.stdout) as { messages: Message[] }[]
  return result?.messages ?? []
}

const only = (messages: Message[], ruleId: string) => messages.filter((m) => m.ruleId === ruleId)

describe('the root eslint.config.js for the mobile apps', () => {
  it('lets a mobile app import @dripfunnel/mobile-shared and refuses the SPAs, apps/, shared/ and the other mobile apps', () => {
    const source = [
      "import { createApiClient } from '@dripfunnel/mobile-shared/graphql'",
      "import { client } from '@dripfunnel/shared/graphql'",
      "import { screen } from '../../../../../apps/ui/store/src/screen'",
      "import { tokens } from '../../../shared/ui/tokens'",
      "import { formatMoney } from '../../../shared/format'",
      "import { shopTheme } from '../../../shop/src/theme'",
      "import { App } from '@dripfunnel/mobile-delivery'",
      "import { Redirect } from 'expo-router'",
      "import { PlaceholderScreen } from '../features/placeholder/PlaceholderScreen'",
      'export const used = [createApiClient, client, screen, tokens, formatMoney, shopTheme, App, Redirect, PlaceholderScreen]',
      '',
    ].join('\n')

    const refused = only(lint('src/features/imports.ts', source), 'no-restricted-imports')

    expect(refused.map((m) => m.line)).toEqual([2, 3, 4, 5, 6, 7])
    expect(refused[0]?.message).toContain('docs/mobile-app/README.md')
  })

  it('refuses an import of an app or of the SPAs from mobile-shared, and lets its own files import each other', () => {
    const source = [
      "import { Brand } from '../merchant/src/brand/BrandContext'",
      "import { client } from '@dripfunnel/shared/graphql'",
      "import { ApiError } from '../graphql'",
      "import { z } from 'zod'",
      'export const used = [Brand, client, ApiError, z]',
      '',
    ].join('\n')

    const refused = only(lint('../shared/format/imports.ts', source), 'no-restricted-imports')

    expect(refused.map((m) => m.line)).toEqual([1, 2])
    expect(refused[0]?.message).toContain('mobile-shared never imports')
  })

  it('allows a default export in a route file and refuses it anywhere else', () => {
    const source = 'export default function Screen() {\n  return null\n}\n'

    expect(only(lint('src/app/(tabs)/example.tsx', source), 'no-restricted-syntax')).toEqual([])
    expect(only(lint('src/features/example.tsx', source), 'no-restricted-syntax')).toHaveLength(1)
  })
})
