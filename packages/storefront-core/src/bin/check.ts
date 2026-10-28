#!/usr/bin/env node
/// <reference types="node" />
import { runCheck } from '../guard/check.js'

try {
  const { code, lines } = runCheck(process.cwd())
  for (const line of lines) console.log(line)
  process.exitCode = code
} catch (error) {
  console.error(`pnpm check couldn't finish: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
