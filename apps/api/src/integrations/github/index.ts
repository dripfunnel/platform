import type { Config } from '#core/config'
import { localGitHub } from '../local/github'
import { createGitHubApp, type GitHubApp } from './app'

export { createGitHubApp, GitHubUnavailable, type GitHubApp } from './app'
export { storeRepos, type RepoChange, type StoreRepos } from './repos'

// Locally the stand-in lives as long as the isolate, so the repos a run made are there for its next step.
let local: Promise<GitHubApp> | undefined

const localApp = async (org: string): Promise<GitHubApp> => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const pkcs8 = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey))))
  const github = localGitHub({ org, installationId: '1', appId: '1', verifyKey: keys.publicKey })
  return createGitHubApp({ appId: '1', installationId: '1', privateKey: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`, fetchImpl: github.fetch })
}

/** Whether store repos can be made here: the stand-in where asked for, else the App's three values. */
export const githubConfigured = (config: Config): boolean => config.GITHUB_LOCAL === '1' || config.GITHUB_APP_PRIVATE_KEY !== undefined

/** The stand-in wins where asked for (config refuses it off localhost), as the other stand-ins do. */
export const githubFor = async (config: Config): Promise<GitHubApp | null> => {
  if (config.GITHUB_LOCAL === '1') return (local ??= localApp(config.GITHUB_STORE_ORG))
  const { GITHUB_APP_ID: appId, GITHUB_APP_INSTALLATION_ID: installationId, GITHUB_APP_PRIVATE_KEY: privateKey } = config
  return appId && installationId && privateKey ? createGitHubApp({ appId, installationId, privateKey }) : null
}
