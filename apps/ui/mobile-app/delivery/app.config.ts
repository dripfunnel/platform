import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import type { ConfigContext, ExpoConfig } from 'expo/config'
import { z } from 'zod'
import messages from './src/messages/en.json'

// docs/mobile-app/README.md §3: one committed file per store, public values only.
const colour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'a quoted colour such as "#0A2A4A" (an unquoted # starts a comment in an env file)')
const image = z.string().regex(/^stores\/[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+\.png$/, 'a PNG under stores/<store>/, such as stores/dev/icon.png')
const storeKey = z.string().regex(/^[a-z][a-z0-9-]*$/, 'lower-case letters, digits and hyphens, starting with a letter')

export const storeEnvSchema = z
  .strictObject({
    STORE_KEY: storeKey,
    STORE_HOST: z.string().regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'a host name such as acme.my-store.one, with no scheme or path'),
    APP_NAME: z.string().trim().min(1).max(30),
    IOS_BUNDLE_ID: z.string().regex(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, 'a bundle id such as com.acme.delivery'),
    ANDROID_PACKAGE: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/, 'a package name such as com.acme.delivery'),
    APP_SCHEME: z.string().regex(/^[a-z][a-z0-9+.-]*$/, 'a URL scheme such as acmedelivery'),
    ICON_IMAGE: image,
    ANDROID_ICON_FOREGROUND: image,
    ANDROID_ICON_BACKGROUND: colour,
    SPLASH_IMAGE: image,
    SPLASH_BACKGROUND: colour,
    UPDATES_CHANNEL: storeKey,
    // Google Maps SDK key for Android: a public build value restricted to the app's package and signing certificate, not a secret (docs/code/THIRD-PARTY-ACCESS.md §2.12). Without it the map is blank on Android.
    GOOGLE_MAPS_ANDROID_KEY: z.string().regex(/^AIza[0-9A-Za-z_-]{35}$/, 'a Google Maps API key, which starts AIza').optional(),
  })
  .refine((env) => env.UPDATES_CHANNEL === env.STORE_KEY, { path: ['UPDATES_CHANNEL'], message: 'must equal STORE_KEY' })

export type StoreEnv = z.infer<typeof storeEnvSchema>

const imageKeys = ['ICON_IMAGE', 'ANDROID_ICON_FOREGROUND', 'SPLASH_IMAGE'] as const

function fail(file: string, problems: string[]): never {
  throw new Error(`${file} is not a valid store file (docs/mobile-app/README.md §3):\n${problems.map((p) => `  - ${p}`).join('\n')}`)
}

export function readStoreEnv(root: string, key: string | undefined): StoreEnv {
  const keyResult = storeKey.safeParse(key)
  if (!keyResult.success) {
    throw new Error('STORE_KEY must name a file in stores/ (for example STORE_KEY=dev): set it in the shell, in .env.local or in the EAS build profile.')
  }
  const file = `stores/${keyResult.data}.env`
  const path = join(root, file)
  if (!existsSync(path)) throw new Error(`${file} does not exist: STORE_KEY=${keyResult.data} names no store.`)

  const parsed = storeEnvSchema.safeParse(parseEnv(readFileSync(path, 'utf8')))
  if (!parsed.success) fail(file, parsed.error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`))
  const env = parsed.data
  if (env.STORE_KEY !== keyResult.data) fail(file, [`STORE_KEY: is ${env.STORE_KEY}, but the file is for ${keyResult.data}`])

  // A store's build never ships another store's image.
  const foreign = imageKeys.filter((name) => !env[name].startsWith(`stores/${env.STORE_KEY}/`)).map((name) => `${name}: ${env[name]} is not under stores/${env.STORE_KEY}/`)
  if (foreign.length > 0) fail(file, foreign)
  const missing = imageKeys.filter((name) => !existsSync(join(root, env[name]))).map((name) => `${name}: ${env[name]} does not exist`)
  if (missing.length > 0) fail(file, missing)
  return env
}

const usage = (text: string, env: StoreEnv): string => text.replace('{name}', () => env.APP_NAME)

export function buildConfig(config: Partial<ExpoConfig>, env: StoreEnv): ExpoConfig {
  return {
    ...config,
    name: env.APP_NAME,
    slug: 'dripfunnel-delivery',
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
      ...(env.GOOGLE_MAPS_ANDROID_KEY ? { config: { googleMaps: { apiKey: env.GOOGLE_MAPS_ANDROID_KEY } } } : {}),
    },
    plugins: [
      'expo-router',
      ['expo-splash-screen', { image: env.SPLASH_IMAGE, backgroundColor: env.SPLASH_BACKGROUND, imageWidth: 200 }],
      'expo-updates',
      // The rider's position while Online (FIRST-RELEASE.md §1, delivery/ARCHITECTURE.md §1): iOS's `location` background mode and Android's
      // ACCESS_BACKGROUND_LOCATION with a location foreground service, so the notification that service shows says the app is using it.
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: usage(messages.permissions.locationAlways, env),
          locationWhenInUsePermission: usage(messages.permissions.locationWhenInUse, env),
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      // Offers and assignments (delivery/ARCHITECTURE.md §3).
      'expo-notifications',
      // The profile photo, from the photo library only.
      ['expo-image-picker', { photosPermission: usage(messages.permissions.photos, env), cameraPermission: false, microphonePermission: false }],
    ],
    extra: { STORE_HOST: env.STORE_HOST },
  }
}

export default ({ config }: ConfigContext): ExpoConfig => buildConfig(config, readStoreEnv(__dirname, process.env.STORE_KEY))
