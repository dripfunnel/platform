import type { ActivityEntry } from '#auth/activity'
import type { StoreRole } from '#auth/storePermissions'
import { isUuid } from '#core/ids'
import { logEvent, failureCode } from '#core/log'
import { toMajor } from '#core/money'
import type { TenantContext } from '#core/tenancy'
import { insertDesignMessage, markUndone, selectBriefStore, selectDesignChat, selectLatestChange, selectMessage, selectProductSample, selectRecentRequests, type MessageRow } from '#db/scoped/design'
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
import { isPixabayUrl, type StockImages, type StockPhoto } from '#integrations/stockImages/pixabay'
import { allowanceFor } from '#saas/entitlements/index'
import { guardContextFor } from '#saas/storefronts/index'
import { openStudioSession, renewStudio, studioAccess, type DesignModel, type StudioState } from '#saas/studio/index'
import { chatReply, designModel, type DesignTools, type DesignBrief, type Device } from './model'
import { recordAfter, type DesignerDeps, type DesignResult } from './service'
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
  /** Stock image search (Pixabay); null where no key is set, which hides the picker. */
  stock: StockImages | null
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

export type AskAnswer = { outcome: 'changed' | 'unchanged' | 'refused' | 'failed' | 'cancelled'; message: MessageRow }
export type StudioSessionView = StudioState & { session: string; models: readonly string[]; frameUrl: string; access: 'change' | 'view'; expiresAt: Date }
export type TextEntry = { key: string; text: string }

const maxRequest = 2000
/** design_message.sample_url's limit (migration 0333). */
const maxUrl = 2048
/** A page or a text key: names, never words. */
const maxKey = 200
const recentRequests = 4
const sampleSize = 12
const imageTypes = new Set<AiImage['mediaType']>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
/** ai_mode's choices (planKeys.ts): the merchant's own key, or AI on the plan, counted against `ai_prompts`. */
const ownKeyMode = 0

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

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
    const state = await studio.status(storeId)
    return { ok: true, value: { ...state, session: opened.id, models: await deps.models(await billing(), context), frameUrl: `https://${key.slug}-preview.${deps.previewDomain}/__studio/${opened.id}/`, access: opened.access, expiresAt: opened.expiresAt } }
  }

  /** `renewStudioSession`: the seat re-checked; a refused renewal ends the session (AI-STUDIO §3 step 6, §8). */
  const renew = async (id: string): Promise<DesignResult<Date>> => {
    const until = await renewStudio(sql, context, deps.role, id, now())
    return until ? { ok: true, value: until } : { ok: false, reason: 'SESSION_ENDED' }
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

  /** `importDesignImage`: a public https address fetched by the platform and stored as the store's own image (AI-STUDIO §8). */
  const importImage = async (raw: string, fromStock = false): Promise<DesignResult<string>> => {
    if (!deps.lookup || !deps.assets) return { ok: false, reason: 'NOT_CONNECTED' }
    if (raw.length > maxUrl) return { ok: false, reason: 'INVALID_URL' }
    const got = await fetchPublic(raw, { lookup: deps.lookup, maxBytes: maxImageBytes, timeoutMs: 8_000, tries: 2 })
    if (!got.ok) return { ok: false, reason: got.code === 'BAD_URL' || got.code === 'PRIVATE_ADDRESS' ? 'INVALID_URL' : got.code === 'TOO_LARGE' ? 'INVALID_IMAGE' : 'SAMPLE_UNAVAILABLE' }
    const stored = await createAssetService({ sql, context, actor, activity, facts, store: deps.assets }).upload(got.bytes)
    if (!stored.ok || stored.asset.kind !== 'image') return { ok: false, reason: 'INVALID_IMAGE' }
    await recordAfter(sql, storeId, (tx) => activity.record(tx, entry(designAudit.imageImported, fromStock ? [{ field: 'source', before: null, after: 'pixabay' }] : [])))
    return { ok: true, value: stored.asset.id }
  }

  const briefOf = (input: AskInput, image: AiImage | null, screenshot: AiImage | null): Promise<DesignBrief> =>
    withScope(sql, context, async (tx) => {
      const store = await selectBriefStore(tx, storeId)
      const guard = await withSystemScope(sql, (sys) => selectGuardContext(sys, storeId))
      const products = await selectProductSample(tx, storeId, sampleSize)
      return {
        page: input.page,
        device: input.device,
        recent: (await selectRecentRequests(tx, storeId, recentRequests)).reverse(),
        store: { name: store?.name ?? '', city: store?.city ?? null, languages: guard ? guardContextFor(guard, []).locales : [] },
        brand: { tagline: store?.tagline ?? null, description: store?.description ?? null, voice: store?.voice ?? null, colours: [store?.primary_colour, store?.secondary_colour].filter((c): c is string => !!c) },
        products: products.map((p) => ({ name: p.name, price: p.amount && p.currency ? `${p.currency} ${toMajor({ amount: BigInt(p.amount), currency: p.currency })}` : null })),
        image,
        imageAssetId: image ? input.imageAssetId : null,
        screenshot,
      }
    })

  const record = (tx: ScopedSql, m: Omit<Parameters<typeof insertDesignMessage>[1], 'storeId' | 'createdBy' | 'at'> & { at?: Date }) =>
    insertDesignMessage(tx, { storeId, createdBy: actor.id, at: now(), ...m })

  /** Chat mode: a reply with no change and no sandbox; it takes a prompt like a change (SAAS §9.2) and is metered as a `design` run. */
  const chat_ = async (input: AskInput, text: string, provider: AiProvider, billedTo: 'plan' | 'own_key', image: AiImage | null, shot: AiImage | null, asked: Date): Promise<DesignResult<AskAnswer>> => {
    if (billedTo === 'plan' && !(await reserve())) return { ok: false, reason: 'AI_BUDGET_REACHED' }
    let reply: Awaited<ReturnType<typeof chatReply>> | null = null
    let failure: unknown = null
    try {
      reply = await chatReply(provider, await briefOf(input, image, shot), text)
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
  const ask = async (input: AskInput): Promise<DesignResult<AskAnswer>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    const text = input.text.trim()
    if (text.length === 0 || text.length > maxRequest || input.page.length > maxKey) return { ok: false, reason: 'INVALID_INPUT' }
    if (input.sampleUrl !== null && input.sampleUrl.length > maxUrl) return { ok: false, reason: 'INVALID_URL' }
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
    if (input.mode === 'chat') return chat_(input, text, provider, billedTo, image?.value ?? null, shot?.value ?? null, asked)
    const before = (await withSystemScope(sql, (tx) => selectStudioStart(tx, storeId)))?.head_commit ?? null
    // The photos the model added this request, each in Assets and credited in the chat once the change is recorded.
    const added: { assetId: string; user: string }[] = []
    const tools: DesignTools | null =
      deps.stock && deps.assets && deps.lookup
        ? {
            search: async (words) => (await deps.stock?.search(words, 1))?.photos.map((p) => ({ id: p.id, tags: p.tags, user: p.user })) ?? null,
            add: async (id) => {
              const found = await deps.stock?.download(id)
              if (!found || !isPixabayUrl(found)) return null
              const stored = await importImage(found, true)
              if (!stored.ok) return null
              const record = { assetId: stored.value, user: seen.get(id) ?? '' }
              added.push(record)
              return record
            },
          }
        : null
    const seen = new Map<string, string>()
    const designer = designModel(
      provider,
      await briefOf(input, image?.value ?? null, shot?.value ?? null),
      tools && { ...tools, search: async (words) => (await tools.search(words))?.map((p) => (seen.set(p.id, p.user), p)) ?? null },
      () => undefined,
    )
    let modelAsked = false
    let modelFailure: unknown = null
    const model: DesignModel = {
      propose: async (proposal) => {
        modelAsked = true
        try {
          return await designer.propose(proposal)
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
      answer = await studio.change(storeId, { request: text, userId: actor.id, billedTo }, model)
    } catch (error) {
      logEvent({ event: 'storefront_design_failed', api: 'store', storeId, code: modelFailure instanceof GatewayError ? `${modelFailure.name}:${modelFailure.code}` : failureCode(modelFailure ?? error) })
      answer = { outcome: 'failed' }
    }
    if (answer.outcome === 'queued' || answer.outcome === 'unavailable' || (answer.outcome === 'failed' && !modelAsked)) await giveBack()
    if (answer.outcome === 'queued') return { ok: false, reason: 'STUDIO_QUEUED', place: answer.place }
    if (answer.outcome === 'unavailable') return { ok: false, reason: 'STUDIO_UNAVAILABLE' }
    if (answer.outcome === 'cancelled') {
      // The unit goes back only when the model was never asked (it bills tokens once asked).
      if (!modelAsked) await giveBack()
      const stopped = await recordAfter(sql, storeId, async (tx) => {
        await record(tx, { role: 'user', text, imageAssetId: input.imageAssetId, sampleUrl: input.sampleUrl, page: input.page, at: asked })
        const id = await record(tx, { role: 'note', text: designNotes.stopped })
        await activity.record(tx, entry(designAudit.designRequested, [{ field: 'outcome', before: null, after: 'cancelled' }]))
        return selectMessage(tx, storeId, id)
      })
      if (!stopped) throw new Error('design_message: written and not found')
      return { ok: true, value: { outcome: 'cancelled', message: stopped } }
    }
    if (answer.outcome === 'changed') {
      const used = [...(input.imageAssetId ? [input.imageAssetId] : []), ...added.map((a) => a.assetId)]
      await withScope(sql, context, async (tx) => {
        for (const id of used) await makeVisible(tx, storeId, id)
      })
    }
    const summary = 'summary' in answer ? answer.summary : null
    const outcome: AskAnswer['outcome'] = answer.outcome === 'changed' || answer.outcome === 'unchanged' ? (summary ? answer.outcome : 'failed') : answer.outcome
    const message = await recordAfter(sql, storeId, async (tx) => {
      await record(tx, { role: 'user', text, imageAssetId: input.imageAssetId, sampleUrl: input.sampleUrl, page: input.page, at: asked })
      for (const photo of added) await record(tx, { role: 'note', text: designNotes.photoAdded(photo.user), imageAssetId: photo.assetId })
      const runId = 'runId' in answer ? answer.runId : null
      const id =
        (outcome === 'changed' || outcome === 'unchanged') && summary
          ? await record(tx, { role: 'ai', text: summary.reply, changed: outcome === 'changed' ? summary.changed : [], page: summary.page, commit: answer.outcome === 'changed' ? answer.commit : null, beforeCommit: outcome === 'changed' ? before : null, aiRunId: runId })
          : await record(tx, { role: 'error', text: outcome === 'refused' ? designErrors.refused : designErrors.failedFor(reasonOf(modelFailure)), aiRunId: runId })
      await activity.record(tx, entry(designAudit.designRequested, [{ field: 'outcome', before: null, after: outcome }]))
      return selectMessage(tx, storeId, id)
    })
    if (!message) throw new Error('design_message: written and not found')
    return { ok: true, value: { outcome, message } }
  }

  /** `searchStockImages`: Pixabay's results for words the merchant typed; page 1 to 20. */
  const stockSearch = async (query: string, page: number): Promise<DesignResult<{ photos: StockPhoto[]; total: number }>> => {
    if (!deps.stock) return { ok: false, reason: 'NOT_CONNECTED' }
    const words = query.trim()
    if (words.length === 0 || words.length > 100 || !Number.isInteger(page) || page < 1 || page > 20) return { ok: false, reason: 'INVALID_INPUT' }
    const found = await deps.stock.search(words, page)
    return found ? { ok: true, value: found } : { ok: false, reason: 'SAMPLE_UNAVAILABLE' }
  }

  /** `useStockImage`: the chosen result is downloaded into the store's own files (Pixabay's terms: never hotlinked). */
  const stockUse = async (id: string): Promise<DesignResult<string>> => {
    if (!deps.stock) return { ok: false, reason: 'NOT_CONNECTED' }
    if (!/^\d{1,12}$/.test(id)) return { ok: false, reason: 'INVALID_INPUT' }
    const address = await deps.stock.download(id)
    if (!address || !isPixabayUrl(address)) return { ok: false, reason: 'SAMPLE_UNAVAILABLE' }
    return importImage(address, true)
  }

  /** `cancelDesign`: stops the store's running change; the pending `askDesign` answers `cancelled`. */
  const cancel = async (): Promise<DesignResult<boolean>> => (studio ? { ok: true, value: await studio.cancel(storeId) } : { ok: false, reason: 'NOT_CONNECTED' })

  /** "Undo this change" on the latest change only (AI-STUDIO §5): a new change, with its own preview. */
  const undo = async (messageId: string): Promise<DesignResult<MessageRow>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    const latest = await withScope(sql, context, (tx) => selectLatestChange(tx, storeId))
    const head = (await withSystemScope(sql, (tx) => selectStudioStart(tx, storeId)))?.head_commit ?? null
    if (!latest || latest.id !== messageId || !latest.commit || latest.commit !== head) return { ok: false, reason: 'NOT_LATEST' }
    const answer = await studio.undo(storeId, { commit: latest.commit, userId: actor.id })
    if (answer.outcome === 'queued') return { ok: false, reason: 'STUDIO_QUEUED', place: answer.place }
    if (answer.outcome === 'unavailable') return { ok: false, reason: 'STUDIO_UNAVAILABLE' }
    if (answer.outcome === 'refused') return { ok: false, reason: 'CHANGE_REFUSED', problems: answer.problems.length }
    const message = await recordAfter(sql, storeId, async (tx) => {
      await markUndone(tx, storeId, latest.id)
      await record(tx, { role: 'note', text: designNotes.undone })
      await activity.record(tx, entry(designAudit.changeUndone, [{ field: 'change', before: latest.commit, after: answer.outcome === 'changed' ? answer.commit : null }]))
      return selectMessage(tx, storeId, latest.id)
    })
    return message ? { ok: true, value: message } : { ok: false, reason: 'NOT_FOUND' }
  }

  /** Discard (AI-STUDIO §5): the draft row and bundle go, the preview shows the live code again, the studio reloads it. */
  const discard = async (): Promise<DesignResult<true>> => {
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
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
    await recordAfter(sql, storeId, (tx) => activity.record(tx, entry(designAudit.textEdited, [{ field: 'text', before: null, after: `${locale} ${key}` }])))
    return { ok: true, value: true }
  }

  /** The store's language (`hi-IN`) as its content folder (`hi`), when the store offers it (storefront ARCHITECTURE §3.4). */
  const offeredLocale = async (language: string): Promise<string | null> => {
    const guard = await withSystemScope(sql, (tx) => selectGuardContext(tx, storeId))
    const offered = guard ? [guard.main_language, ...guard.languages] : []
    return offered.includes(language) ? (language.split('-')[0] ?? null) : null
  }

  return { session, renew, chat, ask, cancel, stockSearch, stockUse, importImage, undo, discard, texts, saveText }
}
