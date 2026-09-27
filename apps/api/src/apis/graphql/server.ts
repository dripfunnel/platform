import type { GraphQLSchema } from 'graphql'
import { createYoga } from 'graphql-yoga'

export const createServer = (schema: GraphQLSchema, endpoint: string) =>
  createYoga({ schema, graphqlEndpoint: endpoint, graphiql: false, landingPage: false })
