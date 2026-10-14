import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import type { ConfigContext, ExpoConfig } from 'expo/config'
import { z } from 'zod'

// CONFIGURATION.md §2: one committed file per partner, public values only.
const colour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'a quoted colour such as "#0A2A4A" (an unquoted # starts a comment in an env file)')
const image = z.string().regex(/^partners\/[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+\.png$/, 'a PNG under partners/<partner>/, such as partners/dev/icon.png')
const partnerKey = z.string().regex(/^[a-z][a-z0-9-]*$/, 'lower-case letters, digits and hyphens, starting with a letter')

export const partnerEnvSchema = z
  .strictObject({
    PARTNER_KEY: partnerKey,
    PARTNER_DOMAIN: z.string().regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'a host name such as store.example.com, with no scheme or path'),
    APP_NAME: z.string().trim().min(1).max(30),
    IOS_BUNDLE_ID: z.string().regex(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, 'a bundle id such as com.example.shops'),
    ANDROID_PACKAGE: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/, 'a package name such as com.example.shops'),
    APP_SCHEME: z.string().regex(/^[a-z][a-z0-9+.-]*$/, 'a URL scheme such as exampleshops'),
    ICON_IMAGE: image,
    ANDROID_ICON_FOREGROUND: image,
    ANDROID_ICON_BACKGROUND: colour,
    SPLASH_IMAGE: image,
    SPLASH_BACKGROUND: colour,
    UPDATES_CHANNEL: partnerKey,
  })
  .refine((env) => env.UPDATES_CHANNEL === env.PARTNER_KEY, { path: ['UPDATES_CHANNEL'], message: 'must equal PARTNER_KEY' })

export type PartnerEnv = z.infer<typeof partnerEnvSchema>

const imageKeys = ['ICON_IMAGE', 'ANDROID_ICON_FOREGROUND', 'SPLASH_IMAGE'] as const

function fail(file: string, problems: string[]): never {
  throw new Error(`${file} is not a valid partner file (CONFIGURATION.md §2):\n${problems.map((p) => `  - ${p}`).join('\n')}`)
}

export function readPartnerEnv(root: string, key: string | undefined): PartnerEnv {
  const keyResult = partnerKey.safeParse(key)
  if (!keyResult.success) {
    throw new Error('PARTNER_KEY must name a file in partners/ (for example PARTNER_KEY=dev): set it in the shell, in .env.local or in the EAS build profile.')
  }
  const file = `partners/${keyResult.data}.env`
  const path = join(root, file)
  if (!existsSync(path)) throw new Error(`${file} does not exist: PARTNER_KEY=${keyResult.data} names no partner.`)

  const parsed = partnerEnvSchema.safeParse(parseEnv(readFileSync(path, 'utf8')))
  if (!parsed.success) fail(file, parsed.error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`))
  const env = parsed.data
  if (env.PARTNER_KEY !== keyResult.data) fail(file, [`PARTNER_KEY: is ${env.PARTNER_KEY}, but the file is for ${keyResult.data}`])

  const missing = imageKeys.filter((name) => !existsSync(join(root, env[name]))).map((name) => `${name}: ${env[name]} does not exist`)
  if (missing.length > 0) fail(file, missing)
  return env
}

export function buildConfig(config: Partial<ExpoConfig>, env: PartnerEnv): ExpoConfig {
  return {
    ...config,
    name: env.APP_NAME,
    slug: 'dripfunnel-merchant',
    version: '1.0.0',
    platforms: ['ios', 'android'],
    scheme: env.APP_SCHEME,
    orientation: 'portrait',
    icon: env.ICON_IMAGE,
    userInterfaceStyle: 'automatic',
    runtimeVersion: { policy: 'appVersion' },
    ios: { bundleIdentifier: env.IOS_BUNDLE_ID, supportsTablet: false },
    android: {
      package: env.ANDROID_PACKAGE,
      adaptiveIcon: { foregroundImage: env.ANDROID_ICON_FOREGROUND, backgroundColor: env.ANDROID_ICON_BACKGROUND },
    },
    plugins: ['expo-router', ['expo-splash-screen', { image: env.SPLASH_IMAGE, backgroundColor: env.SPLASH_BACKGROUND, imageWidth: 200 }], 'expo-updates', ['expo-image-picker', { microphonePermission: false }]],
    extra: { PARTNER_DOMAIN: env.PARTNER_DOMAIN },
  }
}

export default ({ config }: ConfigContext): ExpoConfig => buildConfig(config, readPartnerEnv(__dirname, process.env.PARTNER_KEY))
