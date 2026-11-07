/**
 * PROD-BEFUND 2026-11-07: Bei `invalid_grant` loggten Newsletter-Abruf,
 * Webcrawl und +dailyrepo-Import das gaxios-Fehlerobjekt per console.error —
 * samt `config.data` mit dem Gmail-Refresh-Token im Klartext. Der
 * Standard-Redactor von gaxios schwaerzt nur grant_type, assertion und
 * Schluessel mit "secret", nicht refresh_token.
 *
 * Regel: Kein Fehlerobjekt des Gmail-OAuth-Clients enthaelt einen Token.
 */
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest' // vi: stubEnv
import { getAuthenticatedClient, redactGoogleAuthError } from '@/lib/gmail/oauth'

const REFRESH = '1//03TEST-refresh-token-do-not-log-abcdefghijklmnop'
const ACCESS = 'ya29.TEST-access-token-do-not-log'

// gaxios nimmt fetchImplementation aus seinen Defaults, sonst node-fetch —
// ein globales fetch-Stub greift nicht. So geht kein Request ins Netz.
// Bewusst kein vi.fn: dessen mock.calls speichern den Request-Body und
// wuerden ueber config.fetchImplementation mitgedruckt.
const invalidGrant = async () => new Response(
  JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }),
  { status: 400, headers: { 'content-type': 'application/json' } },
)

describe('Gmail-OAuth-Fehler', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'GOCSPX-test-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('enthaelt bei invalid_grant den Refresh-Token nicht mehr', async () => {
    const client = getAuthenticatedClient(REFRESH)
    client.transporter.defaults.fetchImplementation = invalidGrant as never

    const err = await client.getAccessToken().then(() => null, e => e)

    expect(err).toBeTruthy()
    // console.error formatiert per util.inspect — genau das landet in den Vercel-Logs.
    const logged = inspect(err, { depth: 10 })
    expect(logged).toContain('invalid_grant')
    expect(logged).not.toContain(REFRESH)
    expect(logged).not.toContain('GOCSPX-test-secret')
  })
})

describe('redactGoogleAuthError', () => {
  it('schwaerzt Tokens in URLSearchParams, Objekten, Strings und Headern', () => {
    const data = {
      config: {
        url: new URL('https://oauth2.googleapis.com/token?access_token=' + ACCESS),
        headers: new Headers({ Authorization: `Bearer ${ACCESS}` }),
        data: new URLSearchParams({ refresh_token: REFRESH, client_id: 'cid', grant_type: 'refresh_token' }),
        body: `refresh_token=${REFRESH}&grant_type=refresh_token`,
      },
      response: {
        data: { access_token: ACCESS, refresh_token: REFRESH, id_token: 'idtok', error: 'x' },
      },
    }

    const out = inspect(redactGoogleAuthError(data as never), { depth: 10 })

    expect(out).not.toContain(REFRESH)
    expect(out).not.toContain(ACCESS)
    expect(out).not.toContain('idtok')
    expect(out).toContain('cid') // nicht geheim, hilft beim Debuggen
  })
})
