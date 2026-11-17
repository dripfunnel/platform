import type postgres from 'postgres'
import { z } from 'zod'
import type { SecretBox } from '#auth/secretBox'
import { selectSealedCourierAccounts } from '#db/scoped/courierAccounts'
import { withSystemScope } from '#db/scoped/index'
import type { StoreCourierAccounts } from './index'

// A store's own courier logins (#1489; THIRD-PARTY-ACCESS §4): sealed as one value by the shipping service, opened only
// here, where a call to the courier is about to go out.

const sealedLogin = z.object({ password: z.string().min(1), webhookToken: z.string().min(1).nullish() })

// A value that opens to something else (a key rotation, a bad write) is no account, never a thrown error at checkout.
const parsedLogin = (opened: string) => {
  try {
    return sealedLogin.safeParse(JSON.parse(opened))
  } catch {
    return null
  }
}

/** The store's logins, opened; a store with none, or a value that won't open, has no account. */
export const storeCourierAccounts =
  (sql: postgres.Sql, secrets: SecretBox | null) =>
  async (storeId: string): Promise<StoreCourierAccounts> => {
    const none: StoreCourierAccounts = { shiprocket: null, easypost: null }
    if (!secrets) return none
    const row = (await withSystemScope(sql, (tx) => selectSealedCourierAccounts(tx, storeId))).find((r) => r.provider === 'shiprocket')
    const opened = row ? await secrets.open(row.credentials_sealed) : null
    const login = opened ? parsedLogin(opened) : null
    return login?.success && row ? { ...none, shiprocket: { email: row.email, password: login.data.password, webhookToken: login.data.webhookToken ?? null } } : none
  }
