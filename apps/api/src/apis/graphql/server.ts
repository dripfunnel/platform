import type { GraphQLSchema } from 'graphql'
import { createYoga } from 'graphql-yoga'

/**
 * `context` receives whatever `fetch(request, extra)` is given, which is how the resolved
 * caller reaches a resolver without a side channel.
 */
export const createServer = <Context extends Record<string, unknown>>(
  schema: GraphQLSchema,
  endpoint: string,
) => createYoga<Context>({ schema, graphqlEndpoint: endpoint, graphiql: false, landingPage: false })
