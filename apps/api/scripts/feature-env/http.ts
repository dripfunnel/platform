const timeoutMs = 30_000

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const request = async (url: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> => {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) throw new HttpError(response.status, `${init.method ?? 'GET'} ${new URL(url).pathname} → ${response.status} ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : undefined
}

export const ignoreNotFound = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await work()
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return undefined
    throw error
  }
}
