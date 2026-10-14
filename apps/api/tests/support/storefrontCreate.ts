import { readFileSync } from 'node:fs'
import type postgres from 'postgres'
import { createGitHubApp } from '#integrations/github/index'
import { localGitHub, type LocalGitHub } from '#integrations/local/github'
import type { CreateDeps } from '#saas/storefronts/index'
import { fakeSites, putText, type FakeSites } from './sites'

// What the create-storefront tests share: the template the release workflow uploads, and the Workflow's dependencies
// over GitHub's stand-in and an in-memory sites bucket.

export const core = '1.4.0'
export const lockedWorkflow = readFileSync(new URL('../../../../templates/storefront/.github/workflows/build.yml', import.meta.url), 'utf8')

const preview = { 'index.html': '<!doctype html><title>Bloom</title>', 'assets/app.js': 'console.log(1)' }

/** What the release workflow uploads for a core version (storefront ARCHITECTURE §2.3). */
export const uploadTemplates = async (sites: FakeSites) => {
  await putText(sites, 'templates/current.json', JSON.stringify({ core }))
  const skeleton = [
    { path: 'package.json', content: JSON.stringify({ name: '@dripfunnel/storefront-template', private: true, dependencies: { '@dripfunnel/storefront-core': 'workspace:*', next: '^16.3.6' } }) },
    { path: '.github/workflows/build.yml', content: lockedWorkflow },
    { path: 'next.config.ts', content: 'export default {}\n' },
    { path: 'src/app/layout.tsx', content: 'export default function Layout() { return null }\n' },
  ]
  await putText(sites, `templates/${core}/skeleton.json`, JSON.stringify({ files: skeleton }))
  const theme = [
    { path: 'routes.json', content: '{"routes":{"home":"HomePage"}}' },
    { path: 'src/theme/pages/HomePage.tsx', content: 'export const HomePage = () => null\n' },
    { path: 'content/en/home.json', content: '{"title":"Bloom"}' },
  ]
  await putText(sites, `templates/${core}/themes/bloom/source.json`, JSON.stringify({ files: theme }))
  const files = []
  for (const [path, text] of Object.entries(preview)) files.push({ path, sha256: await putText(sites, `templates/${core}/themes/bloom/preview/files/${path}`, text, path.endsWith('.html') ? 'text/html' : 'text/javascript') })
  await putText(sites, `templates/${core}/themes/bloom/preview/manifest.json`, JSON.stringify({ files }))
}

export const createDepsFor = async (sql: postgres.Sql, now: () => Date): Promise<{ deps: CreateDeps; github: LocalGitHub; sites: FakeSites }> => {
  const github = localGitHub({ org: 'dripfunnel', installationId: '42', appId: '7' })
  const sites = fakeSites()
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey))))}\n-----END PRIVATE KEY-----`
  const app = createGitHubApp({ appId: '7', installationId: '42', privateKey: pem, fetchImpl: github.fetch, sleep: async () => undefined })
  await uploadTemplates(sites)
  return { deps: { sql, github: app, org: 'dripfunnel', sites, now }, github, sites }
}
