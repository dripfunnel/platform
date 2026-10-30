import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildConfig, googleIosUrlScheme, readFirebaseFiles, readPartnerEnv } from './app.config'

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

  // Built, not written out: GitHub's push protection reads a literal in Google's shape as a leaked credential.
  const googleClient = (prefix: string) => [prefix, 'apps', 'googleusercontent', 'com'].join('.')

  it('turns on Google sign-in only with both client IDs, with the iOS client reversed as its URL scheme', () => {
    const web = googleClient('111-web')
    const ios = googleClient('111-ios')
    editDevEnv((lines) => [...lines, `GOOGLE_WEB_CLIENT_ID=${web}`, `GOOGLE_IOS_CLIENT_ID=${ios}`])
    const config = buildConfig({}, readPartnerEnv(root, 'dev'))
    expect(config.plugins).toContainEqual(['@react-native-google-signin/google-signin', { iosUrlScheme: ['com', 'googleusercontent', 'apps', '111-ios'].join('.') }])
    expect(config.extra).toEqual({ PARTNER_DOMAIN: 'dev-store.actuateminds.com', google: { webClientId: web, iosClientId: ios } })
    expect(googleIosUrlScheme(ios)).toBe(['com', 'googleusercontent', 'apps', '111-ios'].join('.'))
    expect(JSON.stringify(buildConfig({}, readPartnerEnv(appRoot, 'dev')).plugins)).not.toContain('google-signin')
  })

  it('refuses one Google client ID without the other, or one that isn’t Google’s', () => {
    editDevEnv((lines) => [...lines, `GOOGLE_WEB_CLIENT_ID=${googleClient('111-web')}`])
    expect(() => readPartnerEnv(root, 'dev')).toThrow(/GOOGLE_IOS_CLIENT_ID: GOOGLE_WEB_CLIENT_ID and GOOGLE_IOS_CLIENT_ID go together/)
    editDevEnv((lines) => [...lines, 'GOOGLE_IOS_CLIENT_ID=not-a-client'])
    expect(() => readPartnerEnv(root, 'dev')).toThrow(/GOOGLE_IOS_CLIENT_ID: a Google OAuth client ID/)
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

  describe('crash reporting', () => {
    const files = { GOOGLE_SERVICES_JSON: () => join(root, 'google-services.json'), GOOGLE_SERVICE_INFO_PLIST: () => join(root, 'GoogleService-Info.plist') }
    const writeFiles = () => Object.values(files).forEach((path) => writeFileSync(path(), '{}'))
    const vars = () => ({ GOOGLE_SERVICES_JSON: files.GOOGLE_SERVICES_JSON(), GOOGLE_SERVICE_INFO_PLIST: files.GOOGLE_SERVICE_INFO_PLIST() })
    const turnOn = () => editDevEnv((lines) => [...lines, 'CRASH_REPORTING=on'])

    it('is off for the committed dev partner: no Firebase plugin, no file, no flag', () => {
      const env = readPartnerEnv(root, 'dev')
      expect(readFirebaseFiles(env, vars())).toBeNull()
      const config = buildConfig({}, env, readFirebaseFiles(env, vars()))
      expect(config.plugins).not.toContainEqual(expect.stringContaining('firebase'))
      expect(JSON.stringify(config)).not.toMatch(/googleServicesFile|crashReporting|useFrameworks/)
    })

    it('adds the two Firebase plugins, both files, dynamic frameworks and the flag for a partner that turns it on', () => {
      turnOn()
      writeFiles()
      const env = readPartnerEnv(root, 'dev')
      const config = buildConfig({}, env, readFirebaseFiles(env, vars()))
      expect(config.plugins).toEqual(expect.arrayContaining(['@react-native-firebase/app', '@react-native-firebase/crashlytics', ['expo-build-properties', { ios: { useFrameworks: 'dynamic' } }]]))
      expect(config.ios?.googleServicesFile).toBe(files.GOOGLE_SERVICE_INFO_PLIST())
      expect(config.android?.googleServicesFile).toBe(files.GOOGLE_SERVICES_JSON())
      expect(config.extra).toEqual({ PARTNER_DOMAIN: 'dev-store.actuateminds.com', crashReporting: true })
    })

    it('fails naming each Firebase file that EAS has not provided', () => {
      turnOn()
      const env = readPartnerEnv(root, 'dev')
      expect(() => readFirebaseFiles(env, {})).toThrow(/CRASH_REPORTING=on[\s\S]*GOOGLE_SERVICES_JSON[\s\S]*GOOGLE_SERVICE_INFO_PLIST/)
      writeFiles()
      expect(() => readFirebaseFiles(env, { ...vars(), GOOGLE_SERVICE_INFO_PLIST: join(root, 'missing.plist') })).toThrow(/GOOGLE_SERVICE_INFO_PLIST/)
    })

    it('is switched on by the build profile for a partner file that says nothing, and by nothing else', () => {
      writeFiles()
      const env = readPartnerEnv(root, 'dev')
      expect(readFirebaseFiles(env, { ...vars(), CRASH_REPORTING: 'on' })).toEqual({ android: files.GOOGLE_SERVICES_JSON(), ios: files.GOOGLE_SERVICE_INFO_PLIST() })
      expect(readFirebaseFiles(env, { ...vars(), CRASH_REPORTING: 'yes' })).toBeNull()
      expect(() => readFirebaseFiles(env, { CRASH_REPORTING: 'on' })).toThrow(/GOOGLE_SERVICES_JSON/)
    })

    it('refuses a value other than on, so a typo never turns it off quietly', () => {
      editDevEnv((lines) => [...lines, 'CRASH_REPORTING=yes'])
      expect(() => readPartnerEnv(root, 'dev')).toThrow(/CRASH_REPORTING/)
    })
  })
})
