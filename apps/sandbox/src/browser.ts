import { existsSync } from 'node:fs'

const browserPaths = [process.env['CHROME_PATH'], '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']

/** The image's Chromium (Dockerfile), or a local Chrome in development; null where there is none. */
export const chromiumPath = (): string | null => browserPaths.find((p): p is string => p !== undefined && p !== '' && existsSync(p)) ?? null
