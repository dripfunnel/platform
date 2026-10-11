import dns from 'node:dns/promises'
import http from 'node:http'
import net from 'node:net'
import { lockdown } from '../lockdown'

// Run in its own process by lockdown.test.ts: every way out of the sandbox, tried after the lockdown.
const target = process.argv[2] ?? ''
lockdown()
const attempt = async (name: string, work: () => Promise<unknown> | unknown) => {
  try {
    await work()
    return [name, 'reached']
  } catch (error) {
    return [name, error instanceof Error ? error.name : 'failed']
  }
}
const results = await Promise.all([
  attempt('fetch', () => fetch(target)),
  attempt('http', () => new Promise((resolve, reject) => http.get(target, resolve).on('error', reject))),
  attempt('socket', () => new Promise((resolve, reject) => net.connect(Number(new URL(target).port), '127.0.0.1', () => resolve(null)).on('error', reject))),
  attempt('dns', () => dns.lookup('example.com')),
  attempt('websocket', () => new WebSocket(target.replace('http', 'ws'))),
])
console.log(JSON.stringify(Object.fromEntries(results)))
