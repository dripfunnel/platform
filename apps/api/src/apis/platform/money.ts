import { builder } from './builder'

/** The Platform API's one money shape: integer minor units with their currency. */
export const MoneyType = builder.objectRef<{ amount: number; currency: string }>('Money').implement({
  fields: (t) => ({ amount: t.expose('amount', { type: 'MinorUnits' }), currency: t.exposeString('currency') }),
})
