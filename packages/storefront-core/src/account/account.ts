'use client'

import { useState } from 'react'
import { z } from 'zod'
import { addressProblems, compact, emailPattern, isPhone, type AddressDraft, type AddressField, type FieldProblem } from '../checkout/address'
import { ShopApiError } from '../platform/api/client'
import { keepShopperToken, shopperToken } from '../platform/api/tokens'
import { navigate, useLocation } from '../platform/browser/router'
import { useShopData } from '../platform/render/data'
import { useStorefront } from '../platform/store/context'

// Shopper sign-in and the account (storefront ARCHITECTURE §2.1 `account`, `authentication`): the Shop API's sign-in by
// email and password or by a code, and the signed-in shopper's details and addresses. Only a live shop signs in (PREVIEW §5).

export type SignInChannel = 'email' | 'phone'
export type CodeStep = { channel: SignInChannel; to: string }

const optionsQuery = `query SignInOptions { signInOptions { email phone } }`
const optionsSchema = z.object({ signInOptions: z.object({ email: z.boolean().nullable().optional(), phone: z.boolean().nullable().optional() }).nullable() })
const sessionSchema = z.object({ sessionToken: z.string().nullable().optional(), created: z.boolean().nullable().optional() }).nullable()
const signInMutation = `mutation SignIn($email: String!, $password: String!) { signIn(email: $email, password: $password) { sessionToken created } }`
const requestMutation = `mutation RequestCode($channel: ShopSignInChannel!, $to: String!) { requestSignInCode(channel: $channel, to: $to) }`
const verifyMutation = `mutation VerifyCode($channel: ShopSignInChannel!, $to: String!, $code: String!, $name: String, $password: String) { verifySignInCode(channel: $channel, to: $to, code: $code, name: $name, password: $password) { sessionToken created } }`
const signOutMutation = `mutation SignOut { signOut }`

const codeOf = (error: unknown) => (error instanceof ShopApiError ? error.code : 'UNKNOWN')
const channelArg = (c: SignInChannel) => (c === 'email' ? 'EMAIL' : 'PHONE')

/** Where to go once signed in: `?next=` when it is a page of this shop, else the account. */
const nextOf = (query: URLSearchParams) => {
  const next = query.get('next')
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account/'
}

export type SignInPage = {
  /** The ways this shop signs shoppers in; both until it answers. */
  ways: { email: boolean; phone: boolean }
  /** A preview or the studio frame: nobody signs in there (the Shop API refuses with NOT_IN_PREVIEW). */
  previewOnly: boolean
  busy: boolean
  /** The last refusal's code: SIGN_IN_REFUSED, CODE_REFUSED, WEAK_PASSWORD, RATE_LIMITED, METHOD_OFF, NOT_IN_PREVIEW, … */
  error: string | null
  /** A code was sent: to whom, by which channel. */
  sent: CodeStep | null
  signIn: (input: { email: string; password: string; remember: boolean }) => Promise<Partial<Record<'email' | 'password', FieldProblem>>>
  sendCode: (input: CodeStep) => Promise<Partial<Record<'to', FieldProblem>>>
  /** The code proves the email or number; with `name` and `password` it also makes the account or sets its password. */
  verify: (input: { code: string; name?: string; password?: string; remember: boolean }) => Promise<Partial<Record<'code' | 'name' | 'password', FieldProblem>>>
  /** Back to the form a code was asked from. */
  restart: () => void
}

/** The sign-in, create-account and reset-password pages' behaviour; once signed in, the shopper goes on to `?next=`. */
export const useSignIn = (): SignInPage => {
  const { client, mode } = useStorefront()
  const { query } = useLocation()
  const previewOnly = mode !== 'live'
  const options = useShopData(previewOnly ? null : 'signInOptions', (c) => c.query(optionsQuery, optionsSchema))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<CodeStep | null>(null)

  const ask = async <T>(work: () => Promise<T>): Promise<T | null> => {
    if (previewOnly) {
      setError('NOT_IN_PREVIEW')
      return null
    }
    setBusy(true)
    setError(null)
    try {
      return await work()
    } catch (e) {
      setError(codeOf(e))
      return null
    } finally {
      setBusy(false)
    }
  }
  const enter = (session: z.infer<typeof sessionSchema>, remember: boolean) => {
    if (!session?.sessionToken) return setError('UNKNOWN')
    keepShopperToken('session', session.sessionToken, { remember })
    navigate(nextOf(query))
  }

  const ways = options.data?.signInOptions
  return {
    ways: { email: ways?.email ?? true, phone: ways?.phone ?? true },
    previewOnly,
    busy,
    error,
    sent,
    signIn: async ({ email, password, remember }) => {
      const problems: Partial<Record<'email' | 'password', FieldProblem>> = {}
      if (!email.trim()) problems.email = 'required'
      else if (!emailPattern.test(email.trim())) problems.email = 'invalid'
      if (!password) problems.password = 'required'
      if (Object.keys(problems).length > 0) return problems
      const answer = await ask(() => client.query(signInMutation, z.object({ signIn: sessionSchema }), { email: email.trim(), password }))
      if (answer) enter(answer.signIn, remember)
      return {}
    },
    sendCode: async ({ channel, to }) => {
      const value = to.trim()
      if (!value) return { to: 'required' }
      if (channel === 'email' ? !emailPattern.test(value) : !isPhone(value)) return { to: 'invalid' }
      const answer = await ask(() => client.query(requestMutation, z.object({ requestSignInCode: z.boolean().nullable() }), { channel: channelArg(channel), to: value }))
      if (answer) setSent({ channel, to: value })
      return {}
    },
    verify: async ({ code, name, password, remember }) => {
      if (!sent) return {}
      const problems: Partial<Record<'code' | 'name' | 'password', FieldProblem>> = {}
      if (!/^\d{6}$/.test(code.trim())) problems.code = code.trim() ? 'invalid' : 'required'
      if (name !== undefined && !name.trim()) problems.name = 'required'
      if (password !== undefined && password.length < 10) problems.password = password ? 'invalid' : 'required'
      if (Object.keys(problems).length > 0) return problems
      const answer = await ask(() => client.query(verifyMutation, z.object({ verifySignInCode: sessionSchema }), { channel: channelArg(sent.channel), to: sent.to, code: code.trim(), name: name?.trim() ?? null, password: password ?? null }))
      if (answer) enter(answer.verifySignInCode, remember)
      return {}
    },
    restart: () => {
      setSent(null)
      setError(null)
    },
  }
}

const addressFields = 'id name line1 line2 city region postalCode country phone isDefault'
const accountQuery = `query Account { account { id name email phone emailVerified phoneVerified addresses { ${addressFields} } } store { markets { countries } } }`
const text = z.string().nullable().optional()
const accountSchema = z.object({
  account: z
    .object({
      id: text,
      name: text,
      email: text,
      phone: text,
      emailVerified: z.boolean().nullable().optional(),
      phoneVerified: z.boolean().nullable().optional(),
      addresses: z.array(z.object({ id: z.string(), name: text, line1: text, line2: text, city: text, region: text, postalCode: text, country: text, phone: text, isDefault: z.boolean().nullable().optional() })).nullable().optional(),
    })
    .nullable(),
  store: z.object({ markets: z.array(z.object({ countries: z.array(z.string()).nullable().optional() })).nullable().optional() }).nullable().optional(),
})
const renameMutation = `mutation Rename($name: String) { updateAccount(name: $name) }`
const saveAddressMutation = `mutation SaveAddress($id: ID, $address: ShopSavedAddressInput!, $isDefault: Boolean) { saveAddress(id: $id, address: $address, isDefault: $isDefault) }`
const deleteAddressMutation = `mutation DeleteAddress($id: ID!) { deleteAddress(id: $id) }`

const draftOf = (a: AddressDraft) => ({ name: a.name.trim(), line1: a.line1.trim(), line2: a.line2.trim() || null, city: a.city.trim(), region: a.region.trim() || null, postalCode: a.postalCode.trim() || null, country: a.country, phone: compact(a.phone) || null })

export type SavedAddress = AddressDraft & { id: string; isDefault: boolean }

export type Account = {
  name: string | null
  email: string | null
  phone: string | null
  emailVerified: boolean
  phoneVerified: boolean
  addresses: SavedAddress[]
}

export type AccountPage = {
  /** `signedOut` when there's no session, or it ended; the theme sends the shopper to sign in. */
  status: 'loading' | 'ready' | 'signedOut' | 'error'
  code: string | null
  account: Account | null
  /** The countries the store sells to, for an address. */
  countries: string[]
  retry: () => void
  busy: boolean
  /** The last change's refusal: INVALID_INPUT, TOO_MANY, NOT_FOUND, … A session that ended (SIGNED_OUT) is `signedOut` instead. */
  error: { code: string; of: 'details' | 'addresses' } | null
  rename: (name: string) => Promise<boolean>
  saveAddress: (input: { id: string | null; address: AddressDraft; isDefault: boolean }) => Promise<Partial<Record<AddressField, FieldProblem>> | null>
  /** The saved address becomes the default, sent as it was saved. */
  makeDefault: (id: string) => Promise<boolean>
  removeAddress: (id: string) => Promise<boolean>
  signOut: () => Promise<void>
}

/** The signed-in shopper's own account; never asked for on a preview, where nobody signs in. */
export const useAccount = (): AccountPage => {
  const { client, mode } = useStorefront()
  const signedIn = mode === 'live' && shopperToken('session') !== undefined
  const loaded = useShopData(signedIn ? 'account' : null, (c) => c.query(accountQuery, accountSchema))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AccountPage['error']>(null)
  const raw = loaded.data?.account ?? null
  const account: Account | null = raw
    ? {
        name: raw.name ?? null,
        email: raw.email ?? null,
        phone: raw.phone ?? null,
        emailVerified: raw.emailVerified === true,
        phoneVerified: raw.phoneVerified === true,
        addresses: (raw.addresses ?? []).map((a) => ({ id: a.id, name: a.name ?? '', line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '', region: a.region ?? '', postalCode: a.postalCode ?? '', country: a.country ?? '', phone: a.phone ?? '', isDefault: a.isDefault === true })),
      }
    : null

  const change = async (of: 'details' | 'addresses', operation: string, variables: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await client.request(operation, variables)
      loaded.retry()
      return true
    } catch (e) {
      const code = codeOf(e)
      // The session ended while the page was open: forget it, so the account reads as signed out and sends the shopper to sign in.
      if (code === 'SIGNED_OUT') keepShopperToken('session', null)
      setError({ code, of })
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    status: !signedIn || (loaded.status === 'ready' && !raw) || loaded.code === 'SIGNED_OUT' ? 'signedOut' : loaded.status === 'ready' ? 'ready' : loaded.status === 'error' ? 'error' : 'loading',
    code: loaded.code,
    account,
    countries: [...new Set((loaded.data?.store?.markets ?? []).flatMap((m) => m.countries ?? []))],
    retry: loaded.retry,
    busy,
    error,
    rename: (name) => change('details', renameMutation, { name: name.trim() || null }),
    saveAddress: async ({ id, address, isDefault }) => {
      const problems = addressProblems(address)
      if (Object.keys(problems).length > 0) return problems
      return (await change('addresses', saveAddressMutation, { id, address: draftOf(address), isDefault })) ? {} : null
    },
    makeDefault: (id) => {
      const saved = account?.addresses.find((a) => a.id === id)
      // Sent as it was saved: the Shop API judges it, and a refusal shows as `error` (core's newer checks would only hide it).
      return saved ? change('addresses', saveAddressMutation, { id, address: draftOf(saved), isDefault: true }) : Promise.resolve(false)
    },
    removeAddress: (id) => change('addresses', deleteAddressMutation, { id }),
    signOut: async () => {
      await client.request(signOutMutation).catch(() => undefined)
      keepShopperToken('session', null)
      navigate('/')
    },
  }
}
