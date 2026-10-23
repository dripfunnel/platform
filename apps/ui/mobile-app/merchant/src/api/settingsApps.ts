import { z } from 'zod'
import { allPages, pageInfoSchema, typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Settings › Apps (SetDev "apps"; FIRST-RELEASE (store) §15; apps/api src/apis/store/apps.ts): private apps that run on their own site.

const paging = 'pageInfo { hasNextPage hasPreviousPage startCursor endCursor }'

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

export const loadApps = (client: ApiClient): Promise<InstalledApp[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          `query Apps($after: String) { apps(first: 50, after: $after) { nodes { id appId name developer siteUrl scopes suspended installedByName installedAt lastUsedAt connection } ${paging} } }`,
          z.object({ apps: z.object({ nodes: z.array(installedSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).apps,
  )

/** The consent screen's app, or null when no app has that id. */
export const loadInstallableApp = async (client: ApiClient, id: string): Promise<InstallableApp | null> =>
  (await typedQuery(client)('query Installable($id: ID!) { installableApp(id: $id) { id name developer siteUrl scopes } }', z.object({ installableApp: installableSchema.nullable() }), { id })).installableApp

/** The scopes go back as the Owner saw them; the API refuses `SCOPES_CHANGED` when the app has asked for others since. */
export const installApp = async (client: ApiClient, appId: string, scopes: readonly string[]): Promise<void> => {
  await typedQuery(client)('mutation InstallApp($a: ID!, $s: [String!]!) { installApp(appId: $a, scopes: $s) }', z.object({ installApp: z.string().nullable() }), { a: appId, s: scopes })
}

export const uninstallApp = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation UninstallApp($id: ID!) { uninstallApp(id: $id) }', z.object({ uninstallApp: z.boolean().nullable() }), { id })
}
