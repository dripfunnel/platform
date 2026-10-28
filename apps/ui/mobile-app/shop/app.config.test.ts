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

  it('builds without a Maps key, and with one gives it to Android only', () => {
    expect(buildConfig({}, readStoreEnv(appRoot, 'dev')).android?.config).toBeUndefined()
    const key = `AIza${'a'.repeat(35)}`
    editDevEnv((lines) => [...lines, `GOOGLE_MAPS_ANDROID_KEY=${key}`])
    const config = buildConfig({}, readStoreEnv(root, 'dev'))
    expect(config.android?.config?.googleMaps?.apiKey).toBe(key)
    expect(config.ios?.config).toBeUndefined()
    expect(JSON.stringify(config.extra)).not.toContain(key)
  })

  it('refuses a Maps key that is not shaped like one', () => {
    editDevEnv((lines) => [...lines, 'GOOGLE_MAPS_ANDROID_KEY=not-a-key'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/GOOGLE_MAPS_ANDROID_KEY/)
  })

  it('switches on Stripe’s Payment Sheet and Google Pay, and Apple Pay only for a store that names a merchant identifier', () => {
    const stripe = (config: ReturnType<typeof buildConfig>) => config.plugins?.find((p) => Array.isArray(p) && p[0] === '@stripe/stripe-react-native')
    const plain = buildConfig({}, readStoreEnv(appRoot, 'dev'))
    expect(stripe(plain)).toEqual(['@stripe/stripe-react-native', { enableGooglePay: true }])
    expect(plain.extra).not.toHaveProperty('APPLE_PAY_MERCHANT_ID')

    editDevEnv((lines) => [...lines, 'APPLE_PAY_MERCHANT_ID=merchant.com.juniper.shop'])
    const apple = buildConfig({}, readStoreEnv(root, 'dev'))
    expect(stripe(apple)).toEqual(['@stripe/stripe-react-native', { enableGooglePay: true, merchantIdentifier: 'merchant.com.juniper.shop' }])
    expect(apple.extra).toMatchObject({ APPLE_PAY_MERCHANT_ID: 'merchant.com.juniper.shop' })
  })

  it('lets the app find PhonePe’s Android SDK and the UPI apps the Indian providers open', () => {
    const config = buildConfig({}, readStoreEnv(appRoot, 'dev'))
    const properties = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-build-properties')
    expect(properties).toEqual([
      'expo-build-properties',
      {
        android: {
          extraMavenRepos: ['https://phonepe.mycloudrepo.io/public/repositories/phonepe-intentsdk-android'],
          manifestQueries: { intent: [{ action: 'android.intent.action.VIEW', data: { scheme: 'upi', host: 'pay' } }] },
        },
      },
    ])
    expect(config.ios?.infoPlist?.['LSApplicationQueriesSchemes']).toEqual(['phonepe', 'tez', 'paytmmp', 'paytm', 'bhim'])
  })

  it('sets up push only for a store that names its EAS project, and gives Android its Firebase file from the store’s own folder', () => {
    const plain = buildConfig({}, readStoreEnv(appRoot, 'dev'))
    expect(plain.extra).not.toHaveProperty('eas')
    expect(plain.android).not.toHaveProperty('googleServicesFile')

    writeFileSync(join(root, 'stores/dev/google-services.json'), '{}')
    editDevEnv((lines) => [...lines, 'EAS_PROJECT_ID=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'GOOGLE_SERVICES_FILE=stores/dev/google-services.json'])
    const push = buildConfig({}, readStoreEnv(root, 'dev'))
    expect(push.extra).toMatchObject({ eas: { projectId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' } })
    expect(push.android?.googleServicesFile).toBe('./stores/dev/google-services.json')
    expect(push.plugins).toContain('expo-notifications')
  })

  it('refuses a push project that is not an id, and a Firebase file that is missing or another store’s', () => {
    editDevEnv((lines) => [...lines, 'EAS_PROJECT_ID=my-project'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/EAS_PROJECT_ID/)

    editDevEnv((lines) => [...lines.filter((l) => !l.startsWith('EAS_PROJECT_ID')), 'GOOGLE_SERVICES_FILE=stores/dev/google-services.json'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/does not exist/)

    editDevEnv((lines) => [...lines.filter((l) => !l.startsWith('GOOGLE_SERVICES_FILE')), 'GOOGLE_SERVICES_FILE=stores/other/google-services.json'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/is not under stores\/dev\//)
  })

  it('switches Crashlytics on only for a store with both Firebase files, and builds the iOS pods as dynamic frameworks for it', () => {
    const plain = buildConfig({}, readStoreEnv(appRoot, 'dev'))
    expect(plain.plugins).not.toContain('@react-native-firebase/app')
    expect(plain.extra).not.toHaveProperty('crashReporting')
    expect(plain.ios).not.toHaveProperty('googleServicesFile')

    writeFileSync(join(root, 'stores/dev/google-services.json'), '{}')
    editDevEnv((lines) => [...lines, 'GOOGLE_SERVICES_FILE=stores/dev/google-services.json'])
    const pushOnly = buildConfig({}, readStoreEnv(root, 'dev'))
    expect(pushOnly.plugins).not.toContain('@react-native-firebase/crashlytics')
    expect(pushOnly.extra).not.toHaveProperty('crashReporting')

    writeFileSync(join(root, 'stores/dev/GoogleService-Info.plist'), '<plist/>')
    editDevEnv((lines) => [...lines, 'GOOGLE_SERVICE_INFO_FILE=stores/dev/GoogleService-Info.plist'])
    const crash = buildConfig({}, readStoreEnv(root, 'dev'))
    expect(crash.plugins).toEqual(expect.arrayContaining(['@react-native-firebase/app', '@react-native-firebase/crashlytics']))
    expect(crash.ios?.googleServicesFile).toBe('./stores/dev/GoogleService-Info.plist')
    expect(crash.android?.googleServicesFile).toBe('./stores/dev/google-services.json')
    expect(crash.extra).toMatchObject({ crashReporting: true })
    const properties = crash.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-build-properties')
    expect(properties?.[1]).toMatchObject({ ios: { useFrameworks: 'dynamic' } })
  })

  it('refuses the iOS Firebase file without the Android one, and one that is missing, another store’s or misnamed', () => {
    editDevEnv((lines) => [...lines, 'GOOGLE_SERVICE_INFO_FILE=stores/dev/GoogleService-Info.plist'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/GOOGLE_SERVICE_INFO_FILE.*GOOGLE_SERVICES_FILE/s)

    writeFileSync(join(root, 'stores/dev/google-services.json'), '{}')
    editDevEnv((lines) => [...lines, 'GOOGLE_SERVICES_FILE=stores/dev/google-services.json'])
    expect(() => readStoreEnv(root, 'dev')).toThrow("GOOGLE_SERVICE_INFO_FILE: stores/dev/GoogleService-Info.plist does not exist")

    editDevEnv((lines) => [...lines.filter((l) => !l.startsWith('GOOGLE_SERVICE_INFO_FILE')), 'GOOGLE_SERVICE_INFO_FILE=stores/other/GoogleService-Info.plist'])
    expect(() => readStoreEnv(root, 'dev')).toThrow("is not under stores/dev/")

    editDevEnv((lines) => [...lines.filter((l) => !l.startsWith('GOOGLE_SERVICE_INFO_FILE')), 'GOOGLE_SERVICE_INFO_FILE=stores/dev/info.plist'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/GOOGLE_SERVICE_INFO_FILE/)
  })

  it('refuses an Apple merchant identifier that is not shaped like one', () => {
    editDevEnv((lines) => [...lines, 'APPLE_PAY_MERCHANT_ID=juniper'])
    expect(() => readStoreEnv(root, 'dev')).toThrow(/APPLE_PAY_MERCHANT_ID/)
  })

  it('asks for the location only while the app is in use, naming the store', () => {
    const env = readStoreEnv(appRoot, 'dev')
    const plugin = buildConfig({}, env).plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-location')
    expect(plugin).toEqual(['expo-location', { locationWhenInUsePermission: messages.permissions.location.replace('{name}', env.APP_NAME) }])
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
