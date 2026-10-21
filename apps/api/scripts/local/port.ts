import { connect } from 'node:net'
import { error, type Finding } from './finding'

const isListening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host: 'localhost', port, timeout: 1000 })
    const settle = (listening: boolean) => {
      socket.destroy()
      resolve(listening)
    }
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
    socket.once('timeout', () => settle(false))
  })

// Wrangler moves to another port when 8787 is taken, but the consoles' Vite proxies stay on
// 8787, so they would quietly keep talking to the old Worker.
export const checkWorkerPort = async (port = 8787): Promise<Finding[]> =>
  (await isListening(port))
    ? [error(`Port ${port} is already in use, probably by another pnpm dev.`, `Stop that one first; lsof -nP -iTCP:${port} -sTCP:LISTEN shows what holds it.`)]
    : []
