import SchemaBuilder from '@pothos/core'
import { secureSchema, type Api } from './scope'

/** An API with no caller yet (the Shop API, until SAPI 8) serves only `public` fields, so
 *  anything else fails the build. */
export const createSchema = (api: Api) => {
  const builder = new SchemaBuilder<object>({})
  builder.queryType({
    fields: (t) => ({
      health: t.string({ extensions: { access: { api, scope: 'public', permission: null } }, resolve: () => 'ok' }),
    }),
  })
  return secureSchema(builder.toSchema(), { api, scopes: ['public'], permissions: [], authorize: async () => {} })
}
