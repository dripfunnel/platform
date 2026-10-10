import {
  defaultFieldResolver,
  GraphQLError,
  isNonNullType,
  isObjectType,
  type GraphQLField,
  type GraphQLSchema,
} from 'graphql'
import type { AccessTarget } from '#auth/assignment'
import type { PartnerPermission } from '#auth/partnerPermissions'
import type { StaffPermission } from '#auth/permissions'
import type { StorePermission } from '#auth/storePermissions'

export type Api = 'admin' | 'platform' | 'store' | 'shop'

/** ACCESS.md §3.1. `public`, `session` and `shop` (a storefront's own store) need no permission; every other scope needs one. */
export type FieldScope = 'public' | 'session' | 'shop' | 'store' | 'store-seller' | 'partner' | 'platform'

export interface Access<Args = Record<string, unknown>> {
  api: Api
  scope: FieldScope
  permission: StaffPermission | PartnerPermission | StorePermission | null
  /** What a targeted field acts on, so a partner-scoped role is held to its partners.
   *  `'none'` is a deliberate answer: a list, which filters its own rows. */
  target?: 'none' | ((args: Args) => AccessTarget)
  /** The activity-log action the mutation writes (LOGGING.md §5). Required on every mutation not `unlogged`. */
  audit?: string
  /** Why a mutation writes no entry: only a rule LOGGING itself states (§5). */
  unlogged?: UnloggedRule
  /** The staff sessions refused this field whatever their role (ACCESS.md §8.1, §8.2, §8.3). */
  blockedFor?: readonly StaffSessionKind[]
  /** A mutation that still works while the store is read-only: paying, signing out (FIRST-RELEASE §19). */
  whileReadOnly?: boolean
  /** API keys may call it too, within their scopes (ACCESS.md §5.6); every other field refuses them. */
  machine?: true
}

export type StaffSessionKind = 'impersonation' | 'setup'

/** The writes LOGGING.md §3 leaves out of the activity log, each by the rule that says so. */
export type UnloggedRule = 'cart' | 'payment_return'

declare module 'graphql' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a merge must repeat graphql's own parameter list
  interface GraphQLFieldExtensions<_TSource, _TContext, _TArgs> {
    access?: Access<_TArgs>
  }
}

/** The codes clients map to sign-in and to the permission-denied state (ui/README.md §6). */
export const accessErrorCode = {
  unauthenticated: 'UNAUTHENTICATED',
  forbidden: 'FORBIDDEN',
  blockedWhileImpersonating: 'BLOCKED_WHILE_IMPERSONATING',
  partnerEntersThisItself: 'PARTNER_ENTERS_THIS_ITSELF',
  // The Store API's: no acting store named, a supplier to choose, a suspended store, writes while
  // read-only (ACCESS.md §4, FIRST-RELEASE §19).
  storeRequired: 'STORE_REQUIRED',
  supplierRequired: 'SUPPLIER_REQUIRED',
  storeSuspended: 'STORE_SUSPENDED',
  readOnly: 'READ_ONLY',
} as const

// One message per code, whatever the target: the refusal must not say whether it exists.
export const unauthenticated = () =>
  new GraphQLError('Not signed in.', { extensions: { code: accessErrorCode.unauthenticated } })
export const forbidden = () => new GraphQLError('Not allowed.', { extensions: { code: accessErrorCode.forbidden } })
export const blockedIn = (kind: StaffSessionKind) =>
  kind === 'impersonation'
    ? new GraphQLError('Only the user can change this.', { extensions: { code: accessErrorCode.blockedWhileImpersonating } })
    : new GraphQLError('The partner enters this itself.', { extensions: { code: accessErrorCode.partnerEntersThisItself } })

const isRefusal = (error: unknown) =>
  error instanceof GraphQLError &&
  Object.values<unknown>(accessErrorCode).includes(error.extensions['code'])

export interface AccessPolicy<Context> {
  api: Api
  /** The scopes this API serves; any other fails the build. */
  scopes: readonly FieldScope[]
  /** This API's permission catalogue; a field naming another API's permission fails the build. */
  permissions: readonly string[]
  /** The permissions a `machine` field may declare; an API without machine callers leaves it out, and any `machine` field fails the build. */
  machinePermissions?: readonly string[]
  /** Throws `unauthenticated()` or `forbidden()`. Never called for `public` fields. */
  authorize: (access: Access, context: Context, args: Record<string, unknown>, operation: 'query' | 'mutation' | 'subscription') => Promise<void>
}

class AccessDeclarationError extends Error {}

const checkDeclaration = <Context>(
  where: string,
  access: Access | undefined,
  policy: AccessPolicy<Context>,
  kind: 'query' | 'mutation' | 'field',
): Access => {
  if (!access) throw new AccessDeclarationError(`${where} declares no access (ACCESS.md §3.1)`)
  if (kind === 'mutation' && !access.audit && !access.unlogged) throw new AccessDeclarationError(`${where} declares no audit action (LOGGING.md §5)`)
  if (access.api !== policy.api) throw new AccessDeclarationError(`${where} is declared for the ${access.api} API`)
  if (!policy.scopes.includes(access.scope)) {
    throw new AccessDeclarationError(`${where} declares scope ${access.scope}, which this API does not serve`)
  }
  const open = access.scope === 'public' || access.scope === 'session' || access.scope === 'shop'
  if (open !== (access.permission === null)) {
    throw new AccessDeclarationError(`${where}: only public, session and shop fields go without a permission`)
  }
  if (access.permission !== null && !policy.permissions.includes(access.permission)) {
    throw new AccessDeclarationError(`${where} declares ${access.permission}, which is not a ${policy.api} API permission`)
  }
  if (access.machine && (access.permission === null || !(policy.machinePermissions ?? []).includes(access.permission))) {
    throw new AccessDeclarationError(`${where} is open to keys with ${access.permission ?? 'no permission'}, which they can't be granted`)
  }
  if (!open && access.target === undefined) {
    throw new AccessDeclarationError(`${where} declares no target; use 'none' for a list`)
  }
  return access
}

// The schema's own field objects are rewrapped, so nothing executes the undeclared resolver.
const guard = <Context>(field: GraphQLField<unknown, Context>, access: Access, policy: AccessPolicy<Context>, onRefusal: 'throw' | 'null') => {
  const resolve = field.resolve ?? defaultFieldResolver
  field.resolve = async (source, args, context, info) => {
    if (access.scope !== 'public') {
      try {
        await policy.authorize(access, context, args, info.operation.operation)
      } catch (error) {
        if (onRefusal === 'null' && isRefusal(error)) return null
        throw error
      }
    }
    return resolve(source, args, context, info)
  }
}

/**
 * Every Query and Mutation field must declare its access, or this throws while
 * the schema is built. A field on another type may declare a stricter one and reads as null
 * when refused (decided on #14).
 */
export const secureSchema = <Context>(schema: GraphQLSchema, policy: AccessPolicy<Context>): GraphQLSchema => {
  if (schema.getSubscriptionType()) throw new AccessDeclarationError('Subscriptions are not guarded yet')
  const mutation = schema.getMutationType()
  const roots = new Set([schema.getQueryType(), mutation])
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isObjectType(type) || type.name.startsWith('__')) continue
    const isRoot = roots.has(type)
    for (const field of Object.values(type.getFields())) {
      const where = `${type.name}.${field.name}`
      if (isRoot) {
        guard(field, checkDeclaration(where, field.extensions.access, policy, type === mutation ? 'mutation' : 'query'), policy, 'throw')
      } else if (field.extensions.access) {
        if (isNonNullType(field.type)) throw new AccessDeclarationError(`${where} must be nullable to be refused`)
        guard(field, checkDeclaration(where, field.extensions.access, policy, 'field'), policy, 'null')
      }
    }
  }
  return schema
}
