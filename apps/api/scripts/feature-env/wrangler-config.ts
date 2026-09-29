import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'
import { z } from 'zod'
import type { Names } from './names'

const baseSchema = z.looseObject({ main: z.string(), vars: z.record(z.string(), z.string()).optional() })
type Base = z.infer<typeof baseSchema>

const basePath = new URL('../../wrangler.jsonc', import.meta.url)
const featureConfigPath = new URL('../../wrangler.feature.json', import.meta.url)

export const readBaseConfig = (): Base => {
  const { config, error } = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(basePath, 'utf8'))
  if (error) throw new Error(`wrangler.jsonc: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)
  return baseSchema.parse(config)
}

export const featureConfig = (base: Base, names: Names, zone: string, hyperdriveId: string) => ({
  ...base,
  name: names.worker,
  workers_dev: false,
  preview_urls: false,
  vars: {
    ...base.vars,
    ADMIN_HOST: names.host('admin'),
    PLATFORM_HOST: names.host('platform'),
    HOOKS_HOST: names.host('hooks'),
  },
  routes: [
    ...(['admin', 'platform', 'store'] as const).map((spa) => ({ pattern: `${names.host(spa)}/api/*`, zone_name: zone })),
    { pattern: names.host('hooks'), custom_domain: true },
  ],
  hyperdrive: [{ binding: 'HYPERDRIVE', id: hyperdriveId }],
})

export const writeFeatureConfig = (config: ReturnType<typeof featureConfig>) =>
  writeFileSync(featureConfigPath, `${JSON.stringify(config, null, 2)}\n`)
