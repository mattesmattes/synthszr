import { createAdminClient } from '@/lib/supabase/admin'

const ALERT_KEY = 'system_alert_credit'

export interface SystemAlert {
  provider: string
  message: string
  created_at: string
}

export function isCreditBalanceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /credit balance is too low/i.test(msg)
}

export function detectProvider(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/anthropic/i.test(msg)) return 'Anthropic'
  if (/openai/i.test(msg)) return 'OpenAI'
  if (/google|gemini/i.test(msg)) return 'Google'
  return 'AI Provider'
}

export async function recordSystemAlert(provider: string, message: string): Promise<void> {
  try {
    const supabase = createAdminClient()
    const alert: SystemAlert = {
      provider,
      message: message.slice(0, 500),
      created_at: new Date().toISOString(),
    }
    await supabase
      .from('settings')
      .upsert({ key: ALERT_KEY, value: alert }, { onConflict: 'key' })
  } catch (err) {
    console.error('[SystemAlert] Failed to record:', err)
  }
}

export async function getActiveSystemAlert(): Promise<SystemAlert | null> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', ALERT_KEY)
      .single()
    return (data?.value as SystemAlert) ?? null
  } catch {
    return null
  }
}

export async function dismissSystemAlert(): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('settings').delete().eq('key', ALERT_KEY)
}

export async function recordCreditAlertIfApplicable(err: unknown): Promise<boolean> {
  if (!isCreditBalanceError(err)) return false
  const provider = detectProvider(err)
  const msg = err instanceof Error ? err.message : String(err)
  await recordSystemAlert(provider, `${provider} API: Credit-Guthaben aufgebraucht. ${msg.slice(0, 200)}`)
  return true
}
