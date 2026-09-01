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
 *
 * Fortsetzbar (Betreiber-Korrektur 2026-09-01): ein 18-Abschnitte-Artikel mit
 * Websuche pro Abschnitt ueberschritt das maxDuration-Limit der Route, Vercel
 * kappte die Verbindung mitten im Lauf ("Enrich-Stream endete ohne
 * Abschluss-Ereignis"). Meldet ein Aufruf-Ereignis `needsContinuation: true`
 * (die Route hat aus Zeitbudget-Gruenden fruehzeitig abgebrochen, s.
 * app/api/enrich/route.ts), stoesst runEnrichOnTiptap automatisch einen
 * weiteren Aufruf an — mit denselben Original-Content und einer Ausschluss-
 * liste der bereits verarbeiteten Abschnitte (sowohl erfolgreiche als auch
 * gescheiterte, sonst wuerde eine permanent fehlschlagende Section jede Runde
 * erneut versucht). Fuer die Aufrufer transparent: onSectionDone/
 * onSectionError/onStatus werden einfach ueber mehrere HTTP-Requests hinweg
 * weiter aufgerufen, das zurueckgegebene RunEnrichSummary summiert alle
 * Runden.
 */
import type { TiptapNode } from '@/lib/email/tiptap-to-html'
import type { SectionKey } from '@/lib/enrich/sections'

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
  nullIndex: number
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

type ExcludeKey = SectionKey

// Harte Obergrenze an Fortsetzungs-Runden — reiner Sicherheitsnetz-Wert
// gegen einen Endlos-Loop, falls die Route aus irgendeinem Grund IMMER
// needsContinuation meldet. 12 Runden decken selbst einen Artikel mit
// deutlich mehr als den bisher beobachteten 18 Abschnitten grosszuegig ab.
const MAX_CONTINUATION_ROUNDS = 12

async function runOneRound(
  content: Record<string, unknown>,
  model: string | null | undefined,
  excludeKeys: ExcludeKey[],
  options: RunEnrichOptions,
): Promise<{ processed: number; errors: number; needsContinuation: boolean; newExcludeKeys: ExcludeKey[] }> {
  const { onStatus, onSectionDone, onSectionError } = options

  const res = await fetch('/api/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      content,
      ...(model ? { model } : {}),
      ...(excludeKeys.length ? { excludeKeys } : {}),
    }),
  })

  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody.error || `HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: { processed: number; errors: number; needsContinuation: boolean } | null = null
  const newExcludeKeys: ExcludeKey[] = []

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
        const queueItemId = (evt.queueItemId as string) ?? null
        const isTake = Boolean(evt.isTake)
        const nullIndex = typeof evt.nullIndex === 'number' ? evt.nullIndex : -1
        newExcludeKeys.push({ queueItemId, isTake, nullIndex })
        onSectionDone?.({ queueItemId, isTake, nullIndex, nodes: evt.nodes as TiptapNode[] })
      }
      if (evt.sectionError) {
        const queueItemId = (evt.queueItemId as string) ?? null
        const isTake = Boolean(evt.isTake)
        const nullIndex = typeof evt.nullIndex === 'number' ? evt.nullIndex : -1
        newExcludeKeys.push({ queueItemId, isTake, nullIndex })
        onSectionError?.({ queueItemId, isTake, nullIndex, headingText: (evt.headingText as string) || '', error: evt.error as string })
      }
      if (evt.done) {
        result = {
          processed: evt.processed as number,
          errors: evt.errors as number,
          needsContinuation: Boolean(evt.needsContinuation),
        }
      }
    }
  }

  if (!result) throw new Error('Enrich-Stream endete ohne Abschluss-Ereignis')
  return { ...result, newExcludeKeys }
}

export async function runEnrichOnTiptap(
  content: Record<string, unknown>,
  options: RunEnrichOptions = {},
): Promise<RunEnrichSummary> {
  const excludeKeys: ExcludeKey[] = []
  let processed = 0
  let errors = 0

  for (let round = 0; round < MAX_CONTINUATION_ROUNDS; round++) {
    const roundResult = await runOneRound(content, options.model, excludeKeys, options)
    processed += roundResult.processed
    errors += roundResult.errors
    excludeKeys.push(...roundResult.newExcludeKeys)
    if (!roundResult.needsContinuation) break
    options.onStatus?.(`Enrich läuft weiter (Fortsetzung ${round + 2}) — ${excludeKeys.length} Abschnitt(e) bereits fertig…`)
  }

  return { totalSections: excludeKeys.length, processed, errors }
}
