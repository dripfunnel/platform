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

describe('the root eslint.config.js for the mobile app', () => {
  it('refuses imports of @dripfunnel packages, apps/ and shared/, and lets other imports through', () => {
    const source = [
      "import { client } from '@dripfunnel/shared/graphql'",
      "import { screen } from '../../../../../apps/ui/store/src/screen'",
      "import { tokens } from '../../../shared/ui/tokens'",
      "import { Redirect } from 'expo-router'",
      "import { PlaceholderScreen } from '../features/placeholder/PlaceholderScreen'",
      'export const used = [client, screen, tokens, Redirect, PlaceholderScreen]',
      '',
    ].join('\n')

    const refused = only(lint('src/features/imports.ts', source), 'no-restricted-imports')

    expect(refused.map((m) => m.line)).toEqual([1, 2, 3])
    expect(refused[0]?.message).toContain('REACT-NATIVE.md')
  })

  it('allows a default export in a route file and refuses it anywhere else', () => {
    const source = 'export default function Screen() {\n  return null\n}\n'

    expect(only(lint('src/app/(tabs)/example.tsx', source), 'no-restricted-syntax')).toEqual([])
    expect(only(lint('src/features/example.tsx', source), 'no-restricted-syntax')).toHaveLength(1)
  })
})
