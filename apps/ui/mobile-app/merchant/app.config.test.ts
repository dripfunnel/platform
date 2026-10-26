import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildConfig, readPartnerEnv } from './app.config'

const appRoot = __dirname
let root: string

// A copy of the committed dev partner, so a test can break one value without touching the real file.
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'partner-'))
  cpSync(join(appRoot, 'partners'), join(root, 'partners'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function editDevEnv(edit: (lines: string[]) => string[]) {
  const file = join(root, 'partners', 'dev.env')
  writeFileSync(file, edit(readFileSync(file, 'utf8').trimEnd().split('\n')).join('\n'))
}
const without = (name: string) => (lines: string[]) => lines.filter((line) => !line.startsWith(`${name}=`))
const setTo = (name: string, value: string) => (lines: string[]) => lines.map((line) => (line.startsWith(`${name}=`) ? `${name}=${value}` : line))

describe('app.config.ts', () => {
  it('reads the committed dev partner and builds the app config from it', () => {
    const env = readPartnerEnv(appRoot, 'dev')
    expect(env.PARTNER_DOMAIN).toBe('dev-store.actuateminds.com')

    const config = buildConfig({}, env)
    expect(config.name).toBe(env.APP_NAME)
    expect(config.ios?.bundleIdentifier).toBe(env.IOS_BUNDLE_ID)
    expect(config.android?.package).toBe(env.ANDROID_PACKAGE)
    expect(config.extra).toEqual({ PARTNER_DOMAIN: 'dev-store.actuateminds.com' })
  })

  it('fails with the variable named when a value is missing', () => {
    editDevEnv(without('PARTNER_DOMAIN'))
    expect(() => readPartnerEnv(root, 'dev')).toThrow(/partners\/dev\.env[\s\S]*PARTNER_DOMAIN/)
  })

  it('fails with the variable named when a value is malformed', () => {
    editDevEnv(setTo('IOS_BUNDLE_ID', 'not a bundle id'))
    expect(() => readPartnerEnv(root, 'dev')).toThrow(/IOS_BUNDLE_ID: a bundle id such as com\.example\.shops/)
  })

  it('refuses a portal domain written as a URL', () => {
    editDevEnv(setTo('PARTNER_DOMAIN', 'https://dev-store.actuateminds.com/'))
    expect(() => readPartnerEnv(root, 'dev')).toThrow(/PARTNER_DOMAIN/)
  })

  it('refuses a variable it does not know, so a typo is never ignored', () => {
    editDevEnv((lines) => [...lines, 'PARTNER_DOMIAN=dev-store.actuateminds.com'])
    expect(() => readPartnerEnv(root, 'dev')).toThrow(/PARTNER_DOMIAN/)
  })

  it('refuses an update channel that is not the partner key', () => {
    editDevEnv(setTo('UPDATES_CHANNEL', 'northstar'))
    expect(() => readPartnerEnv(root, 'dev')).toThrow(/UPDATES_CHANNEL: must equal PARTNER_KEY/)
  })

  it('refuses an image that is not in the partner folder', () => {
    rmSync(join(root, 'partners', 'dev', 'splash.png'))
    expect(() => readPartnerEnv(root, 'dev')).toThrow(/SPLASH_IMAGE: partners\/dev\/splash\.png does not exist/)
  })

  it('needs PARTNER_KEY, and never reads outside partners/', () => {
    expect(() => readPartnerEnv(root, undefined)).toThrow(/PARTNER_KEY must name a file in partners\//)
    expect(() => readPartnerEnv(root, '../secrets')).toThrow(/PARTNER_KEY must name a file in partners\//)
    expect(() => readPartnerEnv(root, 'northstar')).toThrow(/partners\/northstar\.env does not exist/)
  })
})
