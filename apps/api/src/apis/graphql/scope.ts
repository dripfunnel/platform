import {
  defaultFieldResolver,
  GraphQLError,
  isNonNullType,
  isObjectType,
  type GraphQLField,
  type GraphQLSchema,
} from 'graphql'
import type { AccessTarget } from '#auth/assignment'
import type { StaffPermission } from '#auth/permissions'

export type Api = 'admin' | 'platform' | 'store' | 'shop'

/** ACCESS.md §3.1. `public` and `session` need no permission; every other scope needs one. */
export type FieldScope = 'public' | 'session' | 'store' | 'store-seller' | 'partner' | 'platform'

export interface Access<Args = Record<string, unknown>> {
  api: Api
  scope: FieldScope
  permission: StaffPermission | null
  /** What a targeted field acts on, so a partner-scoped role is held to its partners.
   *  `'none'` is a deliberate answer: a list, which filters its own rows. */
  target?: 'none' | ((args: Args) => AccessTarget)
}

declare module 'graphql' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a merge must repeat graphql's own parameter list
  interface GraphQLFieldExtensions<_TSource, _TContext, _TArgs> {
    access?: Access<_TArgs>
  }
}

/** The codes clients map to sign-in and to the permission-denied state (ui/README.md §6). */
export const accessErrorCode = { unauthenticated: 'UNAUTHENTICATED', forbidden: 'FORBIDDEN' } as const

// One message per code, whatever the target: the refusal must not say whether it exists.
export const unauthenticated = () =>
  new GraphQLError('Not signed in.', { extensions: { code: accessErrorCode.unauthenticated } })
export const forbidden = () => new GraphQLError('Not allowed.', { extensions: { code: accessErrorCode.forbidden } })

const isRefusal = (error: unknown) =>
  error instanceof GraphQLError &&
  Object.values<unknown>(accessErrorCode).includes(error.extensions['code'])

export interface AccessPolicy<Context> {
  api: Api
  /** The scopes this API serves; any other fails the build. */
  scopes: readonly FieldScope[]
  /** Throws `unauthenticated()` or `forbidden()`. Never called for `public` fields. */
  authorize: (access: Access, context: Context, args: Record<string, unknown>) => Promise<void>
}

class AccessDeclarationError extends Error {}

const checkDeclaration = <Context>(where: string, access: Access | undefined, policy: AccessPolicy<Context>): Access => {
  if (!access) throw new AccessDeclarationError(`${where} declares no access (ACCESS.md §3.1)`)
  if (access.api !== policy.api) throw new AccessDeclarationError(`${where} is declared for the ${access.api} API`)
  if (!policy.scopes.includes(access.scope)) {
    throw new AccessDeclarationError(`${where} declares scope ${access.scope}, which this API does not serve`)
  }
  const open = access.scope === 'public' || access.scope === 'session'
  if (open !== (access.permission === null)) {
    throw new AccessDeclarationError(`${where}: only public and session fields go without a permission`)
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
        await policy.authorize(access, context, args)
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
  const roots = new Set([schema.getQueryType(), schema.getMutationType()])
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isObjectType(type) || type.name.startsWith('__')) continue
    const isRoot = roots.has(type)
    for (const field of Object.values(type.getFields())) {
      const where = `${type.name}.${field.name}`
      if (isRoot) {
        guard(field, checkDeclaration(where, field.extensions.access, policy), policy, 'throw')
      } else if (field.extensions.access) {
        if (isNonNullType(field.type)) throw new AccessDeclarationError(`${where} must be nullable to be refused`)
        guard(field, checkDeclaration(where, field.extensions.access, policy), policy, 'null')
      }
    }
  }
  return schema
}
