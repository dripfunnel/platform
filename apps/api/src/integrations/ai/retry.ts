import { GatewayError, transientCodes } from './gateway'

export interface RetryOptions {
  /** Tries in all, the first included. */
  attempts: number
  baseMs: number
  maxMs: number
  signal?: AbortSignal
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new GatewayError('CANCELLED'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(new GatewayError('CANCELLED'))), { once: true })
  })

/** Exponential backoff with full jitter (AGENTS.md "Reliability"); only transient failures are tried again. */
export const withRetry = async <T>(work: () => Promise<T>, { attempts, baseMs, maxMs, signal, sleep = wait, random = Math.random }: RetryOptions): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work()
    } catch (error) {
      if (!(error instanceof GatewayError) || !transientCodes.has(error.code) || attempt >= attempts) throw error
      const backoff = random() * Math.min(maxMs, baseMs * 2 ** (attempt - 1))
      await sleep(Math.min(maxMs, error.retryAfter !== null ? Math.max(backoff, error.retryAfter * 1000) : backoff), signal)
    }
  }
}
