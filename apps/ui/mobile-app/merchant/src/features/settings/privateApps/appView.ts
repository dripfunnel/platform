import type { InstalledApp } from '../../../api/settingsApps'
import { formatDateTime } from '@dripfunnel/mobile-shared/format'
import { locale, t, tryT } from '../../../messages'
import { dotted } from '../dotted'

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export type LinkRead = { kind: 'notHttps' } | { kind: 'noApp' } | { kind: 'app'; id: string }

/** The app an install link names: the first UUID anywhere in an https link, since the API names apps by id and no link format is set (FIRST-RELEASE (store) §15). */
export const appOfLink = (link: string): LinkRead => {
  const text = link.trim()
  if (!/^https:\/\/\S+$/i.test(text)) return { kind: 'notHttps' }
  const id = uuid.exec(text)?.[0]
  return id ? { kind: 'app', id: id.toLowerCase() } : { kind: 'noApp' }
}

/** An app's own site, only when it is an https address; nothing of the app runs in the portal. */
export const siteOf = (siteUrl: string): string | null => (/^https:\/\/\S+$/i.test(siteUrl) ? siteUrl : null)

/** What an app is allowed to see, in words; a scope with none shows as the API names it. */
export const scopeWords = (scope: string): string => tryT(`settings.apps.scopes.${scope}`) ?? scope

export const metaOf = (app: InstalledApp, timeZone: string): string => {
  const when = formatDateTime(app.installedAt, locale, timeZone)
  return app.installedByName ? t('settings.apps.meta', { developer: app.developer, time: when, name: app.installedByName }) : t('settings.apps.metaNoName', { developer: app.developer, time: when })
}

export const accessOf = (app: InstalledApp, timeZone: string): string =>
  dotted([t('settings.apps.access', { scopes: app.scopes.map(scopeWords).join(', ') }), app.lastUsedAt ? t('settings.apps.lastUsed', { time: formatDateTime(app.lastUsedAt, locale, timeZone) }) : null])

/** What is wrong with an app, if anything: paused by the platform, still being handed its access, or never given it. */
export const troubleOf = (app: InstalledApp): string | null => (app.suspended ? t('settings.apps.suspended') : app.connection === 'failed' ? t('settings.apps.failed') : app.connection === 'waiting' ? t('settings.apps.waiting') : null)
