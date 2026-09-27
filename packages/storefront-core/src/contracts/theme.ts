export type ThemeManifest = {
  name: string
  version: string
}

export const defineTheme = (manifest: ThemeManifest): ThemeManifest => manifest
