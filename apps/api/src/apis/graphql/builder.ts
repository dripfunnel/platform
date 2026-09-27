import SchemaBuilder from '@pothos/core'

export const createBuilder = () => {
  const builder = new SchemaBuilder<object>({})
  builder.queryType({
    fields: (t) => ({
      health: t.string({ resolve: () => 'ok' }),
    }),
  })
  return builder
}
