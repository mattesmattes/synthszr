import { google } from 'googleapis'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
]

// CSRF-Schutz: state-Cookie-Name für den Gmail-OAuth-Flow (authorize → callback)
export const GMAIL_OAUTH_STATE_COOKIE = 'gmail_oauth_state'

const REDACTED = '<<redacted>>'
// refresh_token, access_token, id_token, client_secret, assertion, code, …
const SENSITIVE_KEY = /token|secret|assertion|^code$|password|^authorization$|^cookie$/i
const SENSITIVE_STRING = /(token|secret|assertion|code)=|"[a-z_]*(token|secret)"\s*:/i

type Params = { forEach(cb: (value: unknown, key: string) => void): void }

function redactParams<T extends Params>(params: T, make: () => T & { set(k: string, v: string): void }): T {
  const copy = make()
  params.forEach((value, key) => copy.set(key, SENSITIVE_KEY.test(key) ? REDACTED : String(value)))
  return copy
}

function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return SENSITIVE_STRING.test(value) ? REDACTED : value
  if (!value || typeof value !== 'object' || depth > 4) return value
  if (value instanceof URLSearchParams) return redactParams(value, () => new URLSearchParams())
  if (value instanceof Headers) return redactParams(value, () => new Headers())
  if (value instanceof URL) {
    const url = new URL(value.toString())
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, REDACTED)
    }
    return url
  }
  if (Array.isArray(value)) return value.map(v => redactValue(v, depth + 1))
  if (Object.getPrototypeOf(value) !== Object.prototype) return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(v, depth + 1)
  }
  return out
}

type RedactableErrorData = {
  config?: { url?: unknown; headers?: unknown; data?: unknown; body?: unknown }
  response?: { data?: unknown; headers?: unknown; config?: unknown }
}

/**
 * errorRedactor fuer gaxios: Der Standard-Redactor schwaerzt nur grant_type,
 * assertion und Schluessel mit "secret" — NICHT refresh_token. Am 2026-11-07
 * stand der Gmail-Refresh-Token deshalb bei jedem invalid_grant im Klartext
 * in den Vercel-Logs (console.error des Fehlerobjekts). Ersetzt die
 * betroffenen Felder durch geschwaerzte Kopien, statt sie zu veraendern:
 * gaxios kopiert URLSearchParams/Headers nur per Referenz.
 */
export function redactGoogleAuthError<T extends RedactableErrorData>(data: T): T {
  // response ist ein echtes Response-Objekt (url/headers/body nur Getter) —
  // dort zaehlen nur die von gaxios gesetzten Felder data und config.
  const targets: [Record<string, unknown> | undefined, string[]][] = [
    [data.config as Record<string, unknown> | undefined, ['url', 'headers', 'data', 'body']],
    [data.response as Record<string, unknown> | undefined, ['data', 'config']],
  ]
  for (const [part, fields] of targets) {
    if (!part) continue
    for (const field of fields) {
      if (part[field] !== undefined) part[field] = redactValue(part[field])
    }
  }
  return data
}

export function getOAuth2Client() {
  return new google.auth.OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/gmail/callback`,
    transporterOptions: { errorRedactor: redactGoogleAuthError as never },
  })
}

export function getAuthUrl(state: string): string {
  const oauth2Client = getOAuth2Client()

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
    state,
  })
}

export async function getTokensFromCode(code: string) {
  const oauth2Client = getOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  return tokens
}

export function getAuthenticatedClient(refreshToken: string) {
  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  })
  return oauth2Client
}
