import SchemaBuilder from '@pothos/core'
import { secureSchema, type Api } from './scope'

/** The Platform, Store and Shop APIs serve only `public` fields until their cards add a
 *  caller and a policy, so anything else fails the build. */
export const createSchema = (api: Api) => {
  const builder = new SchemaBuilder<object>({})
  builder.queryType({
    fields: (t) => ({
      health: t.string({ extensions: { access: { api, scope: 'public', permission: null } }, resolve: () => 'ok' }),
    }),
  })
  return secureSchema(builder.toSchema(), { api, scopes: ['public'], permissions: [], authorize: async () => {} })
}
