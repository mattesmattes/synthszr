/**
 * Single-source client helper fuer den Enrich-Pass — Pendant zum
 * inzwischen entfernten lib/editor-in-chief/run-stream.ts. Wird von allen
 * vier Aufrufstellen genutzt (Blog-Posts-Dialog, Generated-Articles-Dialog,
 * Generated-Articles-Edit-Seite, Create-Article-Seite).
 *
 * Anders als das alte Editor-in-Chief: kein Markdown-Parameter — der Server
 * bekommt das GANZE TipTap-Dokument, waehlt die Abschnitte selbst aus
 * (lib/enrich/sections.ts) und meldet Fortschritt PRO ABSCHNITT statt
 * Token-fuer-Token. `onSectionDone`/`onSectionError` erlauben dem Aufrufer,
 * bereits fertige Abschnitte SOFORT ins Editor-Dokument zu splicen, statt
 * auf den kompletten Lauf zu warten — genau das macht einen fehlgeschlagenen
 * Abschnitt harmlos fuer die uebrigen.
 */
import type { TiptapNode } from '@/lib/email/tiptap-to-html'

export interface EnrichSectionResult {
  queueItemId: string | null
  isTake: boolean
  /** Ordinalposition unter den queueItemId-losen Abschnitten — s. Kommentar
   *  bei EnrichSection.nullIndex (lib/enrich/sections.ts). Ohne dieses Feld
   *  landen mehrere Abschnitte ohne queueItemId im selben Artikel beim
   *  Splicen alle am ERSTEN von ihnen (bestaetigter Praxisfall). */
  nullIndex: number
  nodes: TiptapNode[]
}

export interface EnrichSectionError {
  queueItemId: string | null
  isTake: boolean
  headingText: string
  error: string
}

export interface RunEnrichOptions {
  model?: string | null
  onStatus?: (msg: string) => void
  /** Wird sofort bei jedem fertigen Abschnitt aufgerufen — Aufrufer sollte
   *  applySectionResult (lib/enrich/sections.ts) nutzen, um die Knoten anhand
   *  von queueItemId/isTake (NICHT eines Index) in sein Dokument zu splicen. */
  onSectionDone?: (result: EnrichSectionResult) => void
  /** Abschnitt bleibt im Dokument unveraendert; nur zur Anzeige/Log. */
  onSectionError?: (err: EnrichSectionError) => void
}

export interface RunEnrichSummary {
  totalSections: number
  processed: number
  errors: number
}

export async function runEnrichOnTiptap(
  content: Record<string, unknown>,
  options: RunEnrichOptions = {},
): Promise<RunEnrichSummary> {
  const { model, onStatus, onSectionDone, onSectionError } = options

  const res = await fetch('/api/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ content, ...(model ? { model } : {}) }),
  })

  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody.error || `HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let summary: RunEnrichSummary | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    buffer = frames.pop() || ''
    for (const frame of frames) {
      const line = frame.trim()
      if (!line.startsWith('data:')) continue
      const json = line.slice(5).trim()
      if (!json) continue
      let evt: Record<string, unknown>
      try {
        evt = JSON.parse(json)
      } catch {
        continue
      }
      if (evt.started && onStatus) {
        onStatus(`Enrich läuft (${evt.promptName || 'Default'}, ${evt.model}) — ${evt.totalSections} Abschnitt(e)…`)
      }
      if (evt.sectionStart && onStatus) {
        onStatus(`Bearbeite: ${evt.headingText}…`)
      }
      if (evt.sectionDone) {
        onSectionDone?.({
          queueItemId: (evt.queueItemId as string) ?? null,
          isTake: Boolean(evt.isTake),
          nullIndex: typeof evt.nullIndex === 'number' ? evt.nullIndex : -1,
          nodes: evt.nodes as TiptapNode[],
        })
      }
      if (evt.sectionError) {
        onSectionError?.({
          queueItemId: (evt.queueItemId as string) ?? null,
          isTake: Boolean(evt.isTake),
          headingText: (evt.headingText as string) || '',
          error: evt.error as string,
        })
      }
      if (evt.done) {
        summary = { totalSections: 0, processed: evt.processed as number, errors: evt.errors as number }
      }
    }
  }

  if (!summary) throw new Error('Enrich-Stream endete ohne Abschluss-Ereignis')
  return summary
}
