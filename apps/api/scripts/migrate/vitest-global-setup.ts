import { assertLocalHost } from './host-guard'

export default function setup(): void {
  assertLocalHost(process.env.DATABASE_URL ?? 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel')
}
