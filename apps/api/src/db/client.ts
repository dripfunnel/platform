import postgres from 'postgres'
import type { Config } from '#core/config'

export const getClient = (config: Config): postgres.Sql => postgres(config.HYPERDRIVE.connectionString, { max: 5, fetch_types: false })
