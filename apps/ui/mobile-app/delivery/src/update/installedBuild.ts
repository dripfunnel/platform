import * as Application from 'expo-application'

/** The installed build's number (Android's versionCode, which EAS raises on every build); null where the platform gives none. */
export const installedBuild = (): number | null => {
  const build = Number(Application.nativeBuildVersion)
  return Number.isInteger(build) && build > 0 ? build : null
}
