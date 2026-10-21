/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chromium, type Browser } from 'playwright-core'
import ts from 'typescript'

// Real-browser tests for what jsdom can't show: layout, the top layer, CSP and Trusted Types (#481).

const src = decodeURIComponent(new URL('../src/', import.meta.url).pathname)

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p): p is string => p !== undefined && existsSync(p))

export const launchChrome = (): Promise<Browser> => {
  if (chrome === undefined) throw new Error('The browser tests need Chrome or Chromium; set CHROME_PATH to its executable.')
  return chromium.launch({ executablePath: chrome, headless: true })
}

/** Core's DOM-only source as browser modules: /core/sealed/element is src/sealed/element.ts, compiled on request. */
const coreModule = (path: string): string | null => {
  const file = `${src}${path}.ts`
  if (!/^[A-Za-z/]+$/.test(path) || !existsSync(file)) return null
  return ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
}

export type Answer = { body: string | Uint8Array; type?: string; headers?: Record<string, string> }

export type Site = { origin: string; close: () => Promise<void> }

/** A server on 127.0.0.1 answering each path from `answer`, and core's modules under /core/. */
export const serve = async (answer: (path: string) => Answer | undefined): Promise<Site> => {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const core = path.startsWith('/core/') ? coreModule(path.slice('/core/'.length)) : null
    const found = core === null ? answer(path) : { body: core, type: 'text/javascript' }
    if (!found) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': found.type ?? 'text/html; charset=utf-8', 'access-control-allow-origin': '*', ...found.headers }).end(found.body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) }
}
