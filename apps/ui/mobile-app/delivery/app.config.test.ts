import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import messages from './src/messages/en.json'
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
const plugin = (config: ReturnType<typeof buildConfig>, name: string) => config.plugins?.find((p) => (Array.isArray(p) ? p[0] === name : p === name))

describe('app.config.ts', () => {
  it('reads the committed dev store and builds the app config from it', () => {
    const env = readStoreEnv(appRoot, 'dev')
    expect(env.STORE_HOST).toBe('dev.my-store.localhost')

    const config = buildConfig({}, env)
    expect(config.name).toBe(env.APP_NAME)
    expect(config.ios?.bundleIdentifier).toBe(env.IOS_BUNDLE_ID)
    expect(config.android?.package).toBe(env.ANDROID_PACKAGE)
    expect(config.scheme).toBe(env.APP_SCHEME)
  })

  it('lets only the store host reach the running app', () => {
    const env = readStoreEnv(appRoot, 'dev')
    expect(buildConfig({}, env).extra).toEqual({ STORE_HOST: env.STORE_HOST })
  })

  it('hands the store’s EAS project to the app for its push token, and the Firebase file to Android', () => {
    editDevEnv((lines) => [...lines, 'EAS_PROJECT_ID=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'GOOGLE_SERVICES_FILE=stores/dev/google-services.json'])
    writeFileSync(join(root, 'stores', 'dev', 'google-services.json'), '{}')
    const config = buildConfig({}, readStoreEnv(root, 'dev'))
    expect(config.extra).toMatchObject({ eas: { projectId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' } })
    expect(config.android?.googleServicesFile).toBe('./stores/dev/google-services.json')
  })

  it('refuses a Firebase file of another store, or one that does not exist', () => {
    editDevEnv((lines) => [...lines, 'GOOGLE_SERVICES_FILE=stores/other/google-services.json'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/GOOGLE_SERVICES_FILE: stores\/other\/google-services\.json is not under stores\/dev\//)
    editDevEnv(setTo('GOOGLE_SERVICES_FILE', 'stores/dev/google-services.json'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/GOOGLE_SERVICES_FILE: stores\/dev\/google-services\.json does not exist/)
  })

  it('declares background location on both platforms and the Android foreground service, in the app’s name', () => {
    const env = readStoreEnv(appRoot, 'dev')
    expect(plugin(buildConfig({}, env), 'expo-location')).toEqual([
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission: messages.permissions.locationAlways.replace('{name}', env.APP_NAME),
        locationWhenInUsePermission: messages.permissions.locationWhenInUse.replace('{name}', env.APP_NAME),
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ])
  })

  it('puts a store name with a dollar sign in the usage text as it is, not as a replacement pattern', () => {
    const name = 'Ben $& Jerry'
    editDevEnv(setTo('APP_NAME', `"${name}"`))
    const options = (plugin(buildConfig({}, readStoreEnv(root, 'dev')), 'expo-location') as [string, Record<string, string>])[1]
    expect(options['locationWhenInUsePermission']).toBe(messages.permissions.locationWhenInUse.replace('{name}', () => name))
    expect(options['locationWhenInUsePermission']).toContain(name)
  })

  it('declares notifications, and the photo library and camera but not the microphone for the profile photo', () => {
    const env = readStoreEnv(appRoot, 'dev')
    const config = buildConfig({}, env)
    expect(plugin(config, 'expo-notifications')).toBe('expo-notifications')
    expect(plugin(config, 'expo-image-picker')).toEqual(['expo-image-picker', { photosPermission: messages.permissions.photos.replace('{name}', env.APP_NAME), cameraPermission: messages.permissions.camera.replace('{name}', env.APP_NAME), microphonePermission: false }])
  })

  it('refuses the Maps key, which comes with the map screen', () => {
    editDevEnv((lines) => [...lines, `GOOGLE_MAPS_ANDROID_KEY=AIza${'a'.repeat(35)}`])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/GOOGLE_MAPS_ANDROID_KEY/)
  })

  it('fails with the variable named when a value is missing', () => {
    editDevEnv(without('STORE_HOST'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/stores\/dev\.env[\s\S]*STORE_HOST/)
  })

  it('fails with the variable named when a value is malformed', () => {
    editDevEnv(setTo('IOS_BUNDLE_ID', 'not a bundle id'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/IOS_BUNDLE_ID: a bundle id such as com\.acme\.delivery/)
  })

  it('refuses a store host written as a URL', () => {
    editDevEnv(setTo('STORE_HOST', 'https://dev.my-store.localhost/'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/STORE_HOST/)
  })

  it('refuses a variable it does not know, so a typo is never ignored', () => {
    editDevEnv((lines) => [...lines, 'STORE_HOTS=dev.my-store.localhost'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/STORE_HOTS/)
  })

  it('refuses a variable the shop app has and this one does not', () => {
    editDevEnv((lines) => [...lines, 'APPLE_PAY_MERCHANT_ID=merchant.com.acme.shop'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/APPLE_PAY_MERCHANT_ID/)
  })

  it('refuses an update channel that is not the store key', () => {
    editDevEnv(setTo('UPDATES_CHANNEL', 'acme'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/UPDATES_CHANNEL: must equal STORE_KEY/)
  })

  it('refuses an image that does not exist', () => {
    rmSync(join(root, 'stores', 'dev', 'splash.png'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/SPLASH_IMAGE: stores\/dev\/splash\.png does not exist/)
  })

  it('refuses another store’s image, so a build never ships it', () => {
    editDevEnv(setTo('ICON_IMAGE', 'stores/other/icon.png'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/ICON_IMAGE: stores\/other\/icon\.png is not under stores\/dev\//)
  })

  it('refuses an image path that leaves stores/', () => {
    editDevEnv(setTo('ICON_IMAGE', 'stores/../secret.png'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/ICON_IMAGE/)
  })

  it('refuses a colour that is not a quoted hex value', () => {
    editDevEnv(setTo('SPLASH_BACKGROUND', 'white'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/SPLASH_BACKGROUND/)
  })

  it('refuses a missing or malformed STORE_KEY, and one that names no file or a path outside stores/', () => {
    expect(() => readStoreEnv(appRoot, undefined)).toThrow(/STORE_KEY must name a file in stores/)
    expect(() => readStoreEnv(appRoot, '../dev')).toThrow(/STORE_KEY must name a file in stores/)
    expect(() => readStoreEnv(appRoot, 'Dev')).toThrow(/STORE_KEY must name a file in stores/)
    expect(() => readStoreEnv(appRoot, 'acme')).toThrow(/stores\/acme\.env does not exist/)
  })

  it('refuses a file whose STORE_KEY is not the one it is named for', () => {
    editDevEnv(setTo('STORE_KEY', 'acme'))
    expect(() => readStoreEnv(root, 'dev')).toThrow(/STORE_KEY/)
  })
})
