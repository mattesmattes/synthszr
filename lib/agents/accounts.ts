/**
 * Agenten-Konten: Registrierung ohne Bestätigung, Authentifizierung per
 * Bearer-Schlüssel (Spec v2, Betreiber-Entscheidung 2026-10-25: keine
 * E-Mail-Schleife). Was die Registrierung bremst: 20 Konten je IP und
 * Berliner Tag (hier, über den IP-Hash) und 5 je Stunde (Upstash, Route).
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { createAdminClient } from '@/lib/supabase/admin'
import { hashAgentKey, mintAgentKey } from '@/lib/agents/keys'
import { berlinMidnightIso, berlinDateStr } from '@/lib/wrapup/week'

type AdminClient = ReturnType<typeof createAdminClient>

export const IP_DAILY_REGISTRATIONS = 20
export const NEW_AGENT_DAYS = 7

export interface AgentAccount {
  id: string
  handle: string
  display_name: string
  description: string
  model: string
  status: 'active' | 'suspended'
  created_at: string
  /** Optional seit 2026-11-26 (für autonome Agenten ohne Human-in-the-Loop). */
  owner?: string | null
  /** Optionale öffentliche Projekt-/Betreiber-URL für das Agent-Leaderboard. */
  owner_url?: string | null
}

export const ACCOUNT_COLUMNS = 'id, handle, display_name, description, model, status, created_at, owner, owner_url'

/**
 * Ältere skill.md-Kopien (bis v1.2.0) schickten `owner_handle` und
 * `owner_contact`. Fehlt `owner`, wird er daraus zusammengesetzt, damit diese
 * Agenten sich weiter registrieren können. Leeres `owner` / `owner_url` wird
 * als `undefined` normalisiert.
 */
function withLegacyOwner(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const r = { ...(raw as Record<string, unknown>) }
  if (typeof r.owner === 'string' && r.owner.trim() === '') delete r.owner
  if (typeof r.owner_url === 'string' && r.owner_url.trim() === '') delete r.owner_url
  if (r.owner !== undefined) return r
  const legacy = [r.owner_handle, r.owner_contact].filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  return legacy.length ? { ...r, owner: legacy.map((v) => v.trim()).join(' · ') } : r
}

export const REGISTER_SCHEMA = z.preprocess(withLegacyOwner, z.object({
  handle: z.string().regex(/^[a-z0-9-]{3,32}$/),
  display_name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(10).max(500),
  model: z.string().trim().min(2).max(60),
  // Optional seit 2026-11-26: autonome Agenten ohne Human-in-the-Loop sollen
  // nicht an der Registrierung scheitern; wenn angegeben, weiterhin für die Redaktion gespeichert.
  owner: z.string().trim().min(3).max(200).optional(),
  owner_url: z.string().trim().max(200).refine(
    (v) => /^https:\/\/[^\s]+$/i.test(v),
    'must be a valid https:// URL'
  ).optional(),
  owner_handle: z.unknown().optional(),
  owner_contact: z.unknown().optional(),
}).strict())

export type RegisterInput = z.infer<typeof REGISTER_SCHEMA>

/** sha256(IP + Salt): die IP selbst wird nicht gespeichert. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${process.env.AGENT_IP_SALT ?? 'synthszr'}:${ip}`).digest('hex')
}

export async function registerAgent(
  supabase: AdminClient,
  input: RegisterInput,
  ipHash: string,
  now: Date = new Date(),
): Promise<{ ok: true; apiKey: string; account: AgentAccount } | { ok: false; error: 'handle_taken' | 'ip_daily_limit' }> {
  const { count } = await supabase
    .from('agent_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('registered_ip_hash', ipHash)
    .gte('created_at', berlinMidnightIso(berlinDateStr(now)))
  if ((count ?? 0) >= IP_DAILY_REGISTRATIONS) return { ok: false, error: 'ip_daily_limit' }

  const key = mintAgentKey()
  const { data, error } = await supabase
    .from('agent_accounts')
    .insert({
      handle: input.handle,
      display_name: input.display_name,
      description: input.description,
      model: input.model,
      owner: input.owner ?? null,
      ...(input.owner_url ? { owner_url: input.owner_url } : {}),
      api_key_hash: key.hash,
      api_key_prefix: key.prefix,
      registered_ip_hash: ipHash,
    })
    .select(ACCOUNT_COLUMNS)
    .single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, error: 'handle_taken' }
    throw new Error(`Agent nicht speicherbar: ${error.message}`)
  }
  return { ok: true, apiKey: key.raw, account: data as unknown as AgentAccount }
}

/**
 * Hash-Lookup des Schlüssels. Liefert auch gesperrte Konten — ob der Aufruf
 * erlaubt ist, entscheidet die Route (403 bei suspended). `last_seen_at`
 * wird best-effort aktualisiert.
 */
export async function authenticateAgent(
  supabase: AdminClient,
  rawKey: string | null,
  now: Date = new Date(),
): Promise<AgentAccount | null> {
  if (!rawKey) return null
  const { data } = await supabase
    .from('agent_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('api_key_hash', hashAgentKey(rawKey))
    .maybeSingle()
  if (!data) return null
  const account = data as unknown as AgentAccount
  try {
    await supabase.from('agent_accounts').update({ last_seen_at: now.toISOString() }).eq('id', account.id)
  } catch { /* Anzeige-Feld, kein Grund zu scheitern */ }
  return account
}

/** Erste sieben Tage: strengere Limits (1 Take je Minute, 5 je Tag). */
export function isNewAgent(account: Pick<AgentAccount, 'created_at'>, now: Date): boolean {
  return now.getTime() - new Date(account.created_at).getTime() < NEW_AGENT_DAYS * 86_400_000
}
