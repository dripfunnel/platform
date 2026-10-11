import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

// The container starts with its internet off (AI-STUDIO §1); this is the same wall inside the process, so nothing the
// gate loads can open a connection even where the container's network setting were wrong.
export class NetworkBlocked extends Error {
  override name = 'NetworkBlocked'
  constructor() {
    super('The sandbox has no network.')
  }
}

const refuse = (): never => {
  throw new NetworkBlocked()
}

export const lockdown = (): void => {
  globalThis.fetch = refuse
  Object.defineProperty(globalThis, 'WebSocket', { value: undefined, configurable: false, writable: false })
  Object.defineProperty(globalThis, 'EventSource', { value: undefined, configurable: false, writable: false })
  net.Socket.prototype.connect = refuse
  net.connect = refuse
  net.createConnection = refuse
  tls.connect = refuse
  http.request = refuse
  http.get = refuse
  https.request = refuse
  https.get = refuse
  Object.assign(dns, { lookup: refuse, resolve: refuse })
  dns.promises.lookup = refuse
  dns.promises.resolve = refuse
}
