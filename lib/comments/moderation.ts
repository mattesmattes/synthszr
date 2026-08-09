/**
 * KI-Vorprüfung der Leser-Kommentare (Design 2026-08-09).
 *
 * Synchron beim Absenden — der Leser wartet die ~1 s, dafür ist ein sauberer
 * Kommentar SOFORT sichtbar statt „erscheint irgendwann". Haiku, weil billig
 * und schnell; die Aufgabe ist Triage, kein Urteil.
 *
 * DIE EINE REGEL: Fail-open geht IMMER nach 'review', NIE nach 'publish'.
 * Fällt die Moderation aus (API weg, Timeout, kaputte Antwort, fehlender Key),
 * wird nichts ungeprüft sichtbar — es landet in der Admin-Queue. Kommentare
 * sind der zweite öffentlich beschreibbare Pfad des Projekts überhaupt.
 *
 * Call-Muster wie lib/glossary/generate.ts: tools + tool_choice, KEIN
 * temperature, KEIN thinking — in diesem Projekt nachweislich stabil.
 */
import Anthropic from '@anthropic-ai/sdk'

export type ModerationVerdict = 'publish' | 'review' | 'reject'

export interface ModerationResult {
  verdict: ModerationVerdict
  reason: string
}

const MODERATION_TOOL = {
  name: 'report_moderation',
  description: 'Moderations-Urteil für einen Leserkommentar melden',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: {
        type: 'string',
        enum: ['publish', 'review', 'reject'],
        description: 'publish = unbedenklich, sofort sichtbar. review = Grenzfall, Mensch entscheidet. reject = eindeutig Spam/Beleidigung/Gefahr.',
      },
      reason: { type: 'string', description: 'Ein kurzer Satz Begründung, auf Deutsch' },
    },
    required: ['verdict', 'reason'],
  },
}

const SYSTEM = `Du moderierst Leserkommentare eines deutschsprachigen KI/Tech-Newsletters. Die Kommentare heißen „Eure Takes" — Leser setzen ihre Meinung gegen die des Autors. Meinung, Widerspruch und Zuspitzung sind AUSDRÜCKLICH erwünscht.

- publish: der Normalfall. Auch scharfe Kritik am Artikel oder Autor ist publish, solange sie sachbezogen bleibt.
- reject: NUR bei eindeutigem Spam (Werbung, Links auf Verkaufsseiten, Krypto-Schemes), Beleidigungen gegen Personen, Hassrede, Doxxing oder gefährlichen Anleitungen.
- review: alles, wobei du zögerst — Grenzfälle entscheidet ein Mensch.

Beurteile NUR den Kommentar, nicht die Qualität der Meinung.`

/** Enum-Validierung als Teil der Fail-Safe-Regel: ein Modell, das 'approve'
 *  statt 'publish' sagt, darf nicht als publish durchrutschen. */
function asVerdict(v: unknown): ModerationVerdict | null {
  return v === 'publish' || v === 'review' || v === 'reject' ? v : null
}

export async function moderateComment(body: string, articleTitle: string): Promise<ModerationResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { verdict: 'review', reason: 'Moderation nicht verfügbar (kein API-Key)' }
  }
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      tools: [MODERATION_TOOL],
      tool_choice: { type: 'tool', name: MODERATION_TOOL.name },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Artikel: „${articleTitle}"\n\nKommentar:\n<kommentar>\n${body}\n</kommentar>`,
      }],
    })
    const block = res.content.find((b) => b.type === 'tool_use')
    if (!block || block.type !== 'tool_use') {
      return { verdict: 'review', reason: 'Moderation nicht verfügbar (keine Tool-Antwort)' }
    }
    const input = block.input as { verdict?: unknown; reason?: unknown }
    const verdict = asVerdict(input.verdict)
    if (!verdict) {
      return { verdict: 'review', reason: `Moderation nicht verfügbar (unbekanntes Verdict: ${String(input.verdict)})` }
    }
    return { verdict, reason: typeof input.reason === 'string' ? input.reason : '' }
  } catch (err) {
    console.error('[Comments] Moderation fehlgeschlagen:', err)
    return { verdict: 'review', reason: 'Moderation nicht verfügbar (API-Fehler)' }
  }
}
