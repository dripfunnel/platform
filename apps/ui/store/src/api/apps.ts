import { z } from 'zod'
import { allPages } from './allPages'
import { query } from './client'

// Settings › Apps (SetDev "apps", FIRST-RELEASE §15; apps/api/src/apis/store/apps.ts): private apps opened on their own site.

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

const installableSchema = z.object({ id: z.string(), name: z.string(), developer: z.string(), siteUrl: z.string(), scopes: z.array(z.string()) })
export type InstallableApp = z.infer<typeof installableSchema>

const installedSchema = z.object({
  id: z.string(),
  appId: z.string(),
  name: z.string(),
  developer: z.string(),
  siteUrl: z.string(),
  scopes: z.array(z.string()),
  suspended: z.boolean(),
  installedByName: z.string().nullable(),
  installedAt: z.string(),
  lastUsedAt: z.string().nullable(),
  connection: z.enum(['waiting', 'sent', 'failed']),
})
export type InstalledApp = z.infer<typeof installedSchema>

export const loadApps = (): Promise<InstalledApp[]> =>
  allPages(
    async (after) =>
      (
        await query(
          'query A($after: String) { apps(first: 50, after: $after) { nodes { id appId name developer siteUrl scopes suspended installedByName installedAt lastUsedAt connection } pageInfo { hasNextPage endCursor } } }',
          z.object({ apps: z.object({ nodes: z.array(installedSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).apps,
  )

/** The consent screen's app, or null when no app has that id. */
export const loadInstallableApp = async (id: string): Promise<InstallableApp | null> =>
  (await query('query I($id: ID!) { installableApp(id: $id) { id name developer siteUrl scopes } }', z.object({ installableApp: installableSchema.nullable() }), { id })).installableApp

/** The scopes go back as the Owner saw them; the API refuses SCOPES_CHANGED when the app has asked for others since. */
export const installApp = async (appId: string, scopes: readonly string[]): Promise<void> => {
  await query('mutation I($a: ID!, $s: [String!]!) { installApp(appId: $a, scopes: $s) }', z.object({ installApp: z.string() }), { a: appId, s: scopes })
}

export const uninstallApp = async (id: string): Promise<void> => {
  await query('mutation U($id: ID!) { uninstallApp(id: $id) }', z.object({ uninstallApp: z.boolean() }), { id })
}
