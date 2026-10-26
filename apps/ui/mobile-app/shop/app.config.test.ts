import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildConfig, readStoreEnv } from './app.config'

const appRoot = __dirname
let root: string

// A copy of the committed dev store, so a test can break one value without touching the real file.
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'store-'))
  cpSync(join(appRoot, 'stores'), join(root, 'stores'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function editDevEnv(edit: (lines: string[]) => string[]) {
  const file = join(root, 'stores', 'dev.env')
  writeFileSync(file, edit(readFileSync(file, 'utf8').trimEnd().split('\n')).join('\n'))
}
const without = (name: string) => (lines: string[]) => lines.filter((line) => !line.startsWith(`${name}=`))
const setTo = (name: string, value: string) => (lines: string[]) => lines.map((line) => (line.startsWith(`${name}=`) ? `${name}=${value}` : line))

describe('app.config.ts', () => {
  it('reads the committed dev store and builds the app config from it', () => {
    const env = readStoreEnv(appRoot, 'dev')
    expect(env.STORE_HOST).toBe('dev.my-store.localhost')

    const config = buildConfig({}, env)
    expect(config.name).toBe(env.APP_NAME)
    expect(config.ios?.bundleIdentifier).toBe(env.IOS_BUNDLE_ID)
    expect(config.android?.package).toBe(env.ANDROID_PACKAGE)
  })

  it('lets only the store host and the scheme reach the running app', () => {
    const env = readStoreEnv(appRoot, 'dev')
    expect(buildConfig({}, env).extra).toEqual({ STORE_HOST: env.STORE_HOST, APP_SCHEME: env.APP_SCHEME })
  })

  it('fails with the variable named when a value is missing', () => {
    editDevEnv(without('STORE_HOST'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/stores\/dev\.env[\s\S]*STORE_HOST/)
  })

  it('fails with the variable named when a value is malformed', () => {
    editDevEnv(setTo('IOS_BUNDLE_ID', 'not a bundle id'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/IOS_BUNDLE_ID: a bundle id such as com\.acme\.shop/)
  })

  it('refuses a store host written as a URL', () => {
    editDevEnv(setTo('STORE_HOST', 'https://dev.my-store.localhost/'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/STORE_HOST/)
  })

  it('refuses a variable it does not know, so a typo is never ignored', () => {
    editDevEnv((lines) => [...lines, 'STORE_HOTS=dev.my-store.localhost'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/STORE_HOTS/)
  })

  it('refuses an update channel that is not the store key', () => {
    editDevEnv(setTo('UPDATES_CHANNEL', 'acme'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/UPDATES_CHANNEL: must equal STORE_KEY/)
  })

  it('refuses an image that does not exist', () => {
    rmSync(join(root, 'stores', 'dev', 'splash.png'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/SPLASH_IMAGE: stores\/dev\/splash\.png does not exist/)
  })

  it("refuses another store's image, so a build never ships it", () => {
    cpSync(join(root, 'stores', 'dev'), join(root, 'stores', 'acme'), { recursive: true })
    editDevEnv(setTo('ICON_IMAGE', 'stores/acme/icon.png'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/ICON_IMAGE: stores\/acme\/icon\.png is not under stores\/dev\//)
  })

  it('refuses an image outside stores/', () => {
    editDevEnv(setTo('ICON_IMAGE', '../merchant/partners/dev/icon.png'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/ICON_IMAGE: a PNG under stores\/<store>\//)
  })

  it('needs STORE_KEY, and never reads outside stores/', () => {
    expect(() => readStoreEnv(root, undefined)).toThrow(/STORE_KEY must name a file in stores\//)
    expect(() => readStoreEnv(root, '../secrets')).toThrow(/STORE_KEY must name a file in stores\//)
    expect(() => readStoreEnv(root, 'acme')).toThrow(/stores\/acme\.env does not exist/)
  })
})
