import type { createAdminClient } from '@/lib/supabase/admin'
import { lastCompleteWeek } from '@/lib/wrapup/week'
import { collectWeekTopics } from '@/lib/wrapup/collect'
import { wrapupSlugBase } from '@/lib/wrapup/build'

// Wie in build.ts/collect.ts: aus der Factory ableiten statt selbst tippen.
type AdminClient = ReturnType<typeof createAdminClient>

export interface WrapupStatus {
  /** Menschenlesbarer Zeitraum, z. B. „17. bis 23. August 2026". */
  weekLabel: string
  mondayDate: string
  slugBase: string
  post: { id: string; slug: string; status: string; created_at: string } | null
  topicCount: number
  /**
   * `fehlt`: Material liegt vor, ein Rueckblick noch nicht — seit dem Wegfall
   * des Sonntags-Crons (2026-08-23, Betreiberentscheidung) ist das eine
   * ERINNERUNG, keine Stoerung: der Rueckblick wird bewusst von Hand angestossen.
   * `keine_themen` heisst, es gaebe ohnehin nichts zusammenzufassen.
   */
  verdict: 'vorhanden' | 'fehlt' | 'keine_themen'
}

/**
 * Zustand des Wochenrueckblicks fuer die letzte abgeschlossene Woche.
 *
 * WARUM ES DAS GIBT: Bis zum 2026-08-23 erzeugte ein Sonntags-Cron den
 * Rueckblick. Er gab in JEDEM Fall HTTP 200 zurueck, weshalb ein Fehlschlag
 * genauso aussah wie ein Erfolg — am 2026-08-16 entstand trotz sechs
 * verfuegbarer Themen kein Entwurf, bemerkt wurde es erst sechs Tage spaeter.
 * Der Cron ist inzwischen entfernt (Betreiberentscheidung: der Rueckblick wird
 * von Hand ueber /admin/week-wrapup angestossen). Die Anzeige bleibt trotzdem
 * nuetzlich — sie beantwortet auf einen Blick, ob fuer die abgelaufene Woche
 * schon ein Rueckblick existiert und auf wie vielen Tagen er beruht.
 *
 * Deshalb wird hier der ZUSTAND gemeldet statt eines Fehlers protokolliert: der
 * Zustand ist die eigentliche Information, er braucht keine neue Tabelle, und er
 * stimmt auch dann noch, wenn der Fehlschlag Wochen zurueckliegt.
 */
export async function getWrapupStatus(supabase: AdminClient): Promise<WrapupStatus> {
  const week = lastCompleteWeek(new Date())
  const slugBase = wrapupSlugBase(week.mondayDate)

  // Auf dem STAMM suchen, nicht auf Gleichheit — ein zweiter Lauf haengt eine
  // Zahl an (buildUniqueSlug), und auch „…-2" ist ein vorhandener Rueckblick.
  const { data } = await supabase
    .from('generated_posts')
    .select('id, slug, status, created_at')
    .like('slug', `${slugBase}%`)
    .order('created_at', { ascending: false })
    .limit(1)

  const rows = (data ?? []) as Array<{ id: string; slug: string; status: string; created_at: string }>
  const post = rows[0] ?? null

  // Themen immer zaehlen, auch wenn der Rueckblick da ist: die Zahl zeigt im
  // Panel, auf wie vielen Tagen er beruht.
  const topics = await collectWeekTopics(supabase, week.mondayIso, week.saturdayEndIso)

  return {
    weekLabel: week.label,
    mondayDate: week.mondayDate,
    slugBase,
    post,
    topicCount: topics.length,
    verdict: post ? 'vorhanden' : topics.length > 0 ? 'fehlt' : 'keine_themen',
  }
}
