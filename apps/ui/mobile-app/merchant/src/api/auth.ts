import { z } from 'zod'
import { ApiError, decode, nextPage, pageInfoSchema, postJson, typedQuery, type ApiClient, type RestOptions } from '@dripfunnel/mobile-shared/graphql'

// The merchant portal's sign-in routes on the partner's host (ACCESS.md §4). With no Origin and no cookie each
// answer carries the session as `token`; a refusal is an ApiError with the route's code.

export const codeChannelSchema = z.enum(['whatsapp', 'sms'])
export type CodeChannel = z.infer<typeof codeChannelSchema>

/** Where a phone code can go now (ACCESS.md §4 "How a portal code reaches a phone"). */
export const codeChannelsSchema = z.object({ whatsapp: z.boolean(), sms: z.boolean() })
export type CodeChannels = z.infer<typeof codeChannelsSchema>

const signInAnswer = z.object({
  step: z.enum(['done', 'second-factor', 'enrol']),
  method: z.enum(['app', 'sms']).nullable().optional(),
  codeChannels: codeChannelsSchema.optional(),
  token: z.string(),
})
/** A code sent: by which channel, to the number's last four (`•••• 0142`), and where the next one can go. */
const codeSentAnswer = z.object({ hint: z.string(), channel: codeChannelSchema, codeChannels: codeChannelsSchema })
export type CodeSent = z.infer<typeof codeSentAnswer>
const channelOf = (channel: CodeChannel | undefined) => (channel ? { channel } : {})
const tokenAnswer = z.object({ token: z.string() })
const backupCodeAnswer = z.object({ token: z.string(), left: z.number() })
const enrolledAnswer = z.object({ token: z.string(), backupCodes: z.array(z.string()) })

export type SignInStep = z.infer<typeof signInAnswer>

export const signIn = async (rest: RestOptions, email: string, password: string): Promise<SignInStep> =>
  decode(signInAnswer, await postJson(rest, '/api/auth/sign-in', { email: email.trim(), password }))

/** Google's native sign-in: its ID token, issued for the partner's web client, opens a session as a password does (ACCESS.md §2). */
export const signInWithGoogle = async (rest: RestOptions, idToken: string): Promise<SignInStep> =>
  decode(signInAnswer, await postJson(rest, '/api/auth/google/token', { idToken }))

/** Sends the code to the person's own number, by the channel asked for or else WhatsApp while it is open; refused CHANNEL_OFF or TOO_SOON (`seconds`). */
export const sendCode = async (rest: RestOptions, pendingToken: string, channel?: CodeChannel): Promise<CodeSent> =>
  decode(codeSentAnswer, await postJson(rest, '/api/auth/send-code', channelOf(channel), pendingToken))

export const verifyCode = async (rest: RestOptions, pendingToken: string, code: string): Promise<string> =>
  decode(tokenAnswer, await postJson(rest, '/api/auth/second-factor', { code }, pendingToken)).token

export const signInWithBackupCode = async (rest: RestOptions, pendingToken: string, code: string): Promise<{ token: string; left: number }> =>
  decode(backupCodeAnswer, await postJson(rest, '/api/auth/backup-code', { code }, pendingToken))

/** Set-up for a held session by a phone code (a team that requires 2-factor, #1008): the number first, then the code it was sent, which ends with the backup codes. */
export const enrolSendCode = async (rest: RestOptions, pendingToken: string, phone: string, channel?: CodeChannel): Promise<CodeSent> =>
  decode(codeSentAnswer, await postJson(rest, '/api/auth/enrol-second-factor', { method: 'sms', phone, ...channelOf(channel) }, pendingToken))

export const enrolConfirm = async (rest: RestOptions, pendingToken: string, code: string): Promise<{ token: string; backupCodes: string[] }> =>
  decode(enrolledAnswer, await postJson(rest, '/api/auth/enrol-second-factor', { method: 'sms', code }, pendingToken))

/** Always answers the same, whether or not the email has an account (ACCESS.md §2). */
export const requestPasswordReset = async (rest: RestOptions, email: string): Promise<void> => {
  await postJson(rest, '/api/auth/request-password-reset', { email: email.trim() })
}

// The stores a person belongs to on this partner, read before any store is acting (ARCHITECTURE.md §4 step 5).
const named = z.object({ id: z.string(), name: z.string() })

const choiceSchema = z.object({
  membershipId: z.string(),
  role: z.string(),
  tier: z.string().nullable(),
  store: named,
  seller: named.nullable(),
})

export type StoreChoice = z.infer<typeof choiceSchema>

const storesAnswer = z.object({
  me: z.object({ email: z.string(), name: z.string().nullable() }),
  myStores: z.object({ nodes: z.array(choiceSchema), pageInfo: pageInfoSchema }),
})

const storesQuery = `query Stores($after: String) { me { email name } myStores(first: 50, after: $after) { nodes { membershipId role tier store { id name } seller { id name } } pageInfo { startCursor endCursor hasPreviousPage hasNextPage } } }`

// 50 stores a page, so this is 5,000 memberships: past it the server's paging is broken, and a chooser that left
// stores out (and called a held last store "removed") would be worse than an error.
const maxPages = 100

export const loadStores = async (client: ApiClient): Promise<{ email: string; stores: StoreChoice[] }> => {
  const query = typedQuery(client)
  const stores: StoreChoice[] = []
  let after: string | undefined
  for (let page = 0; page < maxPages; page += 1) {
    const answer = await query(storesQuery, storesAnswer, { after })
    stores.push(...answer.myStores.nodes)
    const next = nextPage(answer.myStores.pageInfo)
    if (!next?.after) return { email: answer.me.email, stores }
    after = next.after
  }
  throw new ApiError('BAD_RESPONSE', 'The API kept offering more stores than a person can belong to.')
}

const switched = z.object({ switchStore: choiceSchema })

/** Tells the API which store the person opens, which it checks against their memberships (a store not held is refused). */
export const switchStore = async (client: ApiClient, choice: StoreChoice): Promise<void> => {
  await typedQuery(client)(`mutation Switch($storeId: ID!, $supplierId: ID) { switchStore(storeId: $storeId, supplierId: $supplierId) { membershipId role tier store { id name } seller { id name } } }`, switched, {
    storeId: choice.store.id,
    supplierId: choice.seller?.id ?? null,
  })
}
