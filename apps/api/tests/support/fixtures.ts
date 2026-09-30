import type postgres from 'postgres'

// The shape ACCESS.md §11.1 asks for, as far as this card's tables reach: two partners, each
// with two stores, each store with two suppliers, and customers in each store.
//
// The rest of §11.1 — a person who is Staff in one store and a vendor in another, API keys,
// app grants, support sessions opened by a partner user, one of each staff role — needs
// memberships and identity, which are #13's and #14's. Each of those cards extends this.

export interface Tenants {
  partnerA: string
  partnerB: string
  storeA1: string
  storeA2: string
  storeB1: string
  sellerA1First: string
  sellerA1Second: string
  sellerB1: string
  customerA1: string
  customerA2: string
  customerB1: string
}

const id = (rows: postgres.RowList<{ id: string }[]>): string => {
  const row = rows[0]
  if (!row) throw new Error('fixture insert returned no row')
  return row.id
}

/** Inserted as the owner, bypassing RLS on purpose: the fixtures are the world, not a caller. */
export const seedTenants = async (sql: postgres.Sql): Promise<Tenants> => {
  const partner = async () => id(await sql<{ id: string }[]>`insert into partner default values returning id`)
  const store = async (partnerId: string) =>
    id(await sql<{ id: string }[]>`insert into store (partner_id) values (${partnerId}) returning id`)
  const seller = async (storeId: string, name: string) =>
    id(
      await sql<{ id: string }[]>`
        insert into seller (store_id, name, access_level, status)
        values (${storeId}, ${name}, 'vendor-stock', 'active') returning id
      `,
    )
  const customer = async (storeId: string, email: string) =>
    id(
      await sql<{ id: string }[]>`
        insert into customer (store_id, email, status) values (${storeId}, ${email}, 'active') returning id
      `,
    )

  const partnerA = await partner()
  const partnerB = await partner()
  const storeA1 = await store(partnerA)
  const storeA2 = await store(partnerA)
  const storeB1 = await store(partnerB)

  return {
    partnerA,
    partnerB,
    storeA1,
    storeA2,
    storeB1,
    sellerA1First: await seller(storeA1, 'Anand Textiles'),
    sellerA1Second: await seller(storeA1, 'Bhatia Threads'),
    sellerB1: await seller(storeB1, 'Chandra Supply'),
    // The same address in two stores, which §2 allows and a global unique index would not.
    customerA1: await customer(storeA1, 'priya@example.com'),
    customerA2: await customer(storeA2, 'priya@example.com'),
    customerB1: await customer(storeB1, 'priya@example.com'),
  }
}
