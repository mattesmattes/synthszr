import { createAdminClient } from '@/lib/supabase/admin'

const PAGE_SIZE = 1000

export interface ActiveSubscriberRow {
  id: string
  email: string
  preferences: unknown
}

/**
 * Alle aktiven Subscriber, seitenweise geladen. Ein einfaches `.select().eq()`
 * ohne `range()` kappt bei PostgREST still ab 1000 Zeilen (Befund 2026-08-19:
 * 1012 aktive Subscriber, Versand erreichte nur die ersten 1000 — ohne Fehler,
 * ohne Log). Betroffen waren sowohl der manuelle als auch der Cron-Versand.
 */
export async function fetchAllActiveSubscribers(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<ActiveSubscriberRow[]> {
  const out: ActiveSubscriberRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('subscribers')
      .select('id, email, preferences')
      .eq('status', 'active')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Aktive Subscriber nicht ladbar: ${error.message}`)
    const rows = (data ?? []) as ActiveSubscriberRow[]
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return out
}
