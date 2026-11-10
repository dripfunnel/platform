import type postgres from 'postgres'

/** A visible product at ₹10 a version, 10 in stock, whose versions are its options' choices; returns their ids in order. */
export const productWithChoices = async (sql: postgres.Sql, storeId: string, name: string, options: string[], versions: { choices: string[]; name?: string }[]): Promise<string[]> => {
  const [product] = await sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, ${name}, ${name.toLowerCase().replaceAll(' ', '-')}, 'visible') returning id`
  const productId = product?.id ?? ''
  const optionIds = await Promise.all(
    options.map(async (option, position) => (await sql<{ id: string }[]>`insert into product_option (store_id, product_id, name, position) values (${storeId}, ${productId}, ${option}, ${position}) returning id`)[0]?.id ?? ''),
  )
  const values = new Map<string, string>()
  const valueOf = async (optionId: string, choice: string) => {
    const key = `${optionId}:${choice}`
    const known = values.get(key)
    if (known) return known
    const [row] = await sql<{ id: string }[]>`insert into product_option_value (store_id, option_id, name, position) values (${storeId}, ${optionId}, ${choice}, ${values.size}) returning id`
    values.set(key, row?.id ?? '')
    return row?.id ?? ''
  }
  const ids: string[] = []
  for (const [position, version] of versions.entries()) {
    const [row] = await sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, name, position) values (${storeId}, ${productId}, ${`${productId}-${position}`}, ${version.name ?? null}, ${position}) returning id`
    const id = row?.id ?? ''
    for (const [i, choice] of version.choices.entries()) {
      const optionId = optionIds[i] ?? ''
      await sql`insert into product_version_option_value (version_id, option_id, value_id, store_id) values (${id}, ${optionId}, ${await valueOf(optionId, choice)}, ${storeId})`
    }
    await sql`insert into version_price (version_id, store_id, currency, amount) values (${id}, ${storeId}, 'INR', 1000)`
    await sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${id}, w.id, ${storeId}, 10 from warehouse w where w.store_id = ${storeId} and w.is_default`
    ids.push(id)
  }
  return ids
}
