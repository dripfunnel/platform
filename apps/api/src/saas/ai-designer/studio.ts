import type { ActivityEntry } from '#auth/activity'
import type { StoreRole } from '#auth/storePermissions'
import { isUuid } from '#core/ids'
import { logEvent, failureCode } from '#core/log'
import type { TenantContext } from '#core/tenancy'
import { insertDesignMessage, markUndone, moveFlow, selectDesignChat, selectLatestChange, selectLatestFlow, selectMessage, selectRecentRequests, type MessageRow } from '#db/scoped/design'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectPreviewKey } from '#db/scoped/previewAccess'
import { hasUsageLeft, releaseUsage, reserveUsage } from '#db/scoped/storeAccount'
import { selectMerchantImageKey } from '#db/scoped/storefrontSettings'
import { makeVisible } from '#db/scoped/catalog'
import { insertAiRun, selectGuardContext, selectStudioStart } from '#db/scoped/studio'
import { AiDeclined, GatewayError, SignInExpired, type AiImage, type AiProvider } from '#integrations/ai/index'
import { maxScreenshotBytes, type Screenshotter } from '#integrations/cloudflare/screenshot'
import type { DnsLookup } from '#integrations/dns/doh'
import { checkedUrl, fetchPublic } from '#integrations/http/publicFetch'
import { maxImageBytes } from '#core/media'
import { createAssetService, type AssetStore } from '#engine/modules/catalog/index'
import { isStockUrl } from '#integrations/stockImages/combine'
import type { StockImages, StockPhoto } from '#integrations/stockImages/pixabay'
import { allowanceFor } from '#saas/entitlements/index'
import { guardContextFor } from '#saas/storefronts/index'
import { liveSender, openStudioSession, renewStudio, studioAccess, type DesignModel, type StudioState } from '#saas/studio/index'
import { chatReply, designModel, type DesignTools, type DesignBrief, type Device } from './model'
import { answersOf, flowOf, isClaimable, maxFailedBuilds, maxPlanChanges, pageRequests, planReply, type BuildFlow, type DesignAsk, type PlanAsk, type PlanFlow, type QuestionsFlow } from './plan'
import { recordAfter, type DesignerDeps, type DesignResult } from './service'
import { buildStoreSummary, freshSummary, keepNew, storeLookups, type StoreSummary } from './summary'
import { designAudit, designErrors, designNotes, type DesignFailureReason } from './words'

// The studio through the Store API (storefront AI-STUDIO §3–§5; SAAS §9.2): the Worker builds the model's context and
// calls the model; the store's StudioSession runs the diff through the fast gate. The request's words are never logged.

export interface StudioDeps extends DesignerDeps {
  role: StoreRole
  /** The designer's provider for who pays: the plan's (the partner's key) or the merchant's own; null when there is none. */
  ai: (billedTo: 'plan' | 'own_key', context: TenantContext, model: string | null) => AiProvider | null | Promise<AiProvider | null>
  /** The models that account can run, the default first; empty where the model isn't the merchant's to pick. */
  models: (billedTo: 'plan' | 'own_key', context: TenantContext) => readonly string[] | Promise<readonly string[]>
  screenshots: Screenshotter | null
  lookup: DnsLookup | null
  /** Stock image search (Pixabay, Pexels, Openverse, Wikimedia Commons); null when no source is on, which hides the picker. */
  stock: StockImages | null
  /** The sources the AI may search and add photos from itself; empty or unset is off (AI-STUDIO §8). */
  aiPhotos?: readonly string[]
  /** Per-store limit on the photo search, download and import; false refuses. */
  allowStock: (key: string) => Promise<boolean>
  /** The assets bucket an imported image is stored in; null where it isn't bound. */
  assets: AssetStore | null
  /** A merchant image's bytes from the assets bucket, by its row's key; null when the bucket isn't bound. */
  readAsset: ((key: string) => Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null>) | null
  /** `my-store.one` (SHOP_DOMAIN); the studio frame opens only on `{slug}-preview.` of it. */
  previewDomain: string | null
}

export type AskInput = { text: string; model: string | null; imageAssetId: string | null; sampleUrl: string | null; page: string; device: Device; mode?: 'change' | 'chat' }
/** The reason a model call failed; the error's class and code don't survive the studio's RPC, so the Worker's own side reads them. */
const reasonOf = (error: unknown): DesignFailureReason | null => {
  if (error instanceof SignInExpired) return 'SIGN_IN_EXPIRED'
  if (error instanceof AiDeclined) return 'DECLINED'
  if (!(error instanceof GatewayError)) return null
  if (error.code === 'RATE_LIMITED' || error.code === 'PROVIDER_UNAVAILABLE' || error.code === 'TIMEOUT') return error.code
  return error.code === 'INVALID_CREDENTIALS' ? 'CREDENTIALS_REJECTED' : error.code === 'CANCELLED' ? null : 'BAD_REQUEST'
}

/** `asked`: the AI answered a vague request with questions or a plan (#1243), and the message is that. */
export type AskAnswer = { outcome: 'changed' | 'unchanged' | 'refused' | 'failed' | 'cancelled' | 'asked'; message: MessageRow }
export type StudioSessionView = StudioState & { session: string; models: readonly string[]; frameUrl: string; access: 'change' | 'view'; expiresAt: Date }
export type TextEntry = { key: string; text: string }

const maxRequest = 2000
/** design_message.sample_url's limit (migration 0333). */
const maxUrl = 2048
/** A page or a text key: names, never words. */
const maxKey = 200
const recentRequests = 4
const imageTypes = new Set<AiImage['mediaType']>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
/** ai_mode's choices (planKeys.ts): the merchant's own key, or AI on the plan, counted against `ai_prompts`. */
const ownKeyMode = 0

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

type Live = ReturnType<typeof liveSender>

const monthStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))

export const createStudioService = (deps: StudioDeps) => {
  const { sql, context, actor, activity, facts, studio, now } = deps
  const { storeId } = context

  const entry = (action: string, changes: NonNullable<ActivityEntry['changes']>, reason: string | null = null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId: null,
    target: { type: 'storefront', id: storeId, label: 'storefront' },
    changes,
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  /** `studioSession`: the frame's address on the store's own preview origin, with a session id signed for this session. */
  const session = async (existing: string | null): Promise<DesignResult<StudioSessionView>> => {
    const access = studioAccess(context, deps.role)
    if (!studio || !deps.previewDomain || !access) return { ok: false, reason: 'NOT_CONNECTED' }
    const key = await withSystemScope(sql, (tx) => selectPreviewKey(tx, storeId))
    if (!key) return { ok: false, reason: 'NOT_FOUND' }
    const renewed = existing ? await renewStudio(sql, context, deps.role, existing, now()) : null
    const opened = existing && renewed ? { id: existing, access, expiresAt: renewed } : await openStudioSession(sql, context, deps.role, now())
    if (!opened) return { ok: false, reason: 'NOT_FOUND' }
    // Opening the studio builds the AI's store summary beside it, so the first change reads no catalogue (ARCHITECTURE §6.2).
    const [state] = await Promise.all([studio.status(storeId), existing ? null : keepNew(studio, storeId, now(), summaryOf).catch(summaryFailed)])
    return { ok: true, value: { ...state, session: opened.id, models: await deps.models(await billing(), context), frameUrl: `https://${key.slug}-preview.${deps.previewDomain}/__studio/${opened.id}/`, access: opened.access, expiresAt: opened.expiresAt } }
  }

  /** `renewStudioSession`: the seat re-checked; a refused renewal ends the session (AI-STUDIO §3 step 6, §8). */
  const renew = async (id: string): Promise<DesignResult<Date>> => {
    const until = await renewStudio(sql, context, deps.role, id, now())
    return until ? { ok: true, value: until } : { ok: false, reason: 'SESSION_ENDED' }
  }

  /**
   * A change's save, which the frame never waits for (AI-STUDIO §4 step 6), runs beside the Worker's own record; the
   * answer waits for both, so every read after it (the draft, Open preview, Undo) sees the change. A save that gave up
   * still answers the change, which is applied and kept in the object until its next save or start (AI-STUDIO §7).
   */
  const savedBeside = async (outcome: string): Promise<void> => {
    if (!studio || outcome !== 'changed') return
    const saved = await studio.saved(storeId).catch((error: unknown) => (logEvent({ event: 'studio_save_unconfirmed', api: 'store', storeId, code: failureCode(error) }), true))
    if (!saved) logEvent({ event: 'studio_save_unconfirmed', api: 'store', storeId, code: 'kept' })
  }

  const chat = (limit: number, before: { at: Date; id: string } | null) => withScope(sql, context, (tx) => selectDesignChat(tx, storeId, limit, before))

  const billing = async (): Promise<'plan' | 'own_key'> => ((await allowanceFor(sql, context, 'ai_mode', now())) === ownKeyMode ? 'own_key' : 'plan')

  /**
   * SAAS §9.2 guardrail 3: on the plan, the request takes one of the month's `ai_prompts` before the model is asked, in
   * one statement, so two at once can't both take the last; a reached allowance stops new requests, never one running.
   */
  const reserve = async (): Promise<boolean> => {
    const allowed = await allowanceFor(sql, context, 'ai_prompts', now())
    return withSystemScope(sql, (tx) => reserveUsage(tx, storeId, 'ai_prompts', monthStart(now()), allowed, now()))
  }

  /** The same allowance read without taking a unit, so a store at its allowance costs no image read or screenshot. */
  const budgetLeft = async (): Promise<boolean> => {
    const allowed = await allowanceFor(sql, context, 'ai_prompts', now())
    return withSystemScope(sql, (tx) => hasUsageLeft(tx, storeId, 'ai_prompts', monthStart(now()), allowed))
  }

  const imageOf = async (assetId: string): Promise<DesignResult<AiImage>> => {
    if (!isUuid(assetId)) return { ok: false, reason: 'INVALID_IMAGE' }
    const key = await withScope(sql, context, (tx) => selectMerchantImageKey(tx, storeId, assetId))
    if (!key) return { ok: false, reason: 'INVALID_IMAGE' }
    const file = deps.readAsset ? await deps.readAsset(key) : null
    if (!file || file.bytes.byteLength > maxScreenshotBytes || !imageTypes.has(file.mime as AiImage['mediaType'])) return { ok: false, reason: 'INVALID_IMAGE' }
    return { ok: true, value: { mediaType: file.mime as AiImage['mediaType'], base64: toBase64(file.bytes) } }
  }

  /** The sample site, screenshotted by the platform at a public https address only (docs/ARCHITECTURE.md §7). */
  const screenshotOf = async (raw: string, device: Device): Promise<DesignResult<AiImage>> => {
    if (!deps.lookup || !deps.screenshots) return { ok: false, reason: 'NOT_CONNECTED' }
    const url = await checkedUrl(raw, deps.lookup, AbortSignal.timeout(5_000)).catch(() => 'UNAVAILABLE' as const)
    if (!(url instanceof URL)) return { ok: false, reason: 'INVALID_URL' }
    const bytes = await deps.screenshots.take(url, device)
    return bytes ? { ok: true, value: { mediaType: 'image/jpeg', base64: toBase64(bytes) } } : { ok: false, reason: 'SAMPLE_UNAVAILABLE' }
  }

  const stockAllowed = () => deps.allowStock(`stock:${storeId}`)

  /** `importDesignImage`: a public https address fetched by the platform and stored as the store's own image (AI-STUDIO §8). */
  const importImage = async (raw: string, fromStock: string | null = null): Promise<DesignResult<string>> => {
    if (!deps.lookup || !deps.assets) return { ok: false, reason: 'NOT_CONNECTED' }
    if (raw.length > maxUrl) return { ok: false, reason: 'INVALID_URL' }
    if (fromStock === null && !(await stockAllowed())) return { ok: false, reason: 'STOCK_BUSY' }
    const got = await fetchPublic(raw, { lookup: deps.lookup, maxBytes: maxImageBytes, timeoutMs: 8_000, tries: 2 })
    if (!got.ok) return { ok: false, reason: got.code === 'BAD_URL' || got.code === 'PRIVATE_ADDRESS' ? 'INVALID_URL' : got.code === 'TOO_LARGE' ? 'INVALID_IMAGE' : 'SAMPLE_UNAVAILABLE' }
    const stored = await createAssetService({ sql, context, actor, activity, facts, store: deps.assets }).upload(got.bytes)
    if (!stored.ok || stored.asset.kind !== 'image') return { ok: false, reason: 'INVALID_IMAGE' }
    await recordAfter(sql, storeId, (tx) => activity.record(tx, entry(designAudit.imageImported, fromStock ? [{ field: 'source', before: null, after: fromStock }] : [])))
    return { ok: true, value: stored.asset.id }
  }

  const summaryOf = () => buildStoreSummary(sql, context, now())
  const summaryFailed = (error: unknown): null => {
    logEvent({ event: 'studio_summary_failed', api: 'store', storeId, code: failureCode(error) })
    return null
  }

  /** The kept summary, or a new one when it is missing or 10 minutes old (#1242); none without a studio. */
  const currentSummary = async (): Promise<StoreSummary | null> => {
    if (!studio) return null
    // A change goes ahead without the summary rather than fail on it.
    return freshSummary(studio, storeId, now(), summaryOf).catch(summaryFailed)
  }

  const shopOf = async (summary: StoreSummary | null): Promise<DesignBrief['store']> => {
    const guard = await withSystemScope(sql, (sys) => selectGuardContext(sys, storeId))
    return { name: summary?.name ?? '', languages: guard ? guardContextFor(guard, []).locales : [] }
  }

  const briefOf = async (input: Pick<AskInput, 'page' | 'device' | 'imageAssetId'>, image: AiImage | null, screenshot: AiImage | null, summary: StoreSummary | null, mayAsk = false): Promise<DesignBrief> => {
    const recent = await withScope(sql, context, (tx) => selectRecentRequests(tx, storeId, recentRequests))
    return {
      page: input.page,
      device: input.device,
      recent: recent.reverse(),
      store: await shopOf(summary),
      summary,
      image,
      imageAssetId: image ? input.imageAssetId : null,
      screenshot,
      mayAsk,
    }
  }

  const record = (tx: ScopedSql, m: Omit<Parameters<typeof insertDesignMessage>[1], 'storeId' | 'createdBy' | 'at'> & { at?: Date }) =>
    insertDesignMessage(tx, { storeId, createdBy: actor.id, at: now(), ...m })

  /** Chat mode: a reply with no change and no sandbox; it takes a prompt like a change (SAAS §9.2) and is metered as a `design` run. */
  const chat_ = async (input: AskInput, text: string, provider: AiProvider, billedTo: 'plan' | 'own_key', image: AiImage | null, shot: AiImage | null, asked: Date, live: Live): Promise<DesignResult<AskAnswer>> => {
    if (billedTo === 'plan' && !(await reserve())) return { ok: false, reason: 'AI_BUDGET_REACHED' }
    let reply: Awaited<ReturnType<typeof chatReply>> | null = null
    let failure: unknown = null
    try {
      reply = await chatReply(provider, await briefOf(input, image, shot, await currentSummary()), text, live.text)
    } catch (error) {
      failure = error
      logEvent({ event: 'storefront_design_failed', api: 'store', storeId, code: error instanceof GatewayError ? `${error.name}:${error.code}` : failureCode(error) })
    }
    if (!reply?.text) {
      if (billedTo === 'plan' && (!failure || failure instanceof SignInExpired || (failure instanceof GatewayError && failure.code === 'INVALID_CREDENTIALS'))) await withSystemScope(sql, (tx) => releaseUsage(tx, storeId, 'ai_prompts', monthStart(now()), now()))
    }
    const outcome: AskAnswer['outcome'] = reply?.text ? 'unchanged' : 'failed'
    const message = await recordAfter(sql, storeId, async (tx) => {
      await record(tx, { role: 'user', text, imageAssetId: input.imageAssetId, sampleUrl: input.sampleUrl, page: input.page, at: asked })
      const runId = reply ? await insertAiRun(tx, { storeId, kind: 'design', requestedBy: actor.id, prompt: text.slice(0, 4000), model: reply.model, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut, costAmount: reply.costAmount, costCurrency: reply.costCurrency, billedTo, sandboxMs: 0, repairAttempts: 0, parentRunId: null, outcome }) : null
      const id = reply?.text ? await record(tx, { role: 'ai', text: reply.text, changed: [], page: null, commit: null, beforeCommit: null, aiRunId: runId }) : await record(tx, { role: 'error', text: designErrors.failedFor(reasonOf(failure)), aiRunId: runId })
      await activity.record(tx, entry(designAudit.designRequested, [{ field: 'outcome', before: null, after: `chat ${outcome}` }]))
      return selectMessage(tx, storeId, id)
    })
    if (!message) throw new Error('design_message: written and not found')
    return { ok: true, value: { outcome, message } }
  }

  /**
   * `askDesign` (SAAS §9.2): budget, then the model through the store's studio (fast gate, up to three repairs), then the
   * chat and the activity entry, which says only that a request was made and its outcome (LOGGING §4.1).
   */
  const ask = (input: AskInput): Promise<DesignResult<AskAnswer>> => followed((run, live) => askIn(input, run, live))

  /** One request's work, its steps sent to the store's open studios as `run` (AI-STUDIO §4 "Live progress"). */
  const followed = async (work: (run: string, live: Live) => Promise<DesignResult<AskAnswer>>): Promise<DesignResult<AskAnswer>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    const run = crypto.randomUUID()
    const live = liveSender(
      (event) => studio.progress(storeId, run, event),
      (error) => logEvent({ event: 'studio_live_lost', api: 'store', storeId, code: failureCode(error) }),
    )
    let answer: DesignResult<AskAnswer>
    try {
      answer = await work(run, live)
    } catch (error) {
      await live.end({ type: 'error', code: 'FAILED' })
      throw error
    }
    await live.end(answer.ok ? { type: 'done', outcome: answer.value.outcome, messageId: answer.value.message.id } : { type: 'error', code: answer.reason })
    return answer
  }

  /** `askDesign`'s work, its steps sent to the store's open studios as `run` (AI-STUDIO §4 "Live progress"). */
  const askIn = async (input: AskInput, run: string, live: Live): Promise<DesignResult<AskAnswer>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    const text = input.text.trim()
    if (text.length === 0 || text.length > maxRequest || input.page.length > maxKey) return { ok: false, reason: 'INVALID_INPUT' }
    if (input.sampleUrl !== null && input.sampleUrl.length > maxUrl) return { ok: false, reason: 'INVALID_URL' }
    live.step(input.mode === 'chat' ? 'asking' : 'reading')
    const billedTo = await billing()
    if (input.model !== null && !(await deps.models(billedTo, context)).includes(input.model)) return { ok: false, reason: 'INVALID_INPUT' }
    const provider = await deps.ai(billedTo, context, input.model)
    if (!provider) return { ok: false, reason: 'AI_NOT_CONNECTED' }
    if (billedTo === 'plan' && !(await budgetLeft())) return { ok: false, reason: 'AI_BUDGET_REACHED' }
    const image = input.imageAssetId ? await imageOf(input.imageAssetId) : null
    if (image && !image.ok) return image
    const shot = input.sampleUrl ? await screenshotOf(input.sampleUrl, input.device) : null
    if (shot && !shot.ok) return shot
    const asked = now()
    if (input.mode === 'chat') return chat_(input, text, provider, billedTo, image?.value ?? null, shot?.value ?? null, asked, live)
    // The photos the model added this request, each in Assets and credited in the chat once the change is recorded.
    const added: { assetId: string; user: string; source: string }[] = []
    const tools: DesignTools | null =
      deps.aiPhotos?.length && deps.stock && deps.assets && deps.lookup
        ? {
            search: async (words) => (!(await stockAllowed()) ? null : (await deps.stock?.search(words, 1))?.photos.filter((p) => deps.aiPhotos?.includes(p.source)).map((p) => ({ id: p.id, tags: p.tags, user: p.user })) ?? null),
            add: async (id) => {
              if (!seen.has(id) || !deps.aiPhotos?.includes(id.split(':')[0] ?? '') || !(await stockAllowed())) return null
              const found = await deps.stock?.download(id)
              if (!found || !isStockUrl(found)) return null
              const stored = await importImage(found, id.split(':')[0] ?? null)
              if (!stored.ok) return null
              const record = { assetId: stored.value, user: seen.get(id) ?? '', source: id.split(':')[0] ?? '' }
              added.push(record)
              return record
            },
          }
        : null
    const seen = new Map<string, string>()
    const stopLoop = new AbortController()
    const known = await currentSummary()
    const designer = designModel(
      provider,
      await briefOf(input, image?.value ?? null, shot?.value ?? null, known, true),
      tools && { ...tools, search: async (words) => (await tools.search(words))?.map((p) => (seen.set(p.id, p.user), p)) ?? null },
      () => undefined,
      stopLoop.signal,
      known && storeLookups({ sql, context, summary: known, readAsset: deps.readAsset }),
    )
    let modelAsked = false
    let modelFailure: unknown = null
    let proposed = ''
    let askedBack: DesignAsk | null = null
    const model: DesignModel = {
      propose: async (proposal) => {
        modelAsked = true
        try {
          const made = await designer.propose(proposal)
          if (made.ask) askedBack = made.ask
          proposed = made.files.map((f) => ('content' in f ? f.content : 'edits' in f ? f.edits.map((e) => e.replace).join('\n') : '')).join('\n')
          return made
        } catch (error) {
          modelFailure = error
          throw error
        }
      },
    }
    // The unit is taken last, so only the studio's own answer stands between it and the model.
    if (billedTo === 'plan' && !(await reserve())) return { ok: false, reason: 'AI_BUDGET_REACHED' }
    // The model was never asked (the sandbox didn't take it, or the studio failed first): the request gives its unit back.
    const giveBack = () => (billedTo === 'plan' ? withSystemScope(sql, (tx) => releaseUsage(tx, storeId, 'ai_prompts', monthStart(now()), now())) : Promise.resolve())
    let answer: Awaited<ReturnType<NonNullable<typeof studio>['change']>> | { outcome: 'failed' }
    try {
      answer = await studio.change(storeId, { request: text, userId: actor.id, billedTo, run }, model)
    } catch (error) {
      logEvent({ event: 'storefront_design_failed', api: 'store', storeId, code: modelFailure instanceof GatewayError ? `${modelFailure.name}:${modelFailure.code}` : failureCode(modelFailure ?? error) })
      answer = { outcome: 'failed' }
    }
    const saved = savedBeside(answer.outcome)
    if (answer.outcome === 'queued' || answer.outcome === 'unavailable' || (answer.outcome === 'failed' && !modelAsked)) await giveBack()
    if (answer.outcome === 'queued') return { ok: false, reason: 'STUDIO_QUEUED', place: answer.place }
    if (answer.outcome === 'unavailable') return { ok: false, reason: 'STUDIO_UNAVAILABLE' }
    if (answer.outcome === 'cancelled') {
      stopLoop.abort()
      // The unit goes back only when the model was never asked (it bills tokens once asked).
      if (!modelAsked) await giveBack()
      const stopped = await recordAfter(sql, storeId, async (tx) => {
        await record(tx, { role: 'user', text, imageAssetId: input.imageAssetId, sampleUrl: input.sampleUrl, page: input.page, at: asked })
        for (const photo of added) await record(tx, { role: 'note', text: designNotes.photoAdded(photo.user, photo.source), imageAssetId: photo.assetId })
        const id = await record(tx, { role: 'note', text: designNotes.stopped })
        await activity.record(tx, entry(designAudit.designRequested, [{ field: 'outcome', before: null, after: 'cancelled' }]))
        return selectMessage(tx, storeId, id)
      })
      if (!stopped) throw new Error('design_message: written and not found')
      return { ok: true, value: { outcome: 'cancelled', message: stopped } }
    }
    if (answer.outcome === 'changed') {
      const used = [...(input.imageAssetId ? [input.imageAssetId] : []), ...added.map((a) => a.assetId)].filter((id) => proposed.includes(id))
      await withScope(sql, context, async (tx) => {
        for (const id of used) await makeVisible(tx, storeId, id)
      })
      for (const photo of added) if (!proposed.includes(photo.assetId)) logEvent({ event: 'storefront_photo_unplaced', api: 'store', storeId, code: photo.source })
    }
    const summary = 'summary' in answer ? answer.summary : null
    if (askedBack && answer.outcome === 'unchanged' && summary) return { ok: true, value: { outcome: 'asked', message: await recordAsked(input, text, asked, askedBack, summary.reply, answer.runId) } }
    const outcome: AskAnswer['outcome'] = answer.outcome === 'changed' || answer.outcome === 'unchanged' ? (summary ? answer.outcome : 'failed') : answer.outcome
    const message = await recordAfter(sql, storeId, async (tx) => {
      await record(tx, { role: 'user', text, imageAssetId: input.imageAssetId, sampleUrl: input.sampleUrl, page: input.page, at: asked })
      for (const photo of added) await record(tx, { role: 'note', text: designNotes.photoAdded(photo.user, photo.source), imageAssetId: photo.assetId })
      const runId = 'runId' in answer ? answer.runId : null
      const id =
        (outcome === 'changed' || outcome === 'unchanged') && summary
          ? await record(tx, { role: 'ai', text: summary.reply, changed: outcome === 'changed' ? summary.changed : [], page: summary.page, commit: answer.outcome === 'changed' ? answer.commit : null, beforeCommit: answer.outcome === 'changed' ? answer.before : null, aiRunId: runId })
          : await record(tx, { role: 'error', text: outcome === 'refused' ? designErrors.refused : designErrors.failedFor(reasonOf(modelFailure)), aiRunId: runId })
      await activity.record(tx, entry(designAudit.designRequested, [{ field: 'outcome', before: null, after: outcome }]))
      return selectMessage(tx, storeId, id)
    })
    await saved
    if (!message) throw new Error('design_message: written and not found')
    return { ok: true, value: { outcome, message } }
  }

  /** A vague request's questions or plan (#1243): its message holds them, and its run is the flow's one prompt unit. */
  const recordAsked = async (input: AskInput, text: string, at: Date, ask: DesignAsk, reply: string, runId: string | null): Promise<MessageRow> => {
    const detail: QuestionsFlow | PlanFlow = 'questions' in ask ? { kind: 'questions', state: 'open', request: text, questions: ask.questions, answers: [] } : { kind: 'plan', state: 'open', request: text, answers: [], plan: ask.plan, changes: 0 }
    const message = await recordAfter(sql, storeId, async (tx) => {
      await record(tx, { role: 'user', text, imageAssetId: input.imageAssetId, sampleUrl: input.sampleUrl, page: input.page, at })
      const id = await record(tx, { role: detail.kind, text: reply, aiRunId: runId, detail })
      await activity.record(tx, entry(designAudit.designRequested, [{ field: 'outcome', before: null, after: detail.kind }]))
      return selectMessage(tx, storeId, id)
    })
    if (!message) throw new Error('design_message: written and not found')
    return message
  }

  /** The model for a flow's next step: the merchant's own pick from the account's list, as askDesign takes it. */
  const providerFor = async (model: string | null): Promise<DesignResult<{ provider: AiProvider; billedTo: 'plan' | 'own_key' }>> => {
    const billedTo = await billing()
    if (model !== null && !(await deps.models(billedTo, context)).includes(model)) return { ok: false, reason: 'INVALID_INPUT' }
    const provider = await deps.ai(billedTo, context, model)
    return provider ? { ok: true, value: { provider, billedTo } } : { ok: false, reason: 'AI_NOT_CONNECTED' }
  }

  /** The store's newest questions or plan, when it is `id` and open (or its claim lapsed): only that one is answered, changed or built. */
  const openQuestions = async (id: string): Promise<{ row: MessageRow; flow: QuestionsFlow } | null> => {
    const open = await latestFlow(id)
    return open?.flow.kind === 'questions' && isClaimable(open.flow, now()) ? { row: open.row, flow: open.flow } : null
  }
  const openPlan = async (id: string): Promise<{ row: MessageRow; flow: PlanFlow } | null> => {
    const open = await latestFlow(id)
    return open?.flow.kind === 'plan' && isClaimable(open.flow, now()) ? { row: open.row, flow: open.flow } : null
  }
  /** A flow as it was before a request claimed it: open, its claim cleared, for the next press. */
  const reopened = <F extends QuestionsFlow | PlanFlow>(flow: F): F => ({ ...flow, state: 'open', claimedAt: null })
  const latestFlow = async (id: string) => {
    if (!isUuid(id)) return null
    const row = await withScope(sql, context, (tx) => selectLatestFlow(tx, storeId))
    const flow = row?.id === id ? flowOf(row.detail) : null
    return row && flow ? { row, flow } : null
  }

  const failedMessage = async (failure: unknown): Promise<MessageRow> => {
    const reason = reasonOf(failure)
    const message = await recordAfter(sql, storeId, async (tx) => selectMessage(tx, storeId, await record(tx, { role: 'error', text: reason ? designErrors.failedFor(reason) : designErrors.planFailed })))
    if (!message) throw new Error('design_message: written and not found')
    return message
  }

  /**
   * The plan from a flow's request, its answers and, when changing one, the plan so far and the merchant's words. It takes
   * no prompt unit: the whole flow is its first request's (SAAS §9.2), and its run sits under that one's.
   */
  const plan = async (open: { row: MessageRow; from: PlanFlow | QuestionsFlow; moved: PlanFlow | QuestionsFlow }, ask: PlanAsk, changes: number, said: string | null, model: string | null, live: Live, audit: ActivityEntry): Promise<DesignResult<AskAnswer>> => {
    const { row } = open
    const ready = await providerFor(model)
    if (!ready.ok) return ready
    // Claimed first, so two tabs can't both answer it; a plan that couldn't be written, or a throw, gives it back.
    const claimed = { ...open.moved, claimedAt: now().toISOString() }
    if (!(await withScope(sql, context, (tx) => moveFlow(tx, storeId, row.id, open.from, claimed)))) return { ok: false, reason: 'PLAN_GONE' }
    const giveBack = (tx: ScopedSql) => moveFlow(tx, storeId, row.id, claimed, reopened(open.from))
    try {
      return await planned(row, giveBack, ask, changes, said, ready.value, live, audit)
    } catch (error) {
      await withScope(sql, context, giveBack).catch(() => undefined)
      throw error
    }
  }

  const planned = async (row: MessageRow, giveBack: (tx: ScopedSql) => Promise<boolean>, ask: PlanAsk, changes: number, said: string | null, ready: { provider: AiProvider; billedTo: 'plan' | 'own_key' }, live: Live, audit: ActivityEntry): Promise<DesignResult<AskAnswer>> => {
    live.step('planning')
    const summary = await currentSummary()
    let made: Awaited<ReturnType<typeof planReply>> | null = null
    let failure: unknown = null
    try {
      made = await planReply(ready.provider, { store: await shopOf(summary), summary }, ask)
    } catch (error) {
      failure = error
      logEvent({ event: 'storefront_plan_failed', api: 'store', storeId, code: error instanceof GatewayError ? `${error.name}:${error.code}` : failureCode(error) })
    }
    const at = now()
    const message = await recordAfter(sql, storeId, async (tx) => {
      if (said !== null) await record(tx, { role: 'user', text: said, at })
      if (made) await insertAiRun(tx, { storeId, kind: 'design', requestedBy: actor.id, prompt: (said ?? ask.request).slice(0, 4000), model: made.model, tokensIn: made.tokensIn, tokensOut: made.tokensOut, costAmount: made.costAmount, costCurrency: made.costCurrency, billedTo: ready.billedTo, sandboxMs: 0, repairAttempts: 0, parentRunId: row.ai_run_id, outcome: made.plan ? 'unchanged' : 'failed' })
      if (!made?.plan) return null
      const detail: PlanFlow = { kind: 'plan', state: 'open', request: ask.request, answers: ask.answers, plan: made.plan, changes }
      const id = await record(tx, { role: 'plan', text: made.reply, aiRunId: row.ai_run_id, detail })
      await activity.record(tx, audit)
      return selectMessage(tx, storeId, id)
    })
    if (message) return { ok: true, value: { outcome: 'asked', message } }
    // A plan that couldn't be written leaves the questions or the plan open, to press again.
    await withScope(sql, context, giveBack)
    return { ok: true, value: { outcome: 'failed', message: await failedMessage(failure) } }
  }

  /** "Make the plan" or "Skip questions" (#1243): `given` in the questions' order, each an option, words of their own or empty. */
  const answerQuestions = (messageId: string, given: readonly string[], skip: boolean, model: string | null): Promise<DesignResult<AskAnswer>> =>
    followed(async (_run, live) => {
      const open = await openQuestions(messageId)
      if (!open) return { ok: false, reason: 'PLAN_GONE' }
      const answers = answersOf(open.flow.questions, skip ? [] : given)
      if (!answers) return { ok: false, reason: 'INVALID_INPUT' }
      const moved: QuestionsFlow = { ...open.flow, state: skip ? 'skipped' : 'answered', answers }
      const count = answers.filter((a) => a.answer !== null).length
      const audit = entry(designAudit.questionsAnswered, [{ field: 'answers', before: null, after: skip ? 'skipped' : String(count) }])
      return plan({ row: open.row, from: open.flow, moved }, { request: open.flow.request, answers, previous: null, change: null }, 0, null, model, live, audit)
    })

  /** A change to the plan asked in words (#1243), at most three a plan, inside the same prompt unit. */
  const changePlan = (messageId: string, words: string, model: string | null): Promise<DesignResult<AskAnswer>> =>
    followed(async (_run, live) => {
      const said = words.trim()
      if (said.length === 0 || said.length > maxRequest) return { ok: false, reason: 'INVALID_INPUT' }
      const open = await openPlan(messageId)
      if (!open) return { ok: false, reason: 'PLAN_GONE' }
      if (open.flow.changes >= maxPlanChanges) return { ok: false, reason: 'PLAN_CHANGES_USED' }
      const audit = entry(designAudit.planChanged, [{ field: 'changes', before: String(open.flow.changes), after: String(open.flow.changes + 1) }])
      return plan({ row: open.row, from: open.flow, moved: { ...open.flow, state: 'replaced' } }, { request: open.flow.request, answers: open.flow.answers, previous: open.flow.plan, change: said }, open.flow.changes + 1, said, model, live, audit)
    })

  /**
   * **Build it** (#1243): every planned page, home first, each its own change through the gate in the store's studio; the
   * build is one message, so one Undo takes it all back. Stop (`cancelDesign`) ends it after the page being built.
   */
  const buildPlan = (messageId: string, model: string | null): Promise<DesignResult<AskAnswer>> =>
    followed(async (run, live) => {
      if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
      const open = await openPlan(messageId)
      if (!open) return { ok: false, reason: 'PLAN_GONE' }
      if ((open.flow.failedBuilds ?? 0) >= maxFailedBuilds) return { ok: false, reason: 'PLAN_BUILDS_USED' }
      const ready = await providerFor(model)
      if (!ready.ok) return ready
      const { row, flow } = open
      // Open again after a build that built nothing; one that asked the model counts against `maxFailedBuilds`.
      const tried = { ...reopened(flow), failedBuilds: (flow.failedBuilds ?? 0) + 1 }
      const building: PlanFlow = { ...flow, state: 'building', claimedAt: now().toISOString() }
      if (!(await withScope(sql, context, (tx) => moveFlow(tx, storeId, row.id, flow, building)))) return { ok: false, reason: 'PLAN_GONE' }
      // Nothing built yet: the plan goes back to open, to build again.
      // The claim is renewed before every ask of the model, so a long build never lets it lapse (`claimMs`) while it runs.
      let held = building
      const giveBack = (to: PlanFlow) => withScope(sql, context, (tx) => moveFlow(tx, storeId, row.id, held, to))
      live.step('reading')
      let designer: ReturnType<typeof designModel>
      try {
        const known = await currentSummary()
        designer = designModel(ready.value.provider, await briefOf({ page: 'home', device: 'desktop', imageAssetId: null }, null, null, known), null, () => undefined, undefined, known && storeLookups({ sql, context, summary: known, readAsset: deps.readAsset }))
      } catch (error) {
        await giveBack(reopened(flow)).catch(() => undefined)
        throw error
      }
      let modelFailure: unknown = null
      let modelAsked = false
      const pages: DesignModel = {
        propose: async (proposal) => {
          modelAsked = true
          const renewed = { ...held, claimedAt: now().toISOString() }
          if (!(await withScope(sql, context, (tx) => moveFlow(tx, storeId, row.id, held, renewed)))) throw new Error('studio: the plan’s claim was lost')
          held = renewed
          try {
            return await designer.propose(proposal)
          } catch (error) {
            modelFailure = error
            throw error
          }
        },
      }
      let answer: Awaited<ReturnType<NonNullable<typeof studio>['build']>> | { outcome: 'failed' }
      try {
        answer = await studio.build(storeId, { pages: pageRequests(flow), userId: actor.id, billedTo: ready.value.billedTo, parentRunId: row.ai_run_id, run }, pages)
      } catch (error) {
        logEvent({ event: 'storefront_design_failed', api: 'store', storeId, code: modelFailure instanceof GatewayError ? `${modelFailure.name}:${modelFailure.code}` : failureCode(modelFailure ?? error) })
        // An answer lost after a page was built still records the build as it stood, so its pages have their one Undo.
        const sofar = await studio.buildSoFar(storeId, run).catch(() => null)
        answer = sofar?.pages.some((p) => p.outcome === 'changed') ? sofar : { outcome: 'failed' }
      }
      if (answer.outcome !== 'built') {
        // Queued, unavailable or failed before the model was asked: nothing spent, so nothing counted.
        await giveBack(modelAsked ? tried : reopened(flow))
        if (answer.outcome === 'queued') return { ok: false, reason: 'STUDIO_QUEUED', place: answer.place }
        if (answer.outcome === 'unavailable') return { ok: false, reason: 'STUDIO_UNAVAILABLE' }
        return { ok: true, value: { outcome: 'failed', message: await failedMessage(modelFailure) } }
      }
      const built = answer
      const changed = built.pages.filter((p) => p.outcome === 'changed')
      const saved = savedBeside(changed.length > 0 ? 'changed' : 'unchanged')
      const outcome: AskAnswer['outcome'] = changed.length > 0 ? 'changed' : built.pages.some((p) => p.outcome === 'refused') ? 'refused' : built.pages.some((p) => p.outcome === 'failed') ? 'failed' : 'unchanged'
      const detail: BuildFlow = { kind: 'build', pages: built.pages.map((p) => ({ page: p.page, title: p.title, outcome: p.outcome })), stopped: built.stopped }
      const message = await recordAfter(sql, storeId, async (tx) => {
        // A claim another request took (this one stalled past `claimMs`) records no second build; a build that built no page
        // leaves the plan open, to build again inside the same unit.
        if (!(await moveFlow(tx, storeId, row.id, held, changed.length > 0 ? { ...held, state: 'built' } : tried))) return 'lost' as const
        const reply = built.pages.flatMap((p) => (p.reply ? [p.reply] : [])).join('\n').slice(0, 4000)
        const id =
          outcome === 'changed' || outcome === 'unchanged'
            ? await record(tx, { role: 'ai', text: reply, changed: changed.map((p) => p.title).slice(0, 5), page: changed[0]?.page ?? 'home', commit: built.commit, beforeCommit: changed.length > 0 ? built.before : null, aiRunId: row.ai_run_id, detail })
            : await record(tx, { role: 'error', text: outcome === 'refused' ? designErrors.refused : designErrors.failedFor(reasonOf(modelFailure)), aiRunId: row.ai_run_id, detail })
        await activity.record(tx, entry(designAudit.planBuilt, [{ field: 'outcome', before: null, after: outcome }, { field: 'pages', before: String(built.pages.length), after: String(changed.length) }], built.stopped ? 'stopped' : null))
        return selectMessage(tx, storeId, id)
      })
      await saved
      if (message === 'lost') return { ok: false, reason: 'PLAN_GONE' }
      if (!message) throw new Error('design_message: written and not found')
      return { ok: true, value: { outcome, message } }
    })

  /** `searchStockImages`: every source's results for words the merchant typed; page 1 to 20. */
  const stockSearch = async (query: string, page: number): Promise<DesignResult<{ photos: StockPhoto[]; total: number }>> => {
    if (!deps.stock) return { ok: false, reason: 'NOT_CONNECTED' }
    const words = query.trim()
    if (words.length === 0 || words.length > 100 || !Number.isInteger(page) || page < 1 || page > 20) return { ok: false, reason: 'INVALID_INPUT' }
    if (!(await stockAllowed())) return { ok: false, reason: 'STOCK_BUSY' }
    const found = await deps.stock.search(words, page)
    return found ? { ok: true, value: found } : { ok: false, reason: 'SAMPLE_UNAVAILABLE' }
  }

  /** `useStockImage`: the chosen result is downloaded into the store's own files (never hotlinked). */
  const stockUse = async (id: string): Promise<DesignResult<string>> => {
    if (!deps.stock) return { ok: false, reason: 'NOT_CONNECTED' }
    if (!/^[\w:-]{1,60}$/.test(id)) return { ok: false, reason: 'INVALID_INPUT' }
    if (!(await stockAllowed())) return { ok: false, reason: 'STOCK_BUSY' }
    const address = await deps.stock.download(id)
    if (!address || !isStockUrl(address)) return { ok: false, reason: 'SAMPLE_UNAVAILABLE' }
    return importImage(address, id.split(':')[0] ?? null)
  }

  /** `studioActivity` (AI-STUDIO §7 "Stopping"): wakes the context's store's container; anyone who may open the studio. */
  const wake = async (): Promise<DesignResult<true>> => {
    if (!studio || !studioAccess(context, deps.role)) return { ok: false, reason: 'NOT_CONNECTED' }
    await studio.activity(storeId)
    return { ok: true, value: true }
  }

  /** `cancelDesign`: stops the store's running change; the pending `askDesign` answers `cancelled`. */
  const cancel = async (): Promise<DesignResult<boolean>> => (studio ? { ok: true, value: await studio.cancel(storeId) } : { ok: false, reason: 'NOT_CONNECTED' })

  /** "Undo this change" on the latest change only (AI-STUDIO §5): a new change, with its own preview. */
  const undo = async (messageId: string): Promise<DesignResult<MessageRow>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    // The head is read once every save is written (AI-STUDIO §4 step 6); a change still only kept can't be undone yet.
    if (!(await studio.saved(storeId).catch(() => false))) return { ok: false, reason: 'STUDIO_UNAVAILABLE' }
    const latest = await withScope(sql, context, (tx) => selectLatestChange(tx, storeId))
    const head = (await withSystemScope(sql, (tx) => selectStudioStart(tx, storeId)))?.head_commit ?? null
    if (!latest || latest.id !== messageId || !latest.commit || latest.commit !== head) return { ok: false, reason: 'NOT_LATEST' }
    // A build's one entry takes every page back in one change (#1243).
    const build = flowOf(latest.detail)?.kind === 'build' ? latest.before_commit : null
    const answer = await studio.undo(storeId, { commit: latest.commit, userId: actor.id, before: build })
    const saved = savedBeside(answer.outcome)
    if (answer.outcome === 'queued') return { ok: false, reason: 'STUDIO_QUEUED', place: answer.place }
    if (answer.outcome === 'unavailable') return { ok: false, reason: 'STUDIO_UNAVAILABLE' }
    if (answer.outcome === 'refused') return { ok: false, reason: 'CHANGE_REFUSED', problems: answer.problems.length }
    const message = await recordAfter(sql, storeId, async (tx) => {
      await markUndone(tx, storeId, latest.id)
      await record(tx, { role: 'note', text: designNotes.undone })
      await activity.record(tx, entry(designAudit.changeUndone, [{ field: 'change', before: latest.commit, after: answer.outcome === 'changed' ? answer.commit : null }]))
      return selectMessage(tx, storeId, latest.id)
    })
    await saved
    return message ? { ok: true, value: message } : { ok: false, reason: 'NOT_FOUND' }
  }

  /** Discard (AI-STUDIO §5): the draft row and bundle go, the preview shows the live code again, the studio reloads it. */
  const discard = async (): Promise<DesignResult<true>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    // Read the draft after the saves; Discard drops what is still kept anyway, so a failed wait doesn't stop it.
    await studio.saved(storeId).catch(() => undefined)
    const had = await withSystemScope(sql, (tx) => selectStudioStart(tx, storeId))
    if (!had?.head_commit || !had.live_build_id) return { ok: false, reason: 'NOTHING_TO_DISCARD' }
    await studio.discard(storeId)
    await recordAfter(sql, storeId, async (tx) => {
      await record(tx, { role: 'note', text: designNotes.discarded })
      await activity.record(tx, entry(designAudit.discarded, []))
    })
    return { ok: true, value: true }
  }

  /** Edit text: the page's words in one offered language, by key (`file:dotted.path`). */
  const texts = async (page: string, language: string): Promise<DesignResult<TextEntry[]>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    if (page.length > maxKey) return { ok: false, reason: 'INVALID_INPUT' }
    const locale = await offeredLocale(language)
    if (!locale) return { ok: false, reason: 'INVALID_LANGUAGE' }
    const answer = await studio.texts(storeId, { page, locale })
    return answer ? { ok: true, value: answer } : { ok: false, reason: 'STUDIO_UNAVAILABLE' }
  }

  /** Saved through the same gate as any change, with no model call (SAAS §9.2 guardrail 1); the words are never logged. */
  const saveText = async (language: string, key: string, text: string): Promise<DesignResult<true>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    const locale = await offeredLocale(language)
    if (!locale) return { ok: false, reason: 'INVALID_LANGUAGE' }
    if (text.length > maxRequest || key.length > maxKey) return { ok: false, reason: 'INVALID_INPUT' }
    const answer = await studio.editText(storeId, { locale, key, text, userId: actor.id })
    if (answer.outcome === 'missing') return { ok: false, reason: 'NOT_FOUND' }
    if (answer.outcome === 'queued') return { ok: false, reason: 'STUDIO_QUEUED', place: answer.place }
    if (answer.outcome === 'unavailable') return { ok: false, reason: 'STUDIO_UNAVAILABLE' }
    if (answer.outcome === 'refused') return { ok: false, reason: 'CHANGE_REFUSED', problems: answer.problems.length }
    await Promise.all([recordAfter(sql, storeId, (tx) => activity.record(tx, entry(designAudit.textEdited, [{ field: 'text', before: null, after: `${locale} ${key}` }]))), savedBeside(answer.outcome)])
    return { ok: true, value: true }
  }

  /** The store's language (`hi-IN`) as its content folder (`hi`), when the store offers it (storefront ARCHITECTURE §3.4). */
  const offeredLocale = async (language: string): Promise<string | null> => {
    const guard = await withSystemScope(sql, (tx) => selectGuardContext(tx, storeId))
    const offered = guard ? [guard.main_language, ...guard.languages] : []
    return offered.includes(language) ? (language.split('-')[0] ?? null) : null
  }

  return { session, renew, wake, chat, ask, answerQuestions, changePlan, buildPlan, cancel, stockSearch, stockUse, importImage, undo, discard, texts, saveText }
}
