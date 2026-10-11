import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose'
import { actionsIssuer } from '../github/oidc'
import { presignGet, type StorefrontR2 } from '../cloudflare/r2'

// A store build's two outside parties on this machine (docs/setup/local.md §6.1), with GITHUB_LOCAL: GitHub's OIDC
// issuer, whose key lives as long as the isolate, and Cloudflare's temporary credentials, which name nothing real.

export interface LocalActions {
  keys: JWTVerifyGetKey
  /** A token as a run of the store's workflow would get it; tests and local runs change any claim. */
  mint: (claims: Record<string, unknown>, audience: string, now?: Date) => Promise<string>
}

let issuer: Promise<LocalActions> | undefined

const makeIssuer = async (): Promise<LocalActions> => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const kid = crypto.randomUUID()
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }] })
  return {
    keys,
    mint: (claims, audience, now = new Date()) => {
      const at = Math.floor(now.getTime() / 1000)
      return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid }).setIssuer(actionsIssuer).setAudience(audience).setIssuedAt(at).setExpirationTime(at + 300).sign(privateKey)
    },
  }
}

export const localActions = (): Promise<LocalActions> => (issuer ??= makeIssuer())

/** GitHub's key set as the local issuer holds it, in the shape `verifyActionsToken` takes. */
export const localActionsKeys: JWTVerifyGetKey = async (header, token) => (await localActions()).keys(header, token)

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Credentials and links in Cloudflare's shapes, for an account that doesn't exist: nothing they name can be reached. */
export const localStorefrontR2 = (): StorefrontR2 => ({
  endpoint: 'https://local.r2.localhost',
  mintPrefix: async () => ({ accessKeyId: randomHex(16), secretAccessKey: randomHex(32), sessionToken: randomHex(64) }),
  readLink: (bucket, key, expiresSeconds, now) =>
    presignGet({ host: 'local.r2.localhost', path: `/${bucket}/${key}`, accessKeyId: 'local', secretAccessKey: 'local', region: 'auto', expiresSeconds, now }),
})
