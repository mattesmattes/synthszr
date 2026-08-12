/**
 * Zweite Instanz über die Kandidatenliste: sortiert aus, was kein Lexikonbegriff ist.
 *
 * WARUM ES DIESEN SCHRITT BRAUCHT: `identifyCandidates` liest jeden Artikel
 * einzeln und entscheidet im Kontext dieses einen Textes. Genau dort wirkt ein
 * Allgemeinwort erklärungsbedürftig — „Testumgebung" klingt in einem
 * Technikartikel fachlich, „Übernahme" in einem Finanzartikel. Der Prompt zählt
 * Ausschlusskriterien auf, doch die Praxis zeigt zweimal dasselbe Ergebnis
 * (Betreiber 2026-08-12): Von 62 gesammelten Kandidaten war rund die Hälfte
 * ungültig — darunter Firmennamen wie „Claude" oder „HuggingFace", die der
 * Prompt AUSDRÜCKLICH ausschließt.
 *
 * Diese Prüfung sieht die Liste dagegen ALS LISTE, ohne Artikelkontext. Die
 * Frage lautet nicht mehr „ist das hier erklärungsbedürftig?", sondern „würde
 * das in einem Fachlexikon stehen?" — eine Frage, die sich ohne den
 * suggestiven Kontext deutlich verlässlicher beantworten lässt.
 *
 * WIRTSCHAFTLICH IST DER SCHRITT EIN GEWINN, kein Zusatzaufwand: ein Aufruf
 * prüft die ganze Liste, während jeder durchgerutschte Fehlbegriff einen vollen
 * Generierungslauf kostet (zwei Opus-Aufrufe, Bildgenerierung, 45-90s) — plus
 * einen Eintrag, den jemand später von Hand verbergen muss.
 *
 * Fällt der Aufruf aus, bleibt die Liste UNVERÄNDERT. Ein Filter, der bei
 * Störung alles verwirft, wäre schlimmer als keiner.
 */
import { z } from 'zod'
import { isExcludedGlossaryTerm } from '@/lib/data/glossary-exclusions'

const VerdictSchema = z.object({
  reject: z.array(z.object({
    name: z.string(),
    reason: z.enum(['allgemeinwort', 'firma_oder_produkt', 'adhoc_formulierung', 'dublette']),
  })),
})

const FILTER_TOOL = {
  name: 'report_rejections',
  description: 'Meldet, welche Kandidaten KEINE Lexikonbegriffe sind',
  input_schema: {
    type: 'object' as const,
    properties: {
      reject: {
        type: 'array',
        description: 'Nur die abzulehnenden Kandidaten. Was gültig ist, wird nicht aufgeführt.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Der Kandidat, exakt wie übergeben' },
            reason: {
              type: 'string',
              enum: ['allgemeinwort', 'firma_oder_produkt', 'adhoc_formulierung', 'dublette'],
            },
          },
          required: ['name', 'reason'],
        },
      },
    },
    required: ['reject'],
  },
}

export function buildFilterPrompt(names: string[]): string {
  return `Hier ist eine Liste von Kandidaten für ein Fachlexikon. Prüfe JEDEN einzeln und melde die, die NICHT hineingehören.

DAS LEXIKON ERKLÄRT: Technik/IT, KI, Finanzen/Kapitalmarkt sowie Mathematik/Wissenschaft, soweit sie in KI-Artikeln vorkommt.

ABLEHNEN (mit Grund):
- allgemeinwort — Ein Erwachsener ohne Fachwissen versteht das Wort. Auch dann, wenn es in einem Fachartikel steht. Beispiele: Anbieter, Rechner, Büroarbeit, Fehlerbehebung, Übernahme, Vorstandschef, Testumgebung, Umschreiben, Warteschlange, Sitzung, Händler, Berechtigung, Metropolregion, Absichtserklärung, Grafikkarte, Arbeitsablauf.
  Achtung bei Wörtern mit technischem Beiklang: „Testumgebung" und „Arbeitsablauf" sind zusammengesetzte Alltagswörter, keine benannten Verfahren.
- firma_oder_produkt — Firmen, Marken, Modellnamen, Veranstaltungen, Standorte. Beispiele: Claude, Claude Code, HuggingFace, TUI, Kimi K3.
  AUSGENOMMEN: benannte TECHNOLOGIEN mit eigenem Erklärgehalt (Kubernetes, gVisor, Graviton) — die bleiben.
- adhoc_formulierung — Formulierung des Autors, die außerhalb dieses Textes niemand nachschlägt. Beispiele: „Claude Mythos", „Domänenmarkt".
- dublette — Flexions- oder Schreibvariante eines anderen Kandidaten DERSELBEN Liste. Behalte die Grundform, lehne die Variante ab (z. B. „Subagenten" ablehnen, wenn „Subagent" in der Liste steht).

BEHALTEN, auch wenn sie selten sind: echte Fachbegriffe wie Riemann-Hypothese, Nullstelle, Mixture of Experts, First-Party-Daten, Slug, Subagent, Physical AI.

Im Zweifel BEHALTEN — ein fehlender Eintrag ist leichter zu ergänzen als ein falscher zu entfernen.

KANDIDATEN:
${names.map((n) => `- ${n}`).join('\n')}

Antworte via Tool mit reject: nur den abzulehnenden Kandidaten, jeder mit Grund. Ist alles gültig, gib eine leere Liste zurück.`
}

export interface CandidateFilterResult {
  keep: string[]
  rejected: Array<{ name: string; reason: string }>
}

/**
 * Trennt gültige Kandidaten von ungültigen.
 *
 * Die harte Liste (isExcludedGlossaryTerm) greift VOR dem Modell — was dort
 * steht, ist eine Betreiber-Entscheidung und wird nicht zur Abstimmung gestellt.
 */
export async function filterCandidates(names: string[]): Promise<CandidateFilterResult> {
  const rejected: Array<{ name: string; reason: string }> = []
  const zuPruefen: string[] = []
  for (const n of names) {
    if (isExcludedGlossaryTerm(n)) rejected.push({ name: n, reason: 'gesperrt' })
    else zuPruefen.push(n)
  }
  if (zuPruefen.length === 0 || !process.env.ANTHROPIC_API_KEY) {
    return { keep: zuPruefen, rejected }
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { getModelForUseCase } = await import('@/lib/ai/model-config')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const model = await getModelForUseCase('glossary_candidate_identification')

    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      tools: [FILTER_TOOL],
      tool_choice: { type: 'tool', name: FILTER_TOOL.name },
      messages: [{ role: 'user', content: buildFilterPrompt(zuPruefen) }],
    })
    const block = resp.content.find((b) => b.type === 'tool_use')
    const parsed = VerdictSchema.safeParse(block && 'input' in block ? block.input : null)
    if (!parsed.success) return { keep: zuPruefen, rejected }

    // Nur Namen übernehmen, die WIRKLICH in der Liste standen: ein Modell, das
    // einen Namen umformuliert, dürfte sonst einen gültigen Kandidaten mitreißen.
    const inListe = new Map(zuPruefen.map((n) => [n.toLowerCase(), n]))
    const abgelehnt = new Set<string>()
    for (const r of parsed.data.reject) {
      const treffer = inListe.get(r.name.toLowerCase())
      if (!treffer) continue
      abgelehnt.add(treffer)
      rejected.push({ name: treffer, reason: r.reason })
    }
    return { keep: zuPruefen.filter((n) => !abgelehnt.has(n)), rejected }
  } catch (err) {
    // Bei Störung NICHTS verwerfen — lieber ein Fehlbegriff zu viel als eine
    // stillschweigend halbierte Kandidatenliste.
    console.error('[GlossaryCandidateFilter] Pruefung fehlgeschlagen:', err instanceof Error ? err.message : err)
    return { keep: zuPruefen, rejected }
  }
}
