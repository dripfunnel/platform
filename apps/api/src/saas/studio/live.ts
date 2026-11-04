import { studioStoreHeader } from './frame'

// The studio's live progress (storefront AI-STUDIO §4 "Live progress", #1237): one-way events from the store's
// StudioSession to every open studio of the store, over hibernating WebSockets, numbered so a reconnect replays what it missed.

export const liveSteps = ['reading', 'asking', 'checking', 'repairing', 'saving', 'updating'] as const
export type LiveStep = (typeof liveSteps)[number]

/** Never file contents, prompts or secrets: steps, the AI's own words, and the outcome askDesign answers. */
export type LiveEvent =
  | { type: 'step'; step: LiveStep; attempt?: number; of?: number }
  | { type: 'text'; text: string }
  | { type: 'done'; outcome: string; messageId: string | null }
  | { type: 'error'; code: string }

export type LiveMessage = LiveEvent & { seq: number; run: string }

/** A change's events are kept this long after it ends (the card's reconnect window). */
export const liveKeepMs = 60_000
/** A run that never ended (its request went away mid-change) is dropped after this. */
export const liveRunMs = 20 * 60_000
/** The stored feed's bound, so a run that streams without end can't grow the object's storage. */
export const liveMaxEvents = 400
/** A chat answer is kept to 2,000 characters (design_message); its streamed words stop there too. */
export const liveMaxText = 2000

export interface LiveStorage {
  get: <T>(key: string) => Promise<T | undefined>
  put: <T>(key: string, value: T) => Promise<void>
}

export interface LiveSocket {
  send: (message: string) => void
}

type Feed = { seq: number; runs: { run: string; startedAt: number; endedAt: number | null }[]; events: LiveMessage[] }

const feedKey = 'live:feed'

const send = (socket: LiveSocket, message: string) => {
  try {
    socket.send(message)
  } catch {
    // A socket closing as the event goes out reconnects and gets it by replay.
  }
}

/**
 * The store's feed: `publish` numbers an event, keeps it and sends it to every open socket; `connect` accepts a socket and
 * replays what came after `after`. Both run in one queue, so a socket never gets an event twice or out of order.
 */
export const liveHub = (storage: LiveStorage, sockets: () => Iterable<LiveSocket>, now: () => number) => {
  let feed: Feed | null = null
  let tail: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work)
    tail = run.catch(() => undefined)
    return run
  }
  const load = async (): Promise<Feed> => {
    feed ??= (await storage.get<Feed>(feedKey)) ?? { seq: 0, runs: [], events: [] }
    const at = now()
    feed.runs = feed.runs.filter((r) => (r.endedAt === null ? at - r.startedAt < liveRunMs : at - r.endedAt < liveKeepMs))
    const kept = new Set(feed.runs.map((r) => r.run))
    feed.events = feed.events.filter((e) => kept.has(e.run)).slice(-liveMaxEvents)
    return feed
  }
  return {
    /** Null for an event after its run ended: a late one never reopens a finished feed. */
    publish: (run: string, event: LiveEvent): Promise<LiveMessage | null> =>
      inTurn(async () => {
        const f = await load()
        const at = now()
        let known = f.runs.find((r) => r.run === run)
        if (known?.endedAt != null) return null
        if (!known) {
          known = { run, startedAt: at, endedAt: null }
          f.runs.push(known)
        }
        f.seq += 1
        const message: LiveMessage = { ...event, seq: f.seq, run }
        f.events.push(message)
        if (event.type === 'done' || event.type === 'error') known.endedAt = at
        await storage.put(feedKey, f)
        const text = JSON.stringify(message)
        for (const socket of sockets()) send(socket, text)
        return message
      }),
    connect: (accept: () => LiveSocket, after: number): Promise<void> =>
      inTurn(async () => {
        const f = await load()
        const socket = accept()
        for (const e of f.events) if (e.seq > after) send(socket, JSON.stringify(e))
      }),
  }
}

/**
 * The Worker's events of one run (the first step, a chat's words, the outcome) to the store's StudioSession, in order:
 * text waiting behind a call in flight joins into one event, and a lost event never fails the request.
 */
export const liveSender = (deliver: (event: LiveEvent) => Promise<void>, lost: (error: unknown) => void) => {
  const queue: LiveEvent[] = []
  let draining: Promise<void> | null = null
  let streamed = 0
  let started = false
  const drain = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await deliver(next).catch(lost)
    draining = null
  }
  const push = (event: LiveEvent) => {
    started = true
    const last = queue.at(-1)
    if (event.type === 'text' && last?.type === 'text') last.text += event.text
    else queue.push(event)
    draining ??= drain()
  }
  return {
    step: (step: LiveStep) => push({ type: 'step', step }),
    text: (words: string) => {
      const room = liveMaxText - streamed
      if (room <= 0 || words === '') return
      const kept = words.slice(0, room)
      streamed += kept.length
      push({ type: 'text', text: kept })
    },
    /** The run's last event, then every event before it delivered; nothing for a run that never showed a step. */
    end: async (event: Extract<LiveEvent, { type: 'done' | 'error' }>): Promise<void> => {
      if (!started) return
      push(event)
      await draining
    },
  }
}

const livePath = '/__live'
const liveSessionHeader = 'x-df-studio-live'

/** The upgrade the Store API hands the context's store's StudioSession; the frame's route never forwards this path. */
export const liveUpgrade = (storeId: string, input: { sessionHash: string; after: number }): Request =>
  new Request(`https://studio.internal${livePath}?after=${input.after}`, { headers: { upgrade: 'websocket', [studioStoreHeader]: storeId, [liveSessionHeader]: input.sessionHash } })

/** The store, the studio session's hash the socket is tagged with, and the last event seen; null for any other request. */
export const liveUpgradeOf = (request: Request): { storeId: string; sessionHash: string; after: number } | null => {
  const url = new URL(request.url)
  if (url.pathname !== livePath || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return null
  const storeId = request.headers.get(studioStoreHeader)
  const sessionHash = request.headers.get(liveSessionHeader)
  const after = Number(url.searchParams.get('after') ?? '0')
  if (!storeId || !sessionHash || !Number.isSafeInteger(after) || after < 0) return null
  return { storeId, sessionHash, after }
}

/** The tag every live socket carries beside its session's hash, so the frame's hot reload never reaches one. */
export const liveTag = 'live'

/** The session's hash first, as a frame's socket has it, so the alarm's sweep (frame.ts) closes both kinds alike. */
export const liveTags = (sessionHash: string): string[] => [sessionHash, liveTag]
export const isLiveSocket = (tags: readonly string[]): boolean => tags.includes(liveTag)
