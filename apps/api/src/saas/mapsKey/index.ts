import type postgres from 'postgres'
import type { SecretBox } from '#auth/secretBox'
import { isUuid } from '#core/ids'
import { withSystemScope } from '#db/scoped/index'
import { selectStoreMapsKeys, type StoreMapsKeys } from '#db/scoped/mapsKey'
import { senderOf } from '#saas/sms/index'

// The Google Maps key a store's maps use (#1612; THIRD-PARTY-ACCESS §2.12, §4), read in this one place: the partner's choice
// where both keys are usable, else the one that is, else none, and no key means no map. DripFunnel's is usable only while
// Super admin turned it on, Admin let this partner use it, and it is Working; the partner's own only while Working.

export type MapsKeyOwner = 'own' | 'dripfunnel'

export const mapsKeyOwner = (keys: StoreMapsKeys): MapsKeyOwner | null => senderOf(keys.choice, keys.own?.status === 'ok', keys.ours?.status === 'ok' && keys.ours.allowed)

/** The open key for a store, or null where none is usable; only the frame and the two frame addresses ask. */
export type StoreMapsKey = (storeId: string) => Promise<string | null>

export const storeMapsKey =
  (sql: postgres.Sql, secrets: SecretBox | null): StoreMapsKey =>
  async (storeId) => {
    if (!secrets || !isUuid(storeId)) return null
    const keys = await withSystemScope(sql, (tx) => selectStoreMapsKeys(tx, storeId))
    const owner = keys ? mapsKeyOwner(keys) : null
    const sealed = owner === 'own' ? keys?.own?.keyEnc : owner === 'dripfunnel' ? keys?.ours?.keyEnc : null
    return sealed ? secrets.open(sealed) : null
  }
