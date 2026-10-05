import { GraphQLError } from 'graphql'
import {
  personBackupCodesGenerated,
  personEmailChangeRequested,
  personOtherSessionsEnded,
  personPasswordChanged,
  personProfileUpdated,
  personSecondFactorChanged,
  personSecondFactorDisabled,
  personSecondFactorEnrolled,
  type ActivityEntry,
} from '#auth/activity'
import { emailChangeValidMs } from '#auth/emailChangeTokens'
import { hashPassword, minPasswordLength, verifyPassword } from '#auth/password'
import type { StorePerson } from '#auth/storeCaller'
import { hashBackupCode, maxSmsCodesPer10Min, newBackupCodes, phoneHint } from '#auth/storeCodes'
import { checkCode, newTotpSecret, otpauthUri } from '#auth/totp'
import { pageOf } from '#core/paging'
import { isE164 } from '#core/sms'
import { deviceOf } from '#core/userAgent'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  changeUserPassword,
  countEmailChangesSince,
  endOtherSessions,
  insertEmailChange,
  selectMyActivity,
  selectMySessions,
  selectPendingSecondFactor,
  selectProfile,
  setPendingSecondFactor,
  turnOffUserSecondFactor,
  updateProfileDetails,
  updateUserTheme,
  type ProfileRow,
} from '#db/scoped/profile'
import { countCodesSince, replaceBackupCodes, selectSignInCandidate, setUserSecondFactor } from '#db/scoped/userSignIn'
import { queueSideEffect } from '#saas/outbox/index'
import { forbidden } from '../graphql/scope'
import type { StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { brandName, checkTextedCode, countWrong, textCode } from './codes'
import { storePage } from './refusals'

// My profile (FIRST-RELEASE §4, PortalProfile): one account across the partner's stores, so every
// field here is the session's, never an acting store's (ACCESS.md §4 says why it runs in system scope).

const refused = (code: string, message: string) => new GraphQLError(message, { extensions: { code } })

const sqlOf = (ctx: StoreContext) => {
  if (!ctx.sql) throw forbidden()
  return ctx.sql
}

const personOf = (ctx: StoreContext): StorePerson => {
  if (ctx.standing.kind === 'signed-out') throw forbidden()
  return ctx.standing.person
}

const userOf = (p: StorePerson) => ({ id: p.id, partnerId: p.partnerId })
const maxSessions = 50
const maxEmailChangesPerDay = 3

interface Profile {
  name: string
  email: string
  pendingEmail: string | null
  phone: string | null
  theme: string | null
  passwordChangedAt: string | null
  twoFactor: { method: string | null; backupCodesLeft: number; required: boolean }
}

const profileOf = (r: ProfileRow): Profile => ({
  name: r.name,
  email: r.email,
  pendingEmail: r.pending_email,
  phone: r.phone,
  theme: r.theme,
  passwordChangedAt: r.password_changed_at?.toISOString() ?? null,
  twoFactor: { method: r.two_factor_method, backupCodesLeft: r.backup_codes_left, required: r.is_owner },
})

const readProfile = async (tx: ScopedSql, person: StorePerson, now: Date): Promise<ProfileRow> => {
  const row = await selectProfile(tx, person.id, now)
  if (!row) throw forbidden()
  return row
}

interface SecondFactorStep {
  secret: string | null
  uri: string | null
  hint: string | null
  done: boolean
  backupCodes: string[] | null
}

const step = (s: Partial<SecondFactorStep>): SecondFactorStep => ({ secret: null, uri: null, hint: null, done: false, backupCodes: null, ...s })

/**
 * The current password, counted like sign-in's (a wrong one is committed before the refusal, the fifth
 * pauses everything): a stolen session can't guess it here, nor change the second factor without it.
 */
const provePassword = async (tx: ScopedSql, ctx: StoreContext, person: StorePerson, typed: string | null | undefined, now: Date): Promise<GraphQLError | null> => {
  const candidate = await selectSignInCandidate(tx, person.partnerId, person.email)
  if (!candidate) return forbidden()
  if (candidate.locked_until && candidate.locked_until > now) return refused('LOCKED', 'Too many wrong tries. Try again in 15 minutes.')
  if (await verifyPassword((typed ?? '').slice(0, 1024), candidate.password_hash)) return null
  const { locked } = await countWrong(tx, ctx.activity, ctx.facts, candidate, now)
  return locked ? refused('LOCKED', 'Too many wrong tries. Try again in 15 minutes.') : refused('INVALID_CREDENTIALS', 'That isn’t your current password.')
}

export const registerProfile = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)

  const TwoFactor = builder.objectRef<Profile['twoFactor']>('TwoFactor').implement({
    fields: (t) => ({
      method: t.exposeString('method', { nullable: true }),
      backupCodesLeft: t.exposeInt('backupCodesLeft'),
      // An Owner may switch method but never turn it off (ACCESS.md §4).
      required: t.exposeBoolean('required'),
    }),
  })

  const ProfileType = builder.objectRef<Profile>('Profile').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      email: t.exposeString('email'),
      pendingEmail: t.exposeString('pendingEmail', { nullable: true }),
      phone: t.exposeString('phone', { nullable: true }),
      theme: t.exposeString('theme', { nullable: true }),
      passwordChangedAt: t.exposeString('passwordChangedAt', { nullable: true }),
      twoFactor: t.field({ type: TwoFactor, resolve: (p) => p.twoFactor }),
    }),
  })

  interface SessionView {
    device: string | null
    current: boolean
    createdAt: string
    lastUsedAt: string
  }
  const SessionType = builder.objectRef<SessionView>('SignedInSession').implement({
    fields: (t) => ({
      device: t.exposeString('device', { nullable: true }),
      current: t.exposeBoolean('current'),
      createdAt: t.exposeString('createdAt'),
      lastUsedAt: t.exposeString('lastUsedAt'),
    }),
  })

  interface ActivityView {
    id: string
    occurredAt: string
    action: string
    result: string
    storeId: string | null
    target: { type: string; label: string | null } | null
  }
  const ActivityTarget = builder.objectRef<{ type: string; label: string | null }>('MyActivityTarget').implement({
    fields: (t) => ({ type: t.exposeString('type'), label: t.exposeString('label', { nullable: true }) }),
  })
  const ActivityType = builder.objectRef<ActivityView>('MyActivityEntry').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      occurredAt: t.exposeString('occurredAt'),
      action: t.exposeString('action'),
      result: t.exposeString('result'),
      storeId: t.exposeString('storeId', { nullable: true }),
      target: t.field({ type: ActivityTarget, nullable: true, resolve: (a) => a.target }),
    }),
  })
  const ActivityPage = builder.objectRef<{ nodes: ActivityView[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('MyActivity').implement({
    fields: (t) => ({ nodes: t.field({ type: [ActivityType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })

  const StepType = builder.objectRef<SecondFactorStep>('SecondFactorStep').implement({
    fields: (t) => ({
      // The secret and backup codes appear once, in the answer that makes them (ui/README.md §3).
      secret: t.exposeString('secret', { nullable: true }),
      uri: t.exposeString('uri', { nullable: true }),
      hint: t.exposeString('hint', { nullable: true }),
      done: t.exposeBoolean('done'),
      backupCodes: t.exposeStringList('backupCodes', { nullable: true }),
    }),
  })

  const session = { api: 'store', scope: 'session', permission: null } as const

  builder.queryFields((t) => ({
    profile: t.field({
      type: ProfileType,
      extensions: { access: session },
      resolve: async (_, __, ctx) => {
        const person = personOf(ctx)
        return profileOf(await withSystemScope(sqlOf(ctx), (tx) => readProfile(tx, person, ctx.now())))
      },
    }),
    mySessions: t.field({
      type: [SessionType],
      extensions: { access: session },
      resolve: async (_, __, ctx) => {
        const person = personOf(ctx)
        const rows = await withSystemScope(sqlOf(ctx), (tx) => selectMySessions(tx, person.id, ctx.now(), person.sessionHash, maxSessions))
        return rows.map((r) => ({ device: r.device_label ?? deviceOf(r.user_agent), current: r.current, createdAt: r.created_at.toISOString(), lastUsedAt: r.last_seen_at.toISOString() }))
      },
    }),
    myActivity: t.field({
      type: ActivityPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: session },
      resolve: async (_, args, ctx) => {
        const person = personOf(ctx)
        const window = storePage(args)
        const rows = await withSystemScope(sqlOf(ctx), (tx) => selectMyActivity(tx, person.id, person.partnerId, window))
        const page = pageOf(rows, window, (r) => ({ occurredAt: r.occurred_at, id: r.id }))
        return {
          nodes: page.nodes.map((r) => ({ id: r.id, occurredAt: r.occurred_at.toISOString(), action: r.action, result: r.result, storeId: r.store_id, target: r.target_type ? { type: r.target_type, label: r.target_label } : null })),
          pageInfo: page.pageInfo,
        }
      },
    }),
  }))

  const record = (ctx: StoreContext, tx: ScopedSql, entry: ActivityEntry) => ctx.activity.record(tx, entry)

  builder.mutationFields((t) => ({
    updateProfile: t.field({
      type: ProfileType,
      // The theme is setTheme's alone, so saving details never undoes one set on another device.
      args: { name: t.arg.string({ required: true }), phone: t.arg.string() },
      extensions: { access: { ...session, audit: 'person.profile_updated', whileReadOnly: true } },
      resolve: async (_, args, ctx) => {
        const person = personOf(ctx)
        const name = args.name.trim()
        if (name === '' || name.length > 120) throw refused('NAME_REQUIRED', 'Add your name.')
        const phone = args.phone?.trim() ? args.phone.trim() : null
        if (phone !== null && !isE164(phone)) throw refused('INVALID_PHONE', 'Use the full number with the country code.')
        const now = ctx.now()
        return profileOf(
          await withSystemScope(sqlOf(ctx), async (tx) => {
            const before = await readProfile(tx, person, now)
            // The number a sign-in code goes to changes only by proving it (setSecondFactor), never here.
            if (before.two_factor_method === 'sms' && phone !== before.phone) throw refused('PHONE_IN_USE_FOR_SIGN_IN', 'Change this number under Two-step sign-in, which texts it a code first.')
            await updateProfileDetails(tx, person.id, { name, phone })
            await record(ctx, tx, personProfileUpdated(userOf(person), ctx.facts))
            return readProfile(tx, person, now)
          }),
        )
      },
    }),
    // Appearance (PortalProfile): the theme alone, which also works while the store is read-only.
    setTheme: t.field({
      type: ProfileType,
      args: { theme: t.arg.string({ required: true }) },
      extensions: { access: { ...session, audit: 'person.profile_updated', whileReadOnly: true } },
      resolve: async (_, args, ctx) => {
        const person = personOf(ctx)
        if (args.theme !== 'light' && args.theme !== 'dark') throw refused('INVALID_INPUT', 'Choose light or dark.')
        const theme = args.theme
        const now = ctx.now()
        return profileOf(
          await withSystemScope(sqlOf(ctx), async (tx) => {
            await updateUserTheme(tx, person.id, theme)
            await record(ctx, tx, personProfileUpdated(userOf(person), ctx.facts))
            return readProfile(tx, person, now)
          }),
        )
      },
    }),
    changeEmail: t.field({
      type: 'Boolean',
      args: { email: t.arg.string({ required: true }), password: t.arg.string({ required: true }) },
      extensions: { access: { ...session, audit: 'person.email_change_requested', whileReadOnly: true } },
      resolve: async (_, args, ctx) => {
        const person = personOf(ctx)
        const email = args.email.trim()
        if (email.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw refused('INVALID_EMAIL', 'That email doesn’t look right.')
        const now = ctx.now()
        const refusal = await withSystemScope(sqlOf(ctx), async (tx): Promise<GraphQLError | null> => {
          const proven = await provePassword(tx, ctx, person, args.password, now)
          if (proven) return proven
          const profile = await readProfile(tx, person, now)
          if (profile.email.toLowerCase() === email.toLowerCase()) return null
          if ((await countEmailChangesSince(tx, person.id, new Date(now.getTime() - 24 * 60 * 60 * 1000))) >= maxEmailChangesPerDay) throw refused('RATE_LIMITED', 'Try again tomorrow.')
          // The same answer whether or not another account uses the address: the link then changes nothing.
          const changeId = await insertEmailChange(tx, userOf(person), email, new Date(now.getTime() + emailChangeValidMs), now)
          for (const template of ['user-email-change', 'user-email-changing'] as const) {
            await queueSideEffect(tx, { kind: 'email', idempotencyKey: `${template}:${changeId}`, payload: { template, emailChangeId: changeId }, partnerId: person.partnerId, storeId: null })
          }
          await record(ctx, tx, personEmailChangeRequested(userOf(person), ctx.facts))
          return null
        })
        if (refusal) throw refusal
        return true
      },
    }),
    changePassword: t.field({
      type: 'Boolean',
      args: { current: t.arg.string({ required: true }), next: t.arg.string({ required: true }) },
      extensions: { access: { ...session, audit: 'person.password_changed', whileReadOnly: true } },
      resolve: async (_, args, ctx) => {
        const person = personOf(ctx)
        if (args.next.length < minPasswordLength || args.next.length > 1024) throw refused('WEAK_PASSWORD', 'Use at least 10 characters.')
        const now = ctx.now()
        const sql = sqlOf(ctx)
        const proven = await withSystemScope(sql, (tx) => provePassword(tx, ctx, person, args.current, now))
        if (proven instanceof GraphQLError) throw proven
        const hash = await hashPassword(args.next)
        await withSystemScope(sql, async (tx) => {
          await changeUserPassword(tx, person.id, hash, person.sessionHash, now)
          await record(ctx, tx, personPasswordChanged(userOf(person), ctx.facts))
        })
        return true
      },
    }),
    setSecondFactor: t.field({
      type: StepType,
      args: { method: t.arg.string({ required: true }), code: t.arg.string(), password: t.arg.string() },
      extensions: { access: { ...session, audit: 'two_factor.method_changed', whileReadOnly: true } },
      resolve: async (_, args, ctx) => {
        const person = personOf(ctx)
        const now = ctx.now()
        const code = args.code?.trim() ?? null
        // A wrong code is answered after commit, so its counted try is kept (ACCESS.md §4: five tries).
        const outcome = await withSystemScope(sqlOf(ctx), async (tx): Promise<SecondFactorStep | GraphQLError> => {
          const profile = await readProfile(tx, person, now)
          const turningOn = profile.two_factor_method === null
          // Every start and every off needs the password; a confirm needs the pending state only a proven start stores.
          if (args.method === 'off' || code === null) {
            const proven = await provePassword(tx, ctx, person, args.password, now)
            if (proven) return proven
          }
          const finish = async (method: 'app' | 'sms', secretEnc: string | null, phone: string | null, totpStep: number | null) => {
            await setUserSecondFactor(tx, person.id, method, secretEnc, phone, totpStep, now)
            await setPendingSecondFactor(tx, person.sessionHash, person.id, { secretEnc: null, phone: null })
            if (!turningOn) {
              await record(ctx, tx, personSecondFactorChanged(userOf(person), ctx.facts, method))
              return step({ done: true })
            }
            const codes = newBackupCodes()
            await replaceBackupCodes(tx, userOf(person), await Promise.all(codes.map((c) => hashBackupCode(person.id, c))))
            await record(ctx, tx, personSecondFactorEnrolled(userOf(person), ctx.facts, method))
            await record(ctx, tx, personBackupCodesGenerated(userOf(person), ctx.facts))
            return step({ done: true, backupCodes: codes })
          }
          if (args.method === 'off') {
            if (profile.is_owner) throw refused('SECOND_FACTOR_REQUIRED', 'Store owners keep two-step sign-in on.')
            if (turningOn) return step({ done: true })
            await turnOffUserSecondFactor(tx, person.id)
            await record(ctx, tx, personSecondFactorDisabled(userOf(person), ctx.facts))
            return step({ done: true })
          }
          if (args.method === 'app') {
            const secrets = ctx.secrets
            if (!secrets) throw refused('NOT_CONNECTED', 'Two-step sign-in isn’t available right now.')
            if (code === null) {
              const secret = newTotpSecret()
              await setPendingSecondFactor(tx, person.sessionHash, person.id, { secretEnc: await secrets.seal(secret), phone: null })
              return step({ secret, uri: otpauthUri(secret, profile.email, await brandName(tx, person.partnerId, now)) })
            }
            const pending = await selectPendingSecondFactor(tx, person.sessionHash, person.id)
            const secret = pending?.pending_secret_enc ? await secrets.open(pending.pending_secret_enc) : null
            if (!pending?.pending_secret_enc || !secret) throw refused('CODE_EXPIRED', 'Start again to get a new setup key.')
            const checked = await checkCode(secret, code, now, null)
            if (!checked.ok && checked.code === 'WRONG_CODE') {
              const { locked } = await countWrong(tx, ctx.activity, ctx.facts, { id: person.id, partner_id: person.partnerId, email: profile.email }, now)
              return locked ? refused('LOCKED', 'Too many wrong tries. Try again in 15 minutes.') : refused('WRONG_CODE', 'That code doesn’t match.')
            }
            if (!checked.ok) return refused(checked.code, 'That code has expired.')
            return finish('app', pending.pending_secret_enc, null, checked.step)
          }
          if (args.method === 'sms') {
            const phone = profile.phone
            if (!phone) throw refused('PHONE_REQUIRED', 'Add your mobile number first.')
            if (code === null) {
              if ((await countCodesSince(tx, person.id, new Date(now.getTime() - 10 * 60_000))) >= maxSmsCodesPer10Min) throw refused('RATE_LIMITED', 'Wait a few minutes before asking for another code.')
              await setPendingSecondFactor(tx, person.sessionHash, person.id, { secretEnc: null, phone })
              await textCode(tx, person.partnerId, person.id, phone, 'enrol_phone', now)
              return step({ hint: phoneHint(phone) })
            }
            const pending = await selectPendingSecondFactor(tx, person.sessionHash, person.id)
            // The code proves the number it was sent to; a number changed since needs a new code.
            if (pending?.pending_phone !== phone) throw refused('CODE_EXPIRED', 'Ask for a new code.')
            const checked = await checkTextedCode(tx, person.id, 'enrol_phone', code, now)
            if (checked !== 'ok') return refused(checked === 'wrong' ? 'WRONG_CODE' : 'CODE_EXPIRED', checked === 'wrong' ? 'That code doesn’t match.' : 'That code has expired.')
            return finish('sms', null, phone, null)
          }
          throw refused('INVALID_INPUT', 'Choose app, sms or off.')
        })
        if (outcome instanceof GraphQLError) throw outcome
        return outcome
      },
    }),
    regenerateBackupCodes: t.stringList({
      extensions: { access: { ...session, audit: 'backup_codes.generated', whileReadOnly: true } },
      resolve: async (_, __, ctx) => {
        const person = personOf(ctx)
        return withSystemScope(sqlOf(ctx), async (tx) => {
          const profile = await readProfile(tx, person, ctx.now())
          if (profile.two_factor_method === null) throw refused('SECOND_FACTOR_REQUIRED', 'Turn on two-step sign-in first.')
          const codes = newBackupCodes()
          await replaceBackupCodes(tx, userOf(person), await Promise.all(codes.map((c) => hashBackupCode(person.id, c))))
          await record(ctx, tx, personBackupCodesGenerated(userOf(person), ctx.facts))
          return codes
        })
      },
    }),
    signOutOtherSessions: t.int({
      extensions: { access: { ...session, audit: 'sessions.others_ended', whileReadOnly: true } },
      resolve: async (_, __, ctx) => {
        const person = personOf(ctx)
        return withSystemScope(sqlOf(ctx), async (tx) => {
          const ended = await endOtherSessions(tx, person.id, person.sessionHash, ctx.now())
          await record(ctx, tx, personOtherSessionsEnded(userOf(person), ctx.facts))
          return ended
        })
      },
    }),
  }))
}
