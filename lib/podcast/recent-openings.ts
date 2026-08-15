/**
 * Was zuletzt gesendet wurde — damit es sich nicht wiederholt.
 *
 * Die Modi in openers.ts sorgen dafür, dass eine Folge anders ANFÄNGT als die
 * vorige. Sie verhindern aber nicht, dass sich innerhalb eines Modus dieselbe
 * Formulierung einschleift: Acht Einstiege sind acht Einstiege, und nach ein
 * paar Wochen ist jeder davon selbst zur Schablone geworden.
 *
 * Deshalb bekommt das Modell die letzten Eröffnungen und Verabschiedungen im
 * WORTLAUT zu sehen — mit dem Auftrag, etwas anderes zu schreiben. Das ist die
 * einzige Varianz, die nicht selbst wieder in einer Liste steht.
 *
 * KEINE neue Tabelle und kein neues Feld: Die Skripte liegen bereits vollständig
 * in `post_podcasts.script_content`. Ein eigenes Gedächtnisfeld daneben wäre
 * eine zweite Wahrheit über dieselbe Sache — und hätte eine Migration gebraucht,
 * die in diesem Projekt nur von Hand einzuspielen ist.
 */
import { createAdminClient } from '@/lib/supabase/admin'

/** Wie viele Sprechzeilen Anfang und Ende umfassen. Zwei bis drei tragen die
 *  Formulierung, mehr blähen den Prompt ohne zusätzliche Aussage. */
const LINES = 3

/** Zeilen, die jemand spricht — Regieanweisungen und Marker fallen weg. */
function speechLines(script: string): string[] {
  return script
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(HOST|GUEST)\b/i.test(l))
}

export function extractOpening(script: string): string | null {
  const lines = speechLines(script)
  return lines.length ? lines.slice(0, LINES).join(' ').slice(0, 600) : null
}

export function extractClosing(script: string): string | null {
  const lines = speechLines(script)
  return lines.length ? lines.slice(-LINES).join(' ').slice(0, 600) : null
}

export interface RecentEdges {
  openings: string[]
  closings: string[]
}

/**
 * Die Ränder der letzten Folgen.
 *
 * Fehlschlag ist unkritisch: Dann fehlt dem Prompt nur der Abgleich, und die
 * Modi allein sorgen weiter für Abwechslung. Ein Podcast, der wegen einer
 * fehlgeschlagenen Gedächtnis-Abfrage gar nicht entsteht, wäre der schlechtere
 * Tausch.
 */
export async function getRecentEdges(locale: string, count = 4): Promise<RecentEdges> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('post_podcasts')
      .select('script_content')
      .eq('locale', locale)
      .not('script_content', 'is', null)
      .order('created_at', { ascending: false })
      .limit(count)

    if (error) {
      console.warn('[PodcastEdges] Letzte Skripte nicht lesbar:', error.message)
      return { openings: [], closings: [] }
    }

    const scripts = ((data ?? []) as Array<{ script_content: string | null }>)
      .map((r) => r.script_content)
      .filter((s): s is string => Boolean(s))

    return {
      openings: scripts.map(extractOpening).filter((s): s is string => Boolean(s)),
      closings: scripts.map(extractClosing).filter((s): s is string => Boolean(s)),
    }
  } catch (err) {
    console.warn('[PodcastEdges]', err instanceof Error ? err.message : err)
    return { openings: [], closings: [] }
  }
}

/** Der Prompt-Abschnitt. Leer, wenn es nichts zu vergleichen gibt — ein
 *  Abschnitt mit der Überschrift „zuletzt gesendet" und nichts darunter würde
 *  das Modell nur verwirren. */
export function recentEdgesSection(edges: RecentEdges, lang: string): string {
  if (edges.openings.length === 0 && edges.closings.length === 0) return ''

  const liste = (xs: string[]) => xs.map((x, i) => `${i + 1}. ${x}`).join('\n')

  if (lang === 'de') {
    return `\n\n**ZULETZT GESENDET — NICHT WIEDERHOLEN:**
Das waren die Anfänge der letzten Folgen:
${liste(edges.openings)}

Und die Schlüsse:
${liste(edges.closings)}

Schreibe etwas ANDERES. Nicht nur andere Wörter für dieselbe Bewegung, sondern eine andere Bewegung: Wenn zuletzt mit einer Frage eröffnet wurde, eröffne nicht wieder mit einer Frage. Wenn zuletzt mit einem Ausblick geschlossen wurde, schließe anders. Der Wiedererkennungssatz bleibt davon unberührt — er ist Marke, keine Formulierung.`
  }
  return `\n\n**RECENTLY AIRED — DO NOT REPEAT:**
Openings of the last episodes:
${liste(edges.openings)}

And the closings:
${liste(edges.closings)}

Write something DIFFERENT — not just different words for the same move, but a different move. The recognisable greeting is exempt: it is branding, not phrasing.`
}
