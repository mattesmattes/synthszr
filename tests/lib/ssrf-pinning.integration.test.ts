/**
 * Integration check for the DNS-pinning connector (SEC-004).
 *
 * tests/lib/ssrf.test.ts mocks undici to observe the wiring. That proves we
 * build the right objects, not that undici accepts them. This file talks to a
 * real socket with the real library and pins three assumptions the production
 * path depends on:
 *
 *   1. the `connect.lookup` override has the signature undici actually calls,
 *   2. pinning does not rewrite the URL - Host header (and thus TLS SNI) keeps
 *      the original hostname,
 *   3. `agent.close()` is graceful: a response body that has not been read yet
 *      still streams to completion afterwards (destroy() would truncate it).
 *
 * It connects to 127.0.0.1 deliberately - this exercises the connector below
 * the SSRF policy, which is what makes the loopback target safe here.
 */
import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetch as undiciFetch } from 'undici'
import { createPinnedAgent } from '@/lib/security/ssrf'

const BODY_SIZE = 200_000 // large enough to span multiple TCP chunks

let server: http.Server | undefined

afterEach(async () => {
  if (server) {
    await new Promise<void>(resolve => server!.close(() => resolve()))
    server = undefined
  }
})

async function startEchoServer(): Promise<{ port: number; hostHeaders: string[] }> {
  const hostHeaders: string[] = []
  server = http.createServer((req, res) => {
    hostHeaders.push(req.headers.host ?? '')
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('x'.repeat(BODY_SIZE))
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  return { port: (server!.address() as AddressInfo).port, hostHeaders }
}

describe('SSRF pinning connector (real undici)', () => {
  it('connects to the pinned address for a hostname that does not resolve', async () => {
    const { port } = await startEchoServer()
    const agent = createPinnedAgent({ address: '127.0.0.1', family: 4 })

    const response = await undiciFetch(`http://pinned.invalid:${port}/`, { dispatcher: agent })
    const body = await response.text()
    await agent.close()

    expect(response.status).toBe(200)
    expect(body).toHaveLength(BODY_SIZE)
  })

  it('keeps the original hostname in the Host header', async () => {
    const { port, hostHeaders } = await startEchoServer()
    const agent = createPinnedAgent({ address: '127.0.0.1', family: 4 })

    await (await undiciFetch(`http://pinned.invalid:${port}/`, { dispatcher: agent })).text()
    await agent.close()

    expect(hostHeaders[0]).toBe(`pinned.invalid:${port}`)
  })

  it('still delivers the full body when close() runs before the body is read', async () => {
    const { port } = await startEchoServer()
    const agent = createPinnedAgent({ address: '127.0.0.1', family: 4 })

    const response = await undiciFetch(`http://pinned.invalid:${port}/`, { dispatcher: agent })
    // Exactly what safeFetch does on the final hop: fire-and-forget close
    // while the caller still holds an unread streaming body.
    void agent.close()
    const body = await response.text()

    expect(body).toHaveLength(BODY_SIZE)
  })
})
