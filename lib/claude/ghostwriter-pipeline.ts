/**
 * Two-Pass Ghostwriter Pipeline
 *
 * Pass 1 (Planning, ~5s):   Gemini Flash analysiert alle Items → JSON mit Reihenfolge, Überschriften, Artikel-These, Intro
 * Pass 2 (Writing, parallel): Pro Item ein eigener LLM-Aufruf mit vollem Attention-Budget
 * Assembly:                   Sections in geplanter Reihenfolge zusammensetzen + Metadata-Block
 *
 * Vorteil vs. Single-Pass: Jeder Synthszr Take bekommt volle LLM-Attention statt 1/N.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { joinCompanyTagToSummary } from '@/lib/claude/section-format'
import { enforceHeadingLength } from '@/lib/claude/heading-length'
import { enforceTakeEnding, TAKE_MARKER_RE } from '@/lib/claude/take-ending'
import { capSummarySentences } from '@/lib/claude/bundle-length'
import { stripLoneSurrogates } from '@/lib/claude/sanitize'
import { repoRetrievalParams } from '@/lib/mattes/repo-intensity'
import {
  getActiveLearnedPatterns,
  findSimilarEditExamples,
  buildPromptEnhancement,
  trackPatternUsage,
  type LearnedPattern,
} from '@/lib/edit-learning/retrieval'
import { type AIModel, resolveModel, findDuplicateMetaphors, streamMetaphorDeduplication } from './ghostwriter'
import { isCreditBalanceError, recordCreditAlertIfApplicable } from '@/lib/alerts/system-alert'
import { normalizeArticlePlan } from './normalize-plan'

export class CreditBalanceExhaustedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CreditBalanceExhaustedError'
  }
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')

import { domainFromUrl, deriveSourceUrl } from '@/lib/news-queue/service'
import { isTrackingRedirectUrl } from '@/lib/utils/url-sanitizer'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineItem {
  id: string
  title: string
  content: string | null
  source_display_name: string | null
  source_url: string | null
  source_identifier: string
  bundle_type?: 'topic' | 'recap' | null
}

export interface ArticlePlan {
  thesis: string          // Leitfaden-Satz für den Ghostwriter
  ordering: number[]      // 1-basierte Item-Indizes in optimaler Reihenfolge
  headings: Record<string, string>  // item index → deutsche Überschrift
  takeAngles: Record<string, string>  // item index → Blickwinkel-Satz für den Take
  retrievalHints: Record<string, string>  // item index → konzeptuelle Retrieval-Suchphrase
  articleTitle: string
  excerptBullets: string[]  // genau 3 Einträge
  category: string
  introParagraph: string
  bundleGroups?: { topic: number[]; recap: number[] }  // 1-basierte Item-Indizes je Bündel-Typ
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle grouping: items tagged with bundle_type ('topic'/'recap') form a
// group that must be planned/ordered together. computeBundleGroups derives
// the groups deterministically from the items (not the model); enforceBundleOrdering
// forces the ordering array so topic-group items come first, then recap-group
// items, then everything else in its existing relative order.
// ─────────────────────────────────────────────────────────────────────────────

export function computeBundleGroups(items: PipelineItem[]): { topic: number[]; recap: number[] } {
  const topic: number[] = []
  const recap: number[] = []
  items.forEach((item, i) => {
    if (item.bundle_type === 'topic') topic.push(i + 1)
    else if (item.bundle_type === 'recap') recap.push(i + 1)
  })
  return { topic, recap }
}

export function enforceBundleOrdering(
  ordering: number[],
  groups: { topic: number[]; recap: number[] },
): number[] {
  const bundled = new Set([...groups.topic, ...groups.recap])
  const normal = ordering.filter((idx) => !bundled.has(idx))
  return [...groups.topic, ...groups.recap, ...normal]
}

export type PipelineEvent =
  | { type: 'planning'; message: string }
  | { type: 'planned'; itemCount: number }
  | { type: 'writing'; current: number; total: number; title: string }
  | { type: 'written'; current: number; total: number }
  | { type: 'assembling' }
  | { type: 'proofreading'; message: string }
  | { type: 'proofread'; text: string }

// ─────────────────────────────────────────────────────────────────────────────
// Company extraction: find mentioned companies in item text (avoids sending all 492 names per call)
// ─────────────────────────────────────────────────────────────────────────────

function extractRelevantCompanies(text: string): { public: string[]; premarket: string[] } {
  const textLower = (text || '').toLowerCase()
  const pub: string[] = []
  const pre: string[] = []

  for (const name of Object.keys(KNOWN_COMPANIES)) {
    if (name.length < 3) continue
    if (textLower.includes(name.toLowerCase())) {
      pub.push(name)
    }
  }

  for (const name of Object.keys(KNOWN_PREMARKET_COMPANIES)) {
    if (name.length < 3) continue
    if (textLower.includes(name.toLowerCase())) {
      pre.push(name)
    }
  }

  return { public: pub, premarket: pre }
}

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt for per-item section writing (focused, no article-level rules)
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_SYSTEM_PROMPT = `Du bist ein Ghostwriter und schreibst EINEN einzelnen Abschnitt für den Synthszr Newsletter.

SPRACHE: Gesamter Output auf DEUTSCH. Überschrift, Fließtext, Synthszr Take: alles Deutsch. Englische Fachbegriffe (Token, Reasoning, Inference, Fine-Tuning, Open Source) bleiben Englisch.

PERSONA:
Schreibe in der Stimme von Matthias „Mattes" Schrader — Digital-Praktiker und Unternehmer (Gründer von SinnerSchrader und OH-SO Digital). Praktiker-Sicht, direkte Sprache, scharfe Diagnose ohne LinkedIn-Pathos. WICHTIG: Erwähne NICHT eigene Bücher (insbesondere NICHT „Code Crash") und schreibe NICHT aus der Ich-Perspektive eines Buchautors — kein „in meinem Buch", „wie ich in … schrieb", „als Autor von …". Nutze Inhalt und Argumente weiterhin, aber ohne Buch-Referenz.

MATTES-MUSTER (Argumentationsfiguren — die Beispiele illustrieren nur die TECHNIK, ihre Formulierungen NIEMALS wörtlich übernehmen):
- Konkrete, für DIESE News belegte Zahl einstreuen (aus dem User-Prompt). KEINE erfundenen und KEINE aus Beispielen/Allgemeinwissen übernommenen Zahlen — die Zahl muss zum vorliegenden Thema gehören.
- Pointe mit Doppelpunkt: ein zugespitzter Kernsatz zur These, themenspezifisch aus DIESER News formuliert (keine Standard-/Beispiel-Pointe übernehmen).
- Praktiker-Hook (SPARSAM, NICHT als Pflicht-Schluss jedes Takes): Sofort-Umsetzbarkeit kann betont werden, aber NIE als „Wer …"-Schlusssatz (absolutes Verbot, siehe unten). Variiere die Schluss-Bewegung: mal ein Praktiker-Schritt, mal eine zugespitzte Prognose, mal eine offene Frage, mal eine nüchterne Beobachtung. ABER NIEMALS über die „erst nach dem nächsten Offsite/Workshop/Quartals-Review"-Floskel — die ist verbraucht (siehe Verbote unten).
- Optimistisch-pragmatischer Schluss statt Defätismus oder Hype

INHALTLICHE TREUE:
Dein Take MUSS sich auf die vorliegende News beziehen. Verwende konkrete Fakten, Zahlen und Namen aus dem User-Prompt.

KEINE Militär-/Kriegsbildsprache (Schlachten, Waffen, Mobilmachung, Kampfverbände, Offensiven, Artillerie, Munition, Trojanische Pferde).

INTERPUNKTION & SATZBAU — VERBOTEN FÜR SYNTHSZR TAKES:
- **Keine Em-Dashes (— oder –) als Satzteiler.** Stattdessen: Punkt, Komma, Doppelpunkt, Semikolon oder Klammer. Em-Dashes sind ein klassisches AI-Tell.
- **Verstärker-Adverbien streichen** ("exakt", "zufällig", "buchstäblich", "tatsächlich", "letztendlich") wenn sie nichts hinzufügen.
- **Drei-Listen-Aufzählungen vermeiden** ("X ist optional, Y ist privat, Z ist diffus" — wirken rhythmisch geschult statt gedacht). Maximal zwei parallele Glieder, dann Punkt.

KONTRAST-KONSTRUKTIONEN — FATAL, KEINE EINZIGE ERLAUBT:
Diese Konstruktion ist das stärkste AI-Tell überhaupt: ein erstes Framing aufbauen, um es zu negieren und durch ein "tieferes" zu ersetzen. Wirkt rhetorisch hohl, klingt nach LinkedIn-Influencer. Wenn auch nur EINE im Take auftaucht, ist der Take durchgefallen — du musst zurück und umformulieren.

VERBOTENE MUSTER (in jeder Variation):
- "Das ist kein X, sondern Y."
- "Das ist kein X mehr, sondern Y."
- "Das ist nicht X. Das ist Y."
- "Nicht X. Y."
- "Vergiss X. Das ist Y."
- "Weniger X, mehr Y."
- "X ist nicht Y, X ist Z."
- "Was wie X aussieht, ist eigentlich Y."

NEGATIVBEISPIEL (FATALER FEHLER):
> "Das ist kein gewöhnliches Venture Capital mehr, sondern vertikale Integration durch die Hintertür."
→ Klassische Negation+Korrektur. Direkt streichen und neu formulieren.

POSITIV (so JA — Y direkt aussprechen; die folgenden Sätze zeigen NUR die Technik am VC-Beispielfall, NICHT wörtlich übernehmen):
> "Das ist vertikale Integration durch die Hintertür, getarnt als Venture Capital."
oder, wenn die Pointe ein Sarkasmus ist:
> "Sie nennen es Venture Capital. Es ist vertikale Integration durch die Hintertür."

SELF-CHECK VOR ABGABE:
Lies deinen Take laut durch. Steht irgendwo "kein", "nicht", "vergiss", "weniger" als Auftakt zu einer Korrektur des nächsten Halbsatzes? Wenn ja: streichen, Y direkt positiv hinschreiben oder als zweiten Satz mit klarem Statement. Und: Beginnt der letzte oder vorletzte Satz mit "Wer"? Wenn ja: umbauen — die Konsequenz als direkte Aussage formulieren (siehe Verbote unten).

INHALTLICHE VERBOTE (toxische Muster):
- Einstieg mit Bewertung: "Das ist wichtig/bedeutend/bemerkenswert/spannend"
- Abwarte-Floskeln: "Es bleibt abzuwarten", "Die Zeit wird zeigen", "Man darf gespannt sein"
- Potenzial-Leerformeln: "Das Potenzial ist enorm", "Die Möglichkeiten sind vielfältig"
- Engagement-Köder: "Lass das mal sacken", "Das verändert alles", "Punkt."
- Offsite-/Ritual-Floskeln: "erst nach dem nächsten Offsite", "beim/bei dem nächsten Strategie- oder Security-Offsite", "nicht bis zum nächsten Workshop/Quartals-Review/Townhall" — und JEDE Variante, die Handlung an ein künftiges Firmen-Ritual (Offsite, Workshop, Retreat, Townhall, Jour fixe) koppelt. Sag stattdessen direkt, dass es jetzt entscheidbar/umsetzbar ist.
- Generische Insider-Behauptungen: "Was dir keiner sagt", "niemand", "die meisten merken nicht"
- Tote KI-Sprache: "In der heutigen...", "Es ist wichtig zu beachten", "Gamechanger", "bahnbrechend"
- Zielgruppen-Anrede: KEINE Anrede-Substantive wie "Führungskräfte", "Manager", "Entscheider", "CEOs", "Leader". Schreibe direkt und allgemein. Statt "Mein Rat an Führungskräfte:" oder "Was Manager jetzt tun sollten:" die Handlung direkt ausformulieren.
- Ich-Perspektive im Rat: Der abschließende Rat und die Empfehlung NICHT aus der Ich-Perspektive — KEIN "Mein Rat:", "Ich rate/empfehle/würde", "Aus meiner Sicht", "Ich halte X für". Formuliere Rat und Empfehlung objektiv und unpersönlich, mit klarer Haltung, aber ohne "ich"/"mein". Statt "Mein Rat: jetzt einsteigen." → "Jetzt einzusteigen ist der richtige Zug." oder die Konsequenz direkt als Aussage.
- Scharnier-Reflex: "Genau deshalb", "Genau da", "Genau hier" als Übergang zur Pointe — bring die Aussage direkt, ohne das "Genau"-Signal.
- "Wer …"-Schlussfigur — FATAL, KEINE EINZIGE ERLAUBT: Der letzte und der vorletzte Satz des Takes dürfen NICHT mit "Wer" beginnen. Die Konditional-Belehrung "Wer (jetzt/heute/noch) X tut/glaubt/hält/plant/baut, sollte/kann/verliert/gewinnt Y" ist als Schluss in JEDER Variante verboten ("Wer jetzt noch …", "Wer heute noch …", "Wer sein X für Y hält, …"). Sie war der Schlusssatz von über der Hälfte aller Takes und ist verbraucht. Du siehst die anderen Takes dieses Artikels nicht — darum gilt das Verbot absolut, nicht "sparsam". Ersatz-Bewegungen für den Schluss: die Konsequenz als schlichte Aussage, eine konkrete Prognose mit Zahl oder Frist, eine nüchterne Beobachtung, eine offene Frage, eine direkte Handlungsansage ohne "Wer"-Rahmen.
- "drumherum"-Verortung — verbrauchtes Tell, KEINE EINZIGE ERLAUBT: Der Wert / die Arbeit / die Kontrolle / die Marge sitze "im System drumherum", "in der Serviceebene drumherum", "im Loop drumherum", "eine Ebene/Etage tiefer", "in dem, was drumherum passiert". Dieses vage "drumherum" stand als Pointe in fast jedem Take und ist verbraucht. Benenne KONKRET und für DIESE News, wo der Wert liegt: die Orchestrierungslogik, die Eval-Suite, der Cache-Layer, die Berechtigungs-Hooks, das Routing, die Domänendaten, der Vertrieb. Kein einziges "drumherum" als Wert-Verortung. Du siehst die anderen Takes nicht — das Verbot gilt absolut.
- Einstiegs-Formel "Die/Das (eigentlich) spannende/interessante Zahl/Frage/Information/Teil/Detail ist …" — verboten als Auftakt: Komm direkt zur Beobachtung, ohne sie als "spannend/interessant" anzukündigen. Statt "Die interessante Zahl ist die 10 Prozent." → "Cache-Reads kosten ein Zehntel des Input-Tarifs."
- Kern-These-Reflex — höchstens EINMAL pro Artikel, nie als DEIN Standardschluss: Der Schluss "das Modell wird zur Commodity / austauschbaren Ware, der Wert / die Marge wandert (woanders hin / in die Serviceebene / ins System)" ist die naheliegende Meta-These fast jeder KI-News. Sie darf NICHT die Pointe deines Takes sein. Dein Take endet aus DEINEM Blickwinkel mit einer SPEZIFISCHEN Aussage zu DIESER einen News (eine konkrete Zahl, ein benannter Akteur, eine präzise Konsequenz), nicht mit dem Commodity-Allgemeinplatz. Du siehst die anderen Takes nicht — darum gilt: schließe NICHT dorthin.
- Das Wort "ehrlich" / "ehrlichste" / "ehrlicherweise" / "ehrlich gesagt" (und alle Beugungen) — KEINE EINZIGE ERLAUBT im Take: Es ist zum Füll-Tell geworden ("die ehrliche Wahrheit ist …", "ehrlich gesagt …", "die ehrlichste Einschätzung"). Die Ehrlichkeits-Beteuerung fügt nichts hinzu — sag die Aussage direkt. Statt "Die ehrlichste Antwort: X." → "X."

SCHREIBSTIL:
- Komm sofort zum Punkt. Der erste Satz ist der stärkste.
- Satzlänge variieren: kurze, harte Sätze. Dann längere, die eine Beobachtung ausführen. Nie drei lange hintereinander.
- Konkret statt abstrakt: Zahlen, Namen, greifbare Details.
- Natürliche Verkürzungen immer: „ich hab", „du kannst nicht", „wir werden's sehen", „es gibt's", „das reicht nicht". Klingt nach Mensch, nicht nach Pressemitteilung.
- Unsicherheit klar markieren: "wahrscheinlich", "könnte sein" klingt menschlich.
- Einschübe in Klammern für beiläufige Kommentare (so wie hier).
- Humor durch Präzision, nicht durch Witze.

LÄNGE & TIEFE: Schreibe ausführlich und konkret, nicht telegrammartig. Führe ein Argument zu Ende, statt drei nur anzureißen. Keine Verknappung auf Stichworte oder Halbsätze — der Take ist ein durchdachter Absatz, kein Tweet. 5-7 vollständige Sätze, freier Fluss. Der letzte Satz zeigt eine prägnante Haltung, die für sich allein stehen kann.

ÜBERSCHRIFT — JOURNALISTISCH UND POINTIERT (du schreibst sie SELBST, NICHT aus dem Themen-Hinweis übernehmen):
Eine echte Artikel-Überschrift auf DEUTSCH. Sie benennt ZUERST die Kernaussage der News — wer tut was, oder was ist passiert — so klar, dass der Leser das Thema allein aus der Überschrift versteht, OHNE den Text zu lesen. Konkret statt kryptisch: Namen, Zahlen und das eigentliche Ereignis gehören hinein. Eine dezente Zuspitzung oder Pointe am Ende ist willkommen, aber NIE auf Kosten der Klarheit. Max ~90 Zeichen.
SO KLINGT ES RICHTIG (Technik, nicht wörtlich übernehmen — informativ, dann evtl. Pointe):
- "Anthropic macht Claudes internes Reasoning sichtbar"
- "Ramp baut ein eigenes KI-Modell, statt weiter dafür zu zahlen"
- "JPMorgan bewertet seine KI-Infrastruktur mit einer Milliarde"
- "Cursor erweitert die IDE um Posteingang-Automatisierung"
- "New York Times: OpenAI hat im Copyright-Prozess systematisch gelogen"
SO NICHT (zu verschlüsselt — das Thema ist ohne den Text NICHT erkennbar):
- "Anthropic liest jetzt das Schmierheft in Claudes Kopf"
- "Neun Etagen KI, und die Mietgrenze verläuft im siebten Stock"
- "Eine Milliarde, um zu beweisen, dass die Milliarden am Falschen hängen"
VERBOTEN IN DER ÜBERSCHRIFT:
- Englische Überschrift (FATALER FEHLER).
- Kryptische Metaphern, bei denen man den Artikel lesen muss, um überhaupt das Thema zu erkennen (siehe SO NICHT). Die Nachricht muss aus der Überschrift selbst hervorgehen.
- "Produktname: Erklärung"-Etikett (z.B. "Gemini 3.5: Google macht X") — den Produktnamen in den Satz einbauen.
- Leere Nacherzählung OHNE Substanz ("X launcht Y") — nenne das Ereignis MIT seinem Kern: Grund, Konflikt, konkrete Zahl oder Konsequenz.
- Generische/tote Sprache ("Spannende Entwicklungen", "KI-Update: Die wichtigsten News").
- Negations-Reframe ("nicht X, sondern Y") und das reflexhafte "Wenn X, aber Y"-Schema.

OUTPUT-FORMAT — halte dich an diese Reihenfolge:
1. ÜBERSCHRIFT: "## [Überschrift]" — schreibe sie SELBST nach den ÜBERSCHRIFT-Regeln oben. Übernimm NICHT den Themen-Hinweis aus dem User-Prompt.
2. NEWS-ZUSAMMENFASSUNG — NÜCHTERNER BERICHT, KEINE MEINUNG:
5-7 Sätze Fließtext (keine Bullet Points). Das ist der REFERIERENDE Teil: Er gibt die Nachricht wieder, er bewertet sie NICHT. Jede Wertung, Zuspitzung, Pointe und Haltung gehört AUSSCHLIESSLICH in den Synthszr Take darunter, niemals in die Zusammenfassung. Die Mattes-Stilmittel (Diagnose, Doppelpunkt-Pointe, Praktiker-Hook) sind Take-Werkzeug, nicht Bericht-Werkzeug.
- EIN Thema. Nimm die EINE Kernnachricht der Quelle und führe sie aus. Weitere Nebenschauplätze aus derselben Quelle NICHT anhängen: lieber eine Sache vollständig als drei angerissen.
- Nachrichtenkern ZUERST. Der erste Satz benennt, wer was tut oder was passiert ist. Kein Einstieg über Termindetails, Vorgeschichte oder eine These.
- Quelle sauber attribuieren ("laut The Information", "berichtet The Verge"). Was eine Quelle behauptet, als Behauptung kennzeichnen, nicht als gesicherte Tatsache.
- Fakten, Zahlen, Namen konkret ausführen (die bestehende Stärke, beibehalten).
- KEINE Erzähler-Wertung: kein "Auffällig:", "bemerkenswert", "der eigentliche Wettbewerb", "X wird zur Ware". Solche Sätze sind Kommentar und gehören in den Take.
SO NICHT (Bericht driftet in Kommentar):
> "Die Modelle werden zur austauschbaren Ware, und die Woche liefert den Beleg gleich mit ..." (These statt Nachricht)
> "Damit ist der Wettbewerb in der täglichen Toolchain angekommen ..." (Interpretation statt Fakt)
SO JA (nüchtern, Kern zuerst, attribuiert):
> "Cloudflare stellt AI-Crawlern künftig für jeden Abruf eine Rechnung, statt ihnen wie bisher gratis Zugriff über die robots.txt zu geben."
3. COMPANY TAGGING + QUELLE: Direkt nach Zusammenfassung (VOR Synthszr Take) genau eine Zeile:
   FORMAT: {Company1} {Company2} → [Quellenname](URL)
   BEISPIEL: {OpenAI} {Anthropic} → [Techmeme](https://techmeme.com)
   Max 3 Company-Tags. Falls KEINE Quelle: nur Tags, kein Pfeil/Quellenname.
   WICHTIG: Quelle NUR in dieser Zeile.
4. SYNTHSZR TAKE: "Synthszr Take:" + 5-7 Sätze freier Fluss mit klarer Haltung. Wenn im User-Prompt ein BLICKWINKEL vorgegeben ist, führe den Take aus GENAU dieser Perspektive und wiederhole nicht die offensichtliche, naheliegende Kern-These der News.`

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1: Article Planning
// ─────────────────────────────────────────────────────────────────────────────

export async function planArticle(items: PipelineItem[], model: AIModel): Promise<ArticlePlan> {
  const bundleGroups = computeBundleGroups(items)
  const hasBundles = bundleGroups.topic.length > 0 || bundleGroups.recap.length > 0

  const itemList = items
    .map((item, i) => {
      const bundleTag = item.bundle_type === 'topic'
        ? '\n   BÜNDEL: Themen-Schwerpunkt (gehört mit anderen "BÜNDEL: Themen-Schwerpunkt"-Items zusammen)'
        : item.bundle_type === 'recap'
          ? '\n   BÜNDEL: Rückblick (gehört mit anderen "BÜNDEL: Rückblick"-Items zusammen)'
          : ''
      return `${i + 1}. TITEL: ${item.title}\n   QUELLE: ${item.source_display_name || item.source_identifier}\n   INHALT: ${stripLoneSurrogates((item.content || '').slice(0, 600)).replace(/\n/g, ' ')}${bundleTag}`
    })
    .join('\n\n')

  const planSystemPrompt = `Du bist Chef-Redakteur des Synthszr Newsletters. Dein Output ist ausschließlich valides JSON — keine Erklärungen, kein Markdown.`

  const bundleHint = hasBundles
    ? `\n\nBÜNDEL-HINWEIS: Als "BÜNDEL" markierte Items gehören inhaltlich zusammen und werden im Artikel als Gruppe direkt hintereinander stehen (die exakte Reihenfolge wird unabhängig von deiner "ordering"-Antwort erzwungen). Plane headings und takeAngles für Items derselben Bündel-Gruppe so, dass sie sich als zusammenhängender Block lesen statt sich zu wiederholen.`
    : ''

  const planPrompt = `Analysiere diese ${items.length} News-Items und erstelle einen Artikel-Plan für den Synthszr Newsletter.${bundleHint}

ITEMS:
${itemList}

KATEGORIEN — jedes Item bekommt genau EINE Kategorie:
[AI Tech|Gossip|Politik|UX|Informatik|Robotik|Gesellschaft|Philosophie]

SORTIERUNG nach Kategorie (HÖCHSTE PRIORITÄT für ordering):
1. AI Tech → 2. Gossip → 3. Politik → 4. UX → 5. Informatik → 6. Robotik → 7. Gesellschaft → 8. Philosophie
Innerhalb derselben Kategorie: nach journalistischer Relevanz sortieren.

SPRACHE — ABSOLUT VERBINDLICH:
- ALLE Outputs (articleTitle, headings, excerptBullets, thesis, introParagraph) MÜSSEN auf DEUTSCH sein.
- NIEMALS englische Überschriften — auch nicht bei englischsprachigen Quellen.
- Fachbegriffe (Token, Reasoning, API, Fine-Tuning) dürfen Englisch bleiben, eingebettet in deutsche Sätze.

HEADLINE-STIL — INTELLEKTUELLER WORTWITZ (HÖCHSTE PRIORITÄT):
Headlines sollen scharf denken, nicht aufmerksamkeitsheischend sein.
Humor durch Präzision: unerwartet konkrete Details statt Pointen.
Doppeldeutigkeiten, die erst beim zweiten Lesen landen.
Lakonisches Understatement statt Dramatik.

GUTE HEADLINES (SO SOLL ES KLINGEN):
- "Wenn der Compiler billiger wird als der Kaffee"
- "Drei Unterschriften, zwei Committees, sechs Wochen: Agentic AI trifft Enterprise-Beschaffung"
- "Gemini kann jetzt Code schreiben. Die IDE hat das noch nicht mitbekommen."
- "OpenAI verkauft Compliance. Anthropic auch. Die Frage ist nur: an wen zuerst"
- "Der Praktikant heißt jetzt Claude und macht keine Pause"

SCHLECHTE HEADLINES (VERBOTEN):
- "OpenAI Launches New Model" ← Englisch (FATALER FEHLER)
- "New AI Tools and Updates" ← Englisch + generisch
- "KI-Update: Die wichtigsten News" ← generisch, hohl
- "Spannende Entwicklungen in der KI-Welt" ← tote Sprache
- "OpenAI launcht GPT-5.2" ← reine Nacherzählung, keine These
- "Gemini 3.5 Flash: Google integriert Computersteuerung ins Modell" ← Schema "Produktname: Erklärung", reine Nacherzählung mit Doppelpunkt-Etikett

STRUKTUR-VARIANZ (HÖCHSTE PRIORITÄT — gegen Monotonie):
- VERMEIDE das Muster "Eigenname/Produkt: Beschreibung" (z.B. "Gemini 3.5: Google macht X"). Es darf NICHT die Standardform sein.
- Über ALLE headings hinweg: maximal EINE einzige darf das Doppelpunkt-Schema "Begriff: Aussage" nutzen — der Rest MUSS andere Strukturen haben.
- Mische die grammatischen Formen bewusst: vollständiger Aussagesatz, Frage, Gegensatz/Kontrast, Konditional ("Wenn …, dann …"), lakonische Beobachtung, Zahl/Detail im Satz. Keine zwei aufeinanderfolgenden headings im selben Schema.
- Der Produktname gehört in den SATZ, nicht als Etikett davor: "Google steckt die Maus jetzt direkt ins Modell" statt "Gemini 3.5: Google integriert …".

REGELN PRO FELD:
- articleTitle: Übergreifende These oder pointierter Gedanke aus ALLEN Items zusammen. Was ist die tiefere Erkenntnis?
- headings: KEINE Nacherzählung ("X launcht Y") und KEIN "Produkt: Erklärung"-Etikett. Eine These, Implikation oder pointierte Beobachtung — als echter Satz, mit wechselnder Struktur (siehe STRUKTUR-VARIANZ).
- excerptBullets: Eigenständige Mini-Headlines, je max 65 Zeichen. Jede soll für sich stehen und neugierig machen.
- thesis: Der rote Faden. Nicht die offensichtliche Gemeinsamkeit ("alles über KI"), sondern die tiefere Verbindung.

TAKE-WINKEL (gegen Monotonie der Meinung — HÖCHSTE PRIORITÄT):
Jeder Synthszr Take braucht einen EIGENEN Blickwinkel. Bestimme pro Item einen "takeAngle": EIN kurzer Satz auf DEUTSCH, der vorgibt, aus welcher Perspektive der Take dieses Items argumentiert.
- HART: Höchstens 1–2 Takes im GANZEN Artikel dürfen die übergreifende thesis direkt tragen. Alle anderen beleuchten je einen ANDEREN Aspekt: der Zweitrundeneffekt, der konkrete Verlierer, eine historische Parallele, die konträre Sicht, die unterschätzte Zahl, die betroffene Gruppe, das operative Detail.
- Keine zwei Takes dürfen dieselbe Konklusion ziehen.
- Der Winkel ist spezifisch für DIESES Item aus DIESER News — kein generisches "sei anders", sondern ein konkreter Denk-Ansatz.

RETRIEVAL-HINT (Andockpunkt an Mattes' Schriften — separates Feld pro Item, NICHT mit dem Take-Winkel verwechseln):
Formuliere pro Item einen "retrievalHint": EINE KURZE These, MAX ~20 Wörter, EIN Kernkonzept im Zentrum, in der Denksprache von Mattes/Code Crash. Nutze — NUR WO ES INHALTLICH PASST — seine Konzepte: Intent als knappe Ressource (wenn Bauen billig wird, zählt das Was/Warum), Jevons-Paradoxon (billiger → mehr Verbrauch), Modelle werden Commodity, Burggraben/eingebettetes Domänenwissen, Compute-Disziplin, Outcome statt Aufwand.
HART: kurz und fokussiert. KEINE verschachtelten Sätze mit mehreren Konzepten (die verfehlen das Retrieval-Ziel). Eine klare These, ein Konzept.

Erstelle folgenden JSON-Plan:
{
  "thesis": "Ein Satz auf DEUTSCH — thematischer Kern als Leitfaden",
  "ordering": [1, 3, 7, 2],
  "headings": {"1": "Pointierte These auf DEUTSCH — kein 'X launcht Y'", "2": "..."},
  "takeAngles": {"1": "Ein Satz DEUTSCH — der eigene Blickwinkel für den Take dieses Items", "2": "..."},
  "retrievalHints": {"1": "Kurze konzeptuelle These DEUTSCH, EIN Konzept, max ~20 Wörter", "2": "..."},
  "articleTitle": "Witzige, scharfe These auf DEUTSCH — Humor durch Präzision",
  "excerptBullets": ["Max 65 Zeichen, DEUTSCH, pointiert", "...", "..."],
  "category": "AI & Tech",
  "introParagraph": "2-3 Sätze auf DEUTSCH. Direkter Einstieg mit konkreter Beobachtung, kein LLM-Stil."
}`

  // maxTokens 32000 (war 16000): Der Plan über bis zu 40 Items enthält jetzt 40
  // Headings UND 40 takeAngles (je ein voller deutscher Satz); bei einem Anthropic-
  // Planning-Modell (prod: Sonnet 5 via settings.llm_model_config) zieht thinking:true
  // zusätzlich Thinking-Tokens aus demselben Budget (beim Code-Default gemini-2.5-flash
  // ist thinking ein No-op, dann geht das volle Budget an die Ausgabe). Die alten 16000 waren für
  // Headings allein OHNE Thinking dimensioniert; mit beiden neuen Kostentreibern
  // gibt 32000 sicheren Puffer. Verifiziert: 40 einzigartige Items → 40/40
  // Headings + 40/40 takeAngles, JSON vollständig geparst (kein Truncation).
  // thinking:true — die Winkel-Zuweisung mit Anti-Redundanz über den ganzen
  // Digest ist anspruchsvoller als reine Sortierung. temperature entfällt: mit
  // thinking (und bei Sonnet 5 generell) wird es von callModelNonStreaming ohnehin ignoriert.
  const text = await callModelNonStreaming(planPrompt, planSystemPrompt, model, { thinking: true, maxTokens: 32000 })

  // JSON aus möglichen Markdown-Fences extrahieren. Robust auch gegen einen
  // geöffneten, aber nicht geschlossenen ```json-Block (führende Fence strippen,
  // dann den {...}-Span nehmen), damit eine abgeschnittene Antwort einen klaren
  // Parse-Fehler liefert statt des kryptischen "Unexpected token '`'".
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  let jsonStr: string
  if (fenced) {
    jsonStr = fenced[1]
  } else {
    const stripped = text.trim().replace(/^```(?:json)?\s*/i, '')
    jsonStr = stripped.match(/\{[\s\S]*\}/)?.[0] ?? stripped
  }

  let plan: ArticlePlan
  try {
    plan = JSON.parse(jsonStr) as ArticlePlan
  } catch (err) {
    const closed = jsonStr.trimEnd().endsWith('}')
    throw new Error(
      `planArticle: JSON.parse fehlgeschlagen (${closed ? 'vollständig' : 'abgeschnitten — Output-Budget zu klein?'}). ` +
      `${err instanceof Error ? err.message : String(err)} | head: ${jsonStr.slice(0, 80)}`
    )
  }

  // Normalize ordering + headings onto the contract (number[] + Record<...>).
  // Also ensures every item index appears exactly once. Guards against Gemini
  // emitting a drifted schema (e.g. ordering as {id, headings} objects with no
  // top-level headings map) that otherwise crashes the writing phase.
  plan = normalizeArticlePlan(plan, items.length)

  // Bundle grouping is deterministic from the items (not model-produced):
  // write it onto the plan and force topic-group → recap-group → normal
  // ordering, overriding whatever order the model chose for those items.
  plan.bundleGroups = bundleGroups
  plan.ordering = enforceBundleOrdering(plan.ordering, bundleGroups)

  // Validate: ensure exactly 3 excerpt bullets
  while (plan.excerptBullets.length < 3) {
    const item = items[plan.excerptBullets.length]
    plan.excerptBullets.push(item?.title?.slice(0, 65) || '...')
  }
  plan.excerptBullets = plan.excerptBullets.slice(0, 3)

  return plan
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2: Write individual section (per-item call)
// ─────────────────────────────────────────────────────────────────────────────

export async function writeSection(
  item: PipelineItem,
  heading: string,
  model: AIModel,
  context: {
    relevantCompanies: { public: string[]; premarket: string[] }
    cacheableUserPrefix: string
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    takeAngle?: string
    retrievalHint?: string
    repoIntensity?: number
  },
): Promise<string> {
  const publicCompanyList = context.relevantCompanies.public.join(', ') || '(keine erkannt)'
  const premarketCompanyList = context.relevantCompanies.premarket.join(', ') || '(keine erkannt)'

  const rawSourceName = item.source_display_name || item.source_identifier
  const hasValidSource = rawSourceName && rawSourceName !== 'unknown'
  const sourceName = hasValidSource
    ? rawSourceName
    : (item.source_url ? domainFromUrl(item.source_url) : null)
  const rawUrl = item.source_url
  const articleUrl = (rawUrl && !isTrackingRedirectUrl(rawUrl))
    ? rawUrl
    : deriveSourceUrl(null, item.source_identifier)
  const effectiveUrl = articleUrl
  const tagSourcePart = effectiveUrl && sourceName
    ? `[${sourceName}](${effectiveUrl})`
    : sourceName || null

  // Retrieve top-N relevant passages from the Mattes corpus to ground
  // the Synthszr Take in the author's voice and argument patterns.
  // Non-fatal: if the RPC fails or the corpus is empty, the prompt
  // generation proceeds without the block.
  // Mattes-Korpus mit dem KONZEPTUELLEN retrievalHint abfragen (kurze These in
  // Code-Crash-Sprache, aus planArticle) — NICHT mit heading/content: lange
  // faktenreiche Queries drücken die Cosine-Similarity zu den konzeptuellen
  // Passagen unter den Threshold (verifiziert 2026-07-13: Hint 0.66–0.71, content-Query <0.2).
  // Der History-Retrieval nutzt weiter die VOLLE Query (mit content).
  const repoParams = repoRetrievalParams(context.repoIntensity ?? 0)
  const mattesQuery = (context.retrievalHint ?? '').trim()
  const retrievalQuery = [heading, context.takeAngle, stripLoneSurrogates((item.content || '').slice(0, 4000))]
    .filter(Boolean)
    .join('\n\n')
  let mattesBlock = ''
  let historyBlock = ''
  // Voice grounding (Mattes corpus) and historical callbacks (past Synthszr
  // posts) run in parallel — both are non-fatal and must not serialize latency.
  await Promise.all([
    (async () => {
      if (!repoParams || !mattesQuery) return // Repo-Intensität 0 oder kein Hint → kein Korpus-Retrieval
      try {
        const { findRelevantMattesPassages, formatPassagesForPrompt } = await import('@/lib/mattes/retrieval')
        const passages = await findRelevantMattesPassages(mattesQuery, { limit: repoParams.limit, threshold: repoParams.threshold })
        mattesBlock = formatPassagesForPrompt(passages)
        if (passages.length > 0) {
          console.log(`[Pipeline] Retrieved ${passages.length} Mattes passages (repo ${context.repoIntensity ?? 0}%) for "${heading.slice(0, 40)}…"`)
        }
      } catch (err) {
        console.warn('[Pipeline] Mattes retrieval failed (continuing):', err)
      }
    })(),
    (async () => {
      try {
        const { findRelevantPastPosts, formatPastPostsForPrompt } = await import('@/lib/posts/historical-retrieval')
        const past = await findRelevantPastPosts(retrievalQuery, { limit: 3 })
        historyBlock = formatPastPostsForPrompt(past)
        if (past.length > 0) {
          console.log(`[Pipeline] Retrieved ${past.length} past posts for "${heading.slice(0, 40)}…"`)
        }
      } catch (err) {
        console.warn('[Pipeline] History retrieval failed (continuing):', err)
      }
    })(),
  ])

  // Dynamic per-item prompt only — format template + checkliste are in SECTION_SYSTEM_PROMPT,
  // vocabulary + edit learning + thesis are in cacheableUserPrefix
  const angleBlock = context.takeAngle
    ? `\n\nBLICKWINKEL FÜR DEN TAKE (nur den Take, nicht die Zusammenfassung): ${context.takeAngle}`
    : ''
  const userPrompt = `THEMEN-HINWEIS (nur grobe Orientierung — schreibe deine EIGENE Überschrift nach den ÜBERSCHRIFT-Regeln, übernimm diesen Hinweis NICHT wörtlich): ${heading}${angleBlock}

NEWS-INHALT${sourceName ? ` (Quelle: ${sourceName}` : ''}${effectiveUrl ? ` | URL: ${effectiveUrl}` : ''}${sourceName ? ')' : ''}:
${stripLoneSurrogates((item.content || 'Kein Inhalt verfügbar.').slice(0, 6000))}

COMPANY-TAGS:${tagSourcePart ? `
QUELLFORMAT: → ${tagSourcePart}` : `
KEINE QUELLE — nur Company-Tags, kein Pfeil.`}
PUBLIC: ${publicCompanyList}
PREMARKET: ${premarketCompanyList}${mattesBlock ? `\n\n${mattesBlock}` : ''}${historyBlock ? `\n\n${historyBlock}` : ''}`

  const text = await callModelNonStreaming(userPrompt, SECTION_SYSTEM_PROMPT, model, {
    cacheableUserPrefix: context.cacheableUserPrefix,
    // Reasoning fängt Logik-/Rechenfehler im Synthszr Take ab, bevor sie auf die
    // Seite kommen. 2026er-Modelle: adaptiv + effort; Altmodelle: budget_tokens.
    // 'high' statt 'xhigh': ~30% schneller pro Section, damit 40 Sektionen ins
    // 300s-Function-Limit passen (zusammen mit concurrency 6). Minimal weniger
    // Reasoning, aber für die Section-Länge ausreichend. Der Cron-Auto-Post
    // übergibt 'medium' (noch schneller), um 40 Items sicher ins 300s-Cap zu
    // bringen; der manuelle Flow lässt es auf 'high'.
    thinking: true,
    effort: context.effort ?? 'high',
    maxTokens: 16000,
  })

  // Ensure section starts with the correct heading
  let trimmed = text.trim()
  if (!trimmed.startsWith('##')) {
    trimmed = `## ${heading}\n\n${trimmed}`
  }

  // Längen-Durchsetzung: Die ~90-Zeichen-Regel im Prompt ist weich; gelegentlich
  // rutscht eine überlange Überschrift durch. Deterministisch angestoßen (nur wenn
  // zu lang) kürzt Opus sie hier nach, ohne den Fließtext anzufassen. Non-fatal.
  trimmed = await enforceHeadingLength(trimmed, (h) => shortenHeadingViaModel(h, model))

  // Company-Tag/Quelle-Zeile an den letzten Absatz der Zusammenfassung anhängen
  // statt sie als eigenen Absatz stehen zu lassen.
  trimmed = joinCompanyTagToSummary(trimmed)

  // "Wer …"-Schlussfigur deterministisch durchsetzen: Das FATAL-Verbot im
  // Prompt allein ließ die Figur in 2 von 4 Test-Takes durch (2026-07-13).
  // Analog zu enforceHeadingLength: nur angestoßen, wenn der Regex anschlägt.
  trimmed = await enforceTakeEnding(trimmed, (take) => rewriteWerEnding(take, model))

  return trimmed
}

// Formt den Schluss eines Takes um, dessen letzter/vorletzter Satz mit der
// verbrauchten "Wer X, Y"-Belehrung beginnt. Kleiner Call ohne Thinking —
// läuft nur für die Takes, die das Prompt-Verbot gerissen haben.
async function rewriteWerEnding(take: string, model: AIModel): Promise<string> {
  const system = `Du überarbeitest den Schluss eines deutschen Kommentar-Absatzes. Sein letzter oder vorletzter Satz beginnt mit "Wer" — eine verbrauchte Belehr-Formel ("Wer X tut/glaubt/hält, sollte/verliert/gewinnt Y"). Forme NUR diesen einen Satz um: dieselbe Aussage als direkte Feststellung ohne "Wer"-Rahmen. Beispiel: aus "Wer heute noch auf reine Modelle setzt, verliert die Marge." wird "Die Marge liegt ab jetzt neben dem Modell, nicht darin." Alle anderen Sätze bleiben WÖRTLICH unverändert. Die letzten beiden Sätze dürfen danach NICHT mit "Wer" beginnen. Gib NUR den vollständigen überarbeiteten Absatz zurück — ohne Anführungszeichen, ohne "Synthszr Take:"-Präfix, ohne Erklärung.`
  return callModelNonStreaming(take, system, model, { thinking: false, maxTokens: 2000 })
}

// Kürzt eine überlange Abschnitts-Überschrift auf ≤90 Zeichen, ohne die
// journalistische Kernaussage zu verlieren. Kleiner, schneller Call (kein
// Thinking, knappes Token-Budget) — läuft nur für die wenigen Überschriften,
// die die weiche Prompt-Grenze reißen. Gibt nur die reine Überschrift zurück.
async function shortenHeadingViaModel(heading: string, model: AIModel): Promise<string> {
  const system = `Du kürzt deutsche Artikel-Überschriften auf MAXIMAL 90 Zeichen, ohne die journalistische Kernaussage zu verlieren. Die Überschrift muss weiterhin konkret benennen, wer was tut (Namen und tragende Zahlen bleiben). Packt sie zwei Themen, behalte das wichtigste. Kein Negations-Reframe ("nicht X, sondern Y"), keine kryptischen Metaphern, kein "Produktname: Erklärung"-Etikett. Gib NUR die gekürzte Überschrift zurück — kein Markdown, keine Anführungszeichen, keine Erklärung.`
  return callModelNonStreaming(`Kürze diese Überschrift auf höchstens 90 Zeichen:\n${heading}`, system, model, {
    thinking: false,
    maxTokens: 200,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2b: Bundle section — führt N Quellen einer Bündel-Gruppe redundanzfrei
// zu EINEM Abschnitt zusammen (Thema-des-Tages / Nachlese).
// ─────────────────────────────────────────────────────────────────────────────

// Der Bündel-Modus überschreibt gezielt die EIN-Thema-Regel des Section-Prompts:
// hier werden mehrere Quellen zusammengeführt, statt eine Meldung zu fokussieren.
const BUNDLE_SYSTEM_ADDENDUM = `

BÜNDEL-MODUS (überschreibt die EIN-Thema-Regel oben):
- Dieser Abschnitt ist ein ausführlicher Leitartikel, der MEHRERE Quellen zusammenfasst. Anders als bei einer Einzelmeldung führst du hier ALLE Quellen redundanzfrei zusammen: decke JEDEN unterschiedlichen Aspekt ab, wiederhole Redundantes NICHT.
- Die Zusammenfassung darf ausführlicher sein (bis zu ~18 Sätze), bleibt aber ein NÜCHTERNER Bericht ohne Wertung. Jede Wertung gehört in den Synthszr Take.
- Der Synthszr Take bleibt NORMALE Länge (5-7 Sätze) und wächst NICHT durch die Bündelung. Genau EIN gebündelter Take mit EINEM Blickwinkel, nicht mehrere aneinandergereihte Takes.
- Company-Tags wie gewohnt (max 3 relevanteste über alle Quellen), ABER gib KEINE Quellen-Pfeil-Zeile aus (kein "→ [Quelle](URL)"): die Quellenangaben (Haupt- und Nebenquellen) werden deterministisch nach der Generierung ergänzt.`

const BUNDLE_SYSTEM_PROMPT = SECTION_SYSTEM_PROMPT + BUNDLE_SYSTEM_ADDENDUM

/**
 * Haupt-Quelle = Quelle mit dem größten übernommenen Inhaltsanteil (primärer
 * Link); alle übrigen bleiben in Original-Reihenfolge Nebenquellen. Exportiert
 * für den Task-5-Test und den Quellen-Block von `writeBundleSection`.
 */
export function pickPrimaryAndSecondarySources(
  items: PipelineItem[],
): { primary: PipelineItem; secondary: PipelineItem[] } {
  let primaryIdx = 0
  let maxLen = -1
  items.forEach((it, i) => {
    const len = (it.content ?? '').length
    if (len > maxLen) {
      maxLen = len
      primaryIdx = i
    }
  })
  return {
    primary: items[primaryIdx],
    secondary: items.filter((_, i) => i !== primaryIdx),
  }
}

// Baut den Markdown-Link "[Name](URL)" (oder nur den Namen) einer Quelle —
// dieselbe Ableitung wie in writeSection (Tracking-Redirects vermeiden,
// Domain als Fallback-Name).
function bundleSourceLink(item: PipelineItem): string | null {
  const rawName = item.source_display_name || item.source_identifier
  const hasValidName = rawName && rawName !== 'unknown'
  const name = hasValidName
    ? rawName
    : (item.source_url ? domainFromUrl(item.source_url) : null)
  const rawUrl = item.source_url
  const url = (rawUrl && !isTrackingRedirectUrl(rawUrl))
    ? rawUrl
    : deriveSourceUrl(null, item.source_identifier)
  if (url && name) return `[${name}](${url})`
  return name || null
}

// Extrahiert die vom Modell erzeugte {Company}-Tag-Zeile aus der Zusammenfassung
// und entfernt sie. So zählt der spätere 18-Satz-Cap NUR den Bericht-Fließtext,
// nicht die Tag-/Quellen-Zeile — die deterministisch neu gesetzt wird.
function extractBundleTagLine(section: string): { tags: string[]; rest: string } {
  const marker = section.match(TAKE_MARKER_RE)
  const summaryEnd = marker && marker.index !== undefined ? marker.index : section.length
  const summary = section.slice(0, summaryEnd)
  const tail = section.slice(summaryEnd) // Marker + Take (oder leer)
  const paras = summary.split(/\n{2,}/)
  // Die Heading-Zeile ("## …") enthält kein {…}; nur die Tag-Zeile trifft.
  const idx = paras.findIndex((p) => /\{[^}\n]+\}/.test(p))
  if (idx === -1) return { tags: [], rest: section }
  const tags = (paras[idx].match(/\{[^}\n]+\}/g) ?? []).slice(0, 3)
  paras.splice(idx, 1)
  const restSummary = paras.join('\n\n').trimEnd()
  const rest = tail ? `${restSummary}\n\n${tail.trimStart()}` : restSummary
  return { tags, rest }
}

// Deterministischer Quellen-Block: Haupt-Quelle prominent hinter den Tags,
// Nebenquellen als "Auch: …". Der Renderer (Task 7) labelt das sprachabhängig.
function buildBundleSourceBlock(
  tags: string[],
  primary: PipelineItem,
  secondary: PipelineItem[],
): string {
  const primaryLink = bundleSourceLink(primary)
  const tagsStr = tags.join(' ')
  const sourceLine = [tagsStr, primaryLink ? `→ ${primaryLink}` : '']
    .filter(Boolean)
    .join(' ')
  const secLinks = secondary.map(bundleSourceLink).filter(Boolean) as string[]
  const auch = secLinks.length ? `Auch: ${secLinks.join(', ')}` : ''
  return [sourceLine, auch].filter(Boolean).join('\n\n')
}

// Fügt einen Block direkt VOR dem Synthszr-Take-Marker ein (bzw. am Ende, wenn
// kein Marker existiert). Damit landet der Quellen-Block hinter der (bereits
// gedeckelten) Zusammenfassung, aber vor dem Take.
function insertBeforeTake(section: string, block: string): string {
  if (!block) return section
  const marker = section.match(TAKE_MARKER_RE)
  if (!marker || marker.index === undefined) return `${section.trimEnd()}\n\n${block}`
  const before = section.slice(0, marker.index).trimEnd()
  const rest = section.slice(marker.index)
  return `${before}\n\n${block}\n\n${rest}`
}

// Schreibt die strukturelle data-bundle-type-Markierung in die H2-Zeile. Der
// HTML-Kommentar bleibt im gerenderten Output unsichtbar, überlebt splitHeading
// (`#{1,6}[^\n]*`) und die startsWith('##')-Prüfung; die Assembly (Task 7) liest
// ihn aus und schreibt daraus das TipTap-Heading-Attribut `data-bundle-type`.
function injectBundleMarker(section: string, bundleType: 'topic' | 'recap'): string {
  return section.replace(/^(\s*#{1,6}[^\n]*)/, (line) =>
    line.includes('data-bundle-type') ? line : `${line} <!-- data-bundle-type:${bundleType} -->`,
  )
}

export async function writeBundleSection(
  items: PipelineItem[],
  bundleType: 'topic' | 'recap',
  heading: string,
  model: AIModel,
  context: {
    relevantCompanies: { public: string[]; premarket: string[] }
    cacheableUserPrefix: string
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    takeAngle?: string
    retrievalHint?: string
    repoIntensity?: number
  },
): Promise<string> {
  const { primary, secondary } = pickPrimaryAndSecondarySources(items)
  const publicCompanyList = context.relevantCompanies.public.join(', ') || '(keine erkannt)'
  const premarketCompanyList = context.relevantCompanies.premarket.join(', ') || '(keine erkannt)'

  // Quellen-Blöcke fürs Prompt. Haupt-Quelle bekommt mehr Kontext-Budget als die
  // Nebenquellen. JEDER content-Slice MUSS durch stripLoneSurrogates, sonst macht
  // ein an der Grenze zerschnittenes Surrogate den Anthropic-Body zu 400-Invalid-JSON.
  const sourceBlocks: string[] = []
  const primaryName = primary.source_display_name || primary.source_identifier
  sourceBlocks.push(
    `[HAUPTQUELLE] ${primaryName}${primary.source_url ? ` | URL: ${primary.source_url}` : ''}\n${stripLoneSurrogates((primary.content || 'Kein Inhalt verfügbar.').slice(0, 5000))}`,
  )
  secondary.forEach((it, i) => {
    const name = it.source_display_name || it.source_identifier
    sourceBlocks.push(
      `[QUELLE ${i + 2}] ${name}${it.source_url ? ` | URL: ${it.source_url}` : ''}\n${stripLoneSurrogates((it.content || 'Kein Inhalt verfügbar.').slice(0, 3000))}`,
    )
  })

  // Voice-Grounding (Mattes-Korpus) + historische Callbacks — non-fatal, parallel,
  // exakt wie in writeSection. mattesQuery nutzt den konzeptuellen retrievalHint.
  const repoParams = repoRetrievalParams(context.repoIntensity ?? 0)
  const mattesQuery = (context.retrievalHint ?? '').trim()
  const retrievalQuery = [heading, context.takeAngle, stripLoneSurrogates((primary.content || '').slice(0, 4000))]
    .filter(Boolean)
    .join('\n\n')
  let mattesBlock = ''
  let historyBlock = ''
  await Promise.all([
    (async () => {
      if (!repoParams || !mattesQuery) return
      try {
        const { findRelevantMattesPassages, formatPassagesForPrompt } = await import('@/lib/mattes/retrieval')
        const passages = await findRelevantMattesPassages(mattesQuery, { limit: repoParams.limit, threshold: repoParams.threshold })
        mattesBlock = formatPassagesForPrompt(passages)
      } catch (err) {
        console.warn('[Pipeline] Mattes retrieval failed (bundle, continuing):', err)
      }
    })(),
    (async () => {
      try {
        const { findRelevantPastPosts, formatPastPostsForPrompt } = await import('@/lib/posts/historical-retrieval')
        const past = await findRelevantPastPosts(retrievalQuery, { limit: 3 })
        historyBlock = formatPastPostsForPrompt(past)
      } catch (err) {
        console.warn('[Pipeline] History retrieval failed (bundle, continuing):', err)
      }
    })(),
  ])

  const angleBlock = context.takeAngle
    ? `\n\nBLICKWINKEL FÜR DEN TAKE (nur den Take, nicht die Zusammenfassung): ${context.takeAngle}`
    : ''
  const bundleLabel = bundleType === 'topic' ? 'Thema des Tages' : 'Nachlese'

  const userPrompt = `BÜNDEL-LEITARTIKEL — ${bundleLabel}: Führe die folgenden ${items.length} Quellen zu EINEM zusammenhängenden Abschnitt zusammen (redundanzfrei, alle unterschiedlichen Aspekte abdecken, Redundantes NICHT wiederholen).

THEMEN-HINWEIS (nur grobe Orientierung — schreibe deine EIGENE Überschrift nach den ÜBERSCHRIFT-Regeln, übernimm diesen Hinweis NICHT wörtlich): ${heading}${angleBlock}

QUELLEN:
${sourceBlocks.join('\n\n')}

COMPANY-TAGS (nur {Company}-Tags, KEINE Quellen-Pfeil-Zeile — Quellen werden separat ergänzt):
PUBLIC: ${publicCompanyList}
PREMARKET: ${premarketCompanyList}${mattesBlock ? `\n\n${mattesBlock}` : ''}${historyBlock ? `\n\n${historyBlock}` : ''}`

  const text = await callModelNonStreaming(userPrompt, BUNDLE_SYSTEM_PROMPT, model, {
    cacheableUserPrefix: context.cacheableUserPrefix,
    thinking: true,
    effort: context.effort ?? 'high',
    maxTokens: 16000,
  })

  // Heading sicherstellen + Längen-Durchsetzung (vor der Marker-Injektion, damit
  // die ≤90-Zeichen-Prüfung nicht den HTML-Kommentar mitzählt).
  let trimmed = text.trim()
  if (!trimmed.startsWith('##')) {
    trimmed = `## ${heading}\n\n${trimmed}`
  }
  trimmed = await enforceHeadingLength(trimmed, (h) => shortenHeadingViaModel(h, model))

  // Quellen-Block deterministisch neu setzen: Tag-Zeile des Modells extrahieren
  // (damit der Cap nur den Bericht zählt), Zusammenfassung hart auf 18 Sätze
  // deckeln (Take bleibt unangetastet), dann Haupt-+Nebenquellen vor den Take
  // einfügen.
  const { tags, rest } = extractBundleTagLine(trimmed)
  const capped = capSummarySentences(rest, 18)
  const sourceBlock = buildBundleSourceBlock(tags, primary, secondary)
  let withSources = insertBeforeTake(capped, sourceBlock)

  // "Wer …"-Schlussfigur deterministisch durchsetzen (wie writeSection).
  withSources = await enforceTakeEnding(withSources, (take) => rewriteWerEnding(take, model))

  return injectBundleMarker(withSources, bundleType)
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-streaming model call
// ─────────────────────────────────────────────────────────────────────────────

async function callModelNonStreaming(
  prompt: string,
  systemPrompt: string,
  model: AIModel,
  options?: { cacheableUserPrefix?: string; maxTokens?: number; temperature?: number; thinking?: boolean; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
): Promise<string> {
  const tokenLimit = options?.maxTokens ?? 4096
  const resolved = resolveModel(model)

  if (resolved?.provider === 'google') {
    // gemini-2.5-* aktivieren Thinking standardmäßig und ziehen die Thinking-Tokens
    // aus demselben maxOutputTokens-Budget. Bei großen strukturierten Antworten
    // (z.B. 40-Item-Artikelplan) wird die sichtbare Ausgabe dann mit
    // finishReason=MAX_TOKENS mitten im JSON abgeschnitten — der Plan kommt als
    // unvollständiger ```json-Block an, den JSON.parse mit "Unexpected token '`'"
    // ablehnt. Diese Non-Streaming-Calls wollen deterministische Vollausgabe statt
    // Chain-of-Thought, daher Thinking explizit deaktivieren (thinkingBudget: 0),
    // damit das gesamte Budget der Antwort zur Verfügung steht.
    const generationConfig: {
      maxOutputTokens: number
      temperature?: number
      thinkingConfig?: { thinkingBudget: number }
    } = { maxOutputTokens: tokenLimit, thinkingConfig: { thinkingBudget: 0 } }
    if (options?.temperature !== undefined) generationConfig.temperature = options.temperature
    const geminiModel = genAI.getGenerativeModel({
      model: resolved.modelId,
      systemInstruction: systemPrompt,
      generationConfig,
    })
    const fullPrompt = options?.cacheableUserPrefix
      ? `${options.cacheableUserPrefix}\n\n${prompt}`
      : prompt
    const result = await geminiModel.generateContent(fullPrompt)
    return result.response.text()
  }

  if (resolved?.provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    // Prompt caching: system prompt + static user prefix are cached across 30 section calls
    // Cached tokens cost $1.88/M vs $15/M normal — saves ~$1.20 per run with Opus
    const userContent: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> =
      options?.cacheableUserPrefix
        ? [
            { type: 'text', text: options.cacheableUserPrefix, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: prompt },
          ]
        : [{ type: 'text', text: prompt }]

    // Modell-Capabilities (Stand 2026): 2026er-Modelle nutzen adaptives Thinking
    // (kein budget_tokens). Opus 4.7/4.8, Sonnet 5 und Fable/Mythos 5 lehnen
    // temperature/top_p/top_k UND budget_tokens mit 400 ab. effort gibt es ab
    // Opus 4.5 + Sonnet 4.6 + Sonnet 5, NICHT auf Haiku/Sonnet 4.5.
    const id = resolved.modelId
    const is2026Frontier = id.startsWith('claude-sonnet-5') || id.startsWith('claude-fable-5') || id.startsWith('claude-mythos-5')
    const adaptiveThinking = /claude-opus-4-[678]\b/.test(id) || id.startsWith('claude-sonnet-4-6') || is2026Frontier
    const supportsEffort = /claude-opus-4-[5678]\b/.test(id) || id.startsWith('claude-sonnet-4-6') || is2026Frontier
    const rejectsSampling = /claude-opus-4-[78]\b/.test(id) || is2026Frontier

    // SDK 0.71 typisiert adaptive/output_config noch nicht; die Felder werden zur
    // Laufzeit korrekt weitergereicht (gegen Production verifiziert), daher das `any`.
    const params: Record<string, unknown> = {
      model: id,
      max_tokens: tokenLimit,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    }
    if (options?.thinking) {
      if (adaptiveThinking) {
        params.thinking = { type: 'adaptive' }
        if (supportsEffort && options.effort) params.output_config = { effort: options.effort }
      } else {
        params.thinking = { type: 'enabled', budget_tokens: Math.min(4000, tokenLimit - 1024) }
      }
    } else if (options?.temperature !== undefined && !rejectsSampling) {
      params.temperature = options.temperature
    }

    // Thinking + große Requests streamen: vermeidet den 10-Minuten-Reject des SDK,
    // und die Schleife verwirft thinking_delta sauber (nur text_delta zählt).
    if (tokenLimit > 16384 || prompt.length > 30000 || options?.thinking) {
      let result = ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = anthropic.messages.stream(params as any)
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          result += event.delta.text
        }
      }
      return result
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = (await anthropic.messages.create(params as any)) as Anthropic.Message
    for (const block of response.content) {
      if (block.type === 'text') return block.text
    }
    return ''
  }

  if (resolved?.provider === 'openai') {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const fullPrompt = options?.cacheableUserPrefix
      ? `${options.cacheableUserPrefix}\n\n${prompt}`
      : prompt
    const response = await openai.chat.completions.create({
      model: resolved.modelId,
      max_tokens: tokenLimit,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fullPrompt },
      ],
    })
    return response.choices[0]?.message?.content || ''
  }

  // Fallback: Gemini Flash (gemini-2.0-flash was retired by Google → 404)
  const fallback = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
  })
  const fullPrompt = options?.cacheableUserPrefix
    ? `${options.cacheableUserPrefix}\n\n${prompt}`
    : prompt
  const result = await fallback.generateContent(fullPrompt)
  return result.response.text()
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumable building blocks (shared by the streaming runner and the job pipeline)
// ─────────────────────────────────────────────────────────────────────────────

export interface SectionContext {
  cacheableUserPrefix: string
  companiesPerItem: Map<string, { public: string[]; premarket: string[] }>
  metadataBlock: string
  loadedPatterns: LearnedPattern[]
}

/**
 * Builds the per-run context shared across every section call: edit-learning
 * patterns/examples, the company map, the cacheable user prefix and the
 * metadata block. Extracted from runGhostwriterPipeline so the resumable job
 * pipeline can rebuild the same context on a later cron tick.
 */
export async function buildSectionContext(
  items: PipelineItem[],
  plan: ArticlePlan,
  vocabularyContext: string | undefined,
): Promise<SectionContext> {
  // ── Edit Learning: Load patterns and examples ──────────────────────────────
  let editLearningContext = ''
  let loadedPatterns: LearnedPattern[] = []
  try {
    const [patterns, examples] = await Promise.all([
      getActiveLearnedPatterns(0.4, 20),
      findSimilarEditExamples(
        items.map(i => i.title).join(' ').slice(0, 2000), 3, 7
      ),
    ])
    loadedPatterns = patterns
    if (patterns.length > 0 || examples.length > 0) {
      const enhancement = buildPromptEnhancement(patterns, examples)
      if (enhancement) {
        editLearningContext = enhancement
        console.log(`[Pipeline] Edit learning: ${patterns.length} patterns, ${examples.length} examples`)
      }
    }
  } catch (err) {
    console.error('[Pipeline] Failed to load Edit Learning patterns:', err)
  }

  // ── Pre-extract relevant companies per item (avoids sending all 492 names per call) ──
  const companiesPerItem = new Map<string, { public: string[]; premarket: string[] }>()
  for (const item of items) {
    companiesPerItem.set(item.id, extractRelevantCompanies(`${item.title} ${item.content || ''}`))
  }

  // ── Build cacheable user prefix (shared across all section calls) ──
  // For Anthropic: cached after first call, 29 subsequent calls pay $1.88/M instead of $15/M
  const prefixParts: string[] = []
  if (vocabularyContext) prefixParts.push(vocabularyContext)
  if (editLearningContext) prefixParts.push(editLearningContext)
  prefixParts.push(`THEMATISCHER RAHMEN DES TAGES (nur grobe Orientierung, was die News lose verbindet — das ist NICHT die Konklusion deines Takes und darf NICHT als Schlusssatz oder Pointe wiederholt werden; dein Take hat seinen EIGENEN Blickwinkel und seine EIGENE Schlussfolgerung, siehe BLICKWINKEL im User-Prompt): ${plan.thesis}\n\nSchreibe GENAU DIESEN EINEN Abschnitt. Kein Intro, keine anderen News, kein Abschluss.`)
  const cacheableUserPrefix = prefixParts.join('\n\n')

  // Build metadata block (title/excerpt/category/intro)
  const excerptLines = plan.excerptBullets
    .map(b => (b.startsWith('•') ? b : `• ${b}`))
    .join('\n')
  const metadataBlock = `---\nTITLE: ${plan.articleTitle}\nEXCERPT:\n${excerptLines}\nCATEGORY: ${plan.category || 'AI & Tech'}\n---\n\n${plan.introParagraph}\n\n`

  return { cacheableUserPrefix, companiesPerItem, metadataBlock, loadedPatterns }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle dispatch: collapse each bundle_type group (topic/recap) into ONE write
// unit; every other item stays its own unit. Shared by both call sites so the
// streaming runner and the resumable job pipeline dispatch identically.
// ─────────────────────────────────────────────────────────────────────────────

export type BundleWriteUnit =
  | { kind: 'bundle'; bundleType: 'topic' | 'recap'; items: PipelineItem[]; heading: string; takeAngle?: string; retrievalHint?: string }
  | { kind: 'single'; item: PipelineItem; heading: string; takeAngle?: string; retrievalHint?: string }

/**
 * Groups `orderedItems` into write units by each item's `bundle_type`: all
 * `topic` items collapse into one bundle unit, all `recap` items into another,
 * and every untagged item becomes its own single unit. Order is always
 * topic-bundle → recap-bundle → normal singles (matches enforceBundleOrdering and
 * is robust even against a fallback plan that never ran the ordering enforcement).
 *
 * Heading/takeAngle/retrievalHint are resolved positionally against
 * `plan.ordering` (the existing invariant both call sites already rely on:
 * `orderedItems[pos]` corresponds to `plan.ordering[pos]`). Grouping keys off the
 * already-dereferenced `PipelineItem.bundle_type`, so it never indexes into
 * `items` and can't go out of bounds.
 */
export function buildBundleWriteUnits(orderedItems: PipelineItem[], plan: ArticlePlan): BundleWriteUnit[] {
  const positioned = orderedItems.map((item, pos) => {
    const key = String(plan.ordering?.[pos])
    return {
      item,
      heading: (plan.headings ?? {})[key] || item.title,
      takeAngle: (plan.takeAngles ?? {})[key] || undefined,
      retrievalHint: (plan.retrievalHints ?? {})[key] || undefined,
    }
  })
  const topic = positioned.filter((p) => p.item.bundle_type === 'topic')
  const recap = positioned.filter((p) => p.item.bundle_type === 'recap')
  const normal = positioned.filter((p) => p.item.bundle_type !== 'topic' && p.item.bundle_type !== 'recap')

  const units: BundleWriteUnit[] = []
  if (topic.length > 0) {
    units.push({ kind: 'bundle', bundleType: 'topic', items: topic.map((p) => p.item), heading: topic[0].heading, takeAngle: topic[0].takeAngle, retrievalHint: topic[0].retrievalHint })
  }
  if (recap.length > 0) {
    units.push({ kind: 'bundle', bundleType: 'recap', items: recap.map((p) => p.item), heading: recap[0].heading, takeAngle: recap[0].takeAngle, retrievalHint: recap[0].retrievalHint })
  }
  for (const p of normal) {
    units.push({ kind: 'single', item: p.item, heading: p.heading, takeAngle: p.takeAngle, retrievalHint: p.retrievalHint })
  }
  return units
}

/** Union of relevant companies across a bundle unit's items. */
function unionRelevantCompanies(
  items: PipelineItem[],
  companiesPerItem: Map<string, { public: string[]; premarket: string[] }>,
): { public: string[]; premarket: string[] } {
  const pub = new Set<string>()
  const pre = new Set<string>()
  for (const it of items) {
    const c = companiesPerItem.get(it.id) || { public: [], premarket: [] }
    c.public.forEach((x) => pub.add(x))
    c.premarket.forEach((x) => pre.add(x))
  }
  return { public: [...pub], premarket: [...pre] }
}

/** Writes one write unit — a bundle group (N sources → 1 section) or a single item. */
function writeUnit(
  unit: BundleWriteUnit,
  model: AIModel,
  companiesPerItem: Map<string, { public: string[]; premarket: string[] }>,
  shared: { cacheableUserPrefix: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; repoIntensity?: number },
): Promise<string> {
  if (unit.kind === 'bundle') {
    return writeBundleSection(unit.items, unit.bundleType, unit.heading, model, {
      relevantCompanies: unionRelevantCompanies(unit.items, companiesPerItem),
      cacheableUserPrefix: shared.cacheableUserPrefix,
      effort: shared.effort,
      takeAngle: unit.takeAngle,
      retrievalHint: unit.retrievalHint,
      repoIntensity: shared.repoIntensity,
    })
  }
  return writeSection(unit.item, unit.heading, model, {
    relevantCompanies: companiesPerItem.get(unit.item.id) || { public: [], premarket: [] },
    cacheableUserPrefix: shared.cacheableUserPrefix,
    effort: shared.effort,
    takeAngle: unit.takeAngle,
    retrievalHint: unit.retrievalHint,
    repoIntensity: shared.repoIntensity,
  })
}

export interface WriteBatchResult {
  sections: string[]   // NUR die in DIESEM Aufruf geschriebenen, in Reihenfolge
  nextCursor: number
  done: boolean
}

/**
 * Writes ordered sections starting at `cursor`, in batches of `concurrency` (6),
 * until the wall-clock budget (`budgetMs` since `startedAt`) is exhausted after a
 * completed batch. The remaining sections resume on the next cron tick. Used by
 * the resumable job pipeline; the streaming runner keeps its own progressive
 * worker loop.
 */
// Per-phase hard limits so a single resumable tick never approaches the 300s
// Vercel function cap (a batch waits for its slowest section via Promise.all).
const SECTION_WRITE_TIMEOUT_MS = 100_000     // hung/slow section → placeholder
const SECTION_PROOFREAD_TIMEOUT_MS = 45_000  // proofread is best-effort per section
const DEDUP_BUDGET_MS = 180_000              // whole-text dedup is best-effort

/** Resolves to the promise's value, or `fallback` if it doesn't settle within ms. */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms) })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function writeSectionsBatch(
  orderedItems: PipelineItem[],
  plan: ArticlePlan,
  ctx: SectionContext,
  cursor: number,
  model: AIModel,
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  budgetMs: number,
  startedAt: number,
  proofreadModel?: AIModel,
  onBatch?: (nextCursor: number, newSections: string[]) => Promise<void>,
  repoIntensity?: number,
): Promise<WriteBatchResult> {
  // Bundle groups collapse N items → 1 section, so we iterate WRITE UNITS, not
  // raw items. `cursor`/`nextCursor` are write-unit indices; units are rebuilt
  // deterministically from plan+items each tick, so resume stays consistent.
  const units = buildBundleWriteUnits(orderedItems, plan)
  const out: string[] = []
  let i = cursor
  const concurrency = 6
  while (i < units.length) {
    const batch = units.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(async (unit) => {
      const heading = unit.heading
      // Hard per-section timeout: one slow/hung section must not drag the whole
      // batch past the function limit (Job stalled at cursor=0 otherwise).
      let section = await withTimeout(
        writeUnit(unit, model, ctx.companiesPerItem, { cacheableUserPrefix: ctx.cacheableUserPrefix, effort, repoIntensity }),
        SECTION_WRITE_TIMEOUT_MS,
        `## ${heading}\n\n*Zeitüberschreitung beim Schreiben dieses Abschnitts.*\n`,
      ).catch(err => `## ${heading}\n\n*Fehler: ${err instanceof Error ? err.message : String(err)}*\n`)
      // Proofread per section (small, fast, resumable) instead of one giant
      // full-article proofread in finalize that blows the 300s limit.
      if (proofreadModel) {
        section = await withTimeout(proofreadText(section, proofreadModel), SECTION_PROOFREAD_TIMEOUT_MS, section)
          .catch(() => section)
      }
      return section
    }))
    out.push(...results.map(r => r + '\n\n'))
    i += batch.length
    // Persist progress after each batch so a parallel status poll shows live
    // section-by-section progress (and resume is batch-granular, not just per-tick).
    if (onBatch) { try { await onBatch(i, [...out]) } catch (err) { console.warn('[Pipeline] onBatch persist failed:', err) } }
    if (Date.now() - startedAt > budgetMs) break   // Budget erschöpft -> Rest im nächsten Tick
  }
  return { sections: out, nextCursor: i, done: i >= units.length }
}

/**
 * Assembles metadata + sections, proofreads, then de-duplicates metaphors.
 * ONLY for the resumable job path — the manual streaming flow keeps its own
 * proofread (in this file) and dedup (in queue-article.ts). Do NOT call this
 * from runGhostwriterPipeline or the dedup would run twice.
 */
export async function finalizeArticle(
  metadataBlock: string,
  sections: string[],
  model: AIModel,
  vocabulary: Array<{ term: string }> | null,
): Promise<string> {
  // Proofreading now happens per-section during the writing phase (resumable,
  // within budget). Finalize only de-duplicates metaphors — which needs a
  // whole-text view — and assembles. Dedup is best-effort with a hard timeout
  // so finalize can't exceed the 300s function limit on long articles; if it
  // doesn't finish in time we keep the (complete) un-deduped article.
  const body = sections.join('')
  let full = metadataBlock + body
  const duplicates = findDuplicateMetaphors(full, vocabulary || undefined)
  if (duplicates.size > 0) {
    const deduped = await withTimeout(
      (async () => {
        let d = ''
        for await (const chunk of streamMetaphorDeduplication(full, duplicates, model)) d += chunk
        return d
      })(),
      DEDUP_BUDGET_MS,
      '',
    ).catch(err => {
      console.error('[Pipeline] Metaphor dedup failed (keeping original):', err)
      return ''
    })
    if (deduped.trim()) full = deduped
    else console.warn('[Pipeline] Metaphor dedup skipped/timed out — keeping un-deduped article')
  }
  return full
}

// ─────────────────────────────────────────────────────────────────────────────
// Main pipeline runner (async generator for streaming progress)
// ─────────────────────────────────────────────────────────────────────────────

export async function* runGhostwriterPipeline(
  items: PipelineItem[],
  model: AIModel,
  options: { concurrency?: number; vocabularyContext?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; repoIntensity?: number } = {},
): AsyncGenerator<PipelineEvent | { type: 'section'; text: string } | { type: 'metadata'; text: string }> {
  // concurrency 6 (was 2): with up to 40 sections, Opus must finish within the
  // Vercel Pro 300s function limit (maxDuration=800 is capped to 300 by the plan).
  // 40 / 6 × ~30s ≈ 200s leaves headroom for planning + proofread before timeout.
  const { concurrency = 6, vocabularyContext, effort, repoIntensity } = options
  // ── Pass 1: Plan ────────────────────────────────────────────────────────────
  yield { type: 'planning', message: `Struktur für ${items.length} Items planen...` }

  let plan: ArticlePlan
  try {
    const planningModel = await getModelForUseCase('article_planning') as AIModel
    console.log(`[Pipeline] Planning model: ${planningModel}`)
    plan = await planArticle(items, planningModel)
  } catch (err) {
    console.error('[Pipeline] planArticle failed:', err)
    if (isCreditBalanceError(err)) {
      await recordCreditAlertIfApplicable(err)
      throw new CreditBalanceExhaustedError(err instanceof Error ? err.message : String(err))
    }
    // Fallback plan: sequential order, item titles as headings
    plan = {
      thesis: 'Aktuelle Tech-News und Marktanalyse',
      ordering: items.map((_, i) => i + 1),
      headings: Object.fromEntries(items.map((item, i) => [String(i + 1), item.title])),
      takeAngles: {},
      retrievalHints: {},
      articleTitle: 'Tech-Digest',
      excerptBullets: items.slice(0, 3).map(i => i.title.slice(0, 65)),
      category: 'AI & Tech',
      introParagraph: 'Die wichtigsten Tech-News der Woche im Überblick.',
    }
  }

  yield { type: 'planned', itemCount: items.length }

  // ── Build shared section context (edit-learning, companies, prefix, metadata) ──
  const { cacheableUserPrefix, companiesPerItem, metadataBlock, loadedPatterns } =
    await buildSectionContext(items, plan, vocabularyContext)

  // Emit metadata block immediately so client can show title/excerpt
  yield { type: 'metadata', text: metadataBlock }

  // ── Pass 2: Write sections in parallel ──────────────────────────────────────
  const orderedItems = plan.ordering.map(idx => items[idx - 1]).filter(Boolean)
  // Bundle groups collapse N items → 1 section, so we schedule WRITE UNITS: the
  // topic group and the recap group each become one writeBundleSection call, every
  // untagged item stays a normal writeSection.
  const units = buildBundleWriteUnits(orderedItems, plan)
  let writtenCount = 0

  // Use a results array and a "notify" mechanism so we can yield sections as
  // soon as they arrive in order (real progressive streaming)
  const results: Array<string | undefined> = new Array(units.length)
  const resolvers: Array<() => void> = []
  const waitFor = (i: number) =>
    results[i] !== undefined
      ? Promise.resolve()
      : new Promise<void>(r => {
          resolvers[i] = r
        })

  // Start bounded-parallel tasks
  let cursor = 0
  let creditExhausted = false
  const workers = Array.from({ length: Math.min(concurrency, units.length) }, async () => {
    while (cursor < units.length) {
      const i = cursor++
      const unit = units[i]
      const heading = unit.heading

      if (creditExhausted) {
        results[i] = `## ${heading}\n\n*Abgebrochen: AI-Credit-Guthaben aufgebraucht.*\n`
        writtenCount++
        resolvers[i]?.()
        continue
      }

      try {
        results[i] = await writeUnit(unit, model, companiesPerItem, { cacheableUserPrefix, effort, repoIntensity })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[Pipeline] writeSection ${i + 1} failed:`, errMsg)
        if (isCreditBalanceError(err) && !creditExhausted) {
          creditExhausted = true
          cursor = units.length // stop scheduling
          await recordCreditAlertIfApplicable(err)
        }
        results[i] = `## ${heading}\n\n*Fehler: ${errMsg}*\n`
      }
      writtenCount++
      resolvers[i]?.()
    }
  })

  // Yield sections in order as they become available
  const workersPromise = Promise.all(workers)
  for (let i = 0; i < units.length; i++) {
    await waitFor(i)
    const unit = units[i]
    const title = unit.kind === 'single' ? unit.item.title : unit.heading
    yield { type: 'writing', current: i + 1, total: units.length, title }
    yield { type: 'section', text: results[i]! + '\n\n' }
    yield { type: 'written', current: i + 1, total: units.length }
  }
  await workersPromise

  // Track pattern usage after generation
  if (loadedPatterns.length > 0) {
    trackPatternUsage(loadedPatterns.map(p => p.id)).catch(err => {
      console.error('[Pipeline] Failed to track pattern usage:', err)
    })
  }

  yield { type: 'assembling' }

  // ── Post-Processing: German Proofreading ────────────────────────────────────
  const fullText = results.filter(Boolean).join('\n\n')
  yield { type: 'proofreading', message: 'Rechtschreib- und Grammatikprüfung...' }

  try {
    const proofreadingModel = await getModelForUseCase('proofreading') as AIModel
    console.log(`[Pipeline] Proofreading model: ${proofreadingModel}`)
    const corrected = await proofreadText(fullText, proofreadingModel)
    yield { type: 'proofread', text: corrected }
  } catch (err) {
    console.error('[Pipeline] Proofreading failed:', err)
    // Bei Fehler: Originaltext beibehalten (proofread event wird nicht gesendet)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// German proofreading
// ─────────────────────────────────────────────────────────────────────────────

const PROOFREADING_PROMPT = `Du bist ein professioneller deutscher Lektor UND Anti-LLM-Stilwächter. Korrigiere Fehler und schreibe die unten gelisteten AI-Tells um — sonst nichts.

KORRIGIEREN:
1. Alle deutschen Rechtschreib- und Grammatikfehler.
2. Falsche Kommasetzung und Zeichensetzung.

AI-TELLS UMSCHREIBEN (nur diese, minimal-invasiv, Aussage erhalten — NICHT den ganzen Text neu schreiben):
3. Kontrast-/Negations-Reframe: "Das ist kein X, sondern Y", "nicht X, sondern Y", "X ist nicht Y, sondern Z", "weniger X, mehr Y", "Was wie X aussieht, ist Y", "nicht mehr X, sondern Y". → Negation streichen, Y direkt als Aussage ausschreiben. Bsp.: "entscheidet sich nicht an der Spitze, sondern am unscheinbarsten Ende" → "entscheidet sich am unscheinbarsten Ende der Wertschöpfung."
4. Em-Dashes (— oder –) als Satzteiler → Punkt, Komma, Doppelpunkt, Semikolon oder Klammer.
5. Hohler Schluss-Aphorismus: ein letzter Satz, der wie ein tiefsinniges Motto klingt, aber nichts Konkretes sagt (z.B. "Die Resilienz einer Lieferkette misst man am schwächsten Molekül"). → Durch eine konkrete Aussage mit Fakt oder Konsequenz ersetzen, oder streichen, falls der vorletzte Satz stärker schließt.
6. Rule-of-three-Aufzählungen und leere Verstärker-Adverbien ("exakt", "buchstäblich", "letztendlich", "tatsächlich") straffen, wenn sie nichts hinzufügen.
7. "Wer …"-Schlussfigur in Synthszr Takes: Beginnt der letzte oder vorletzte Satz eines Takes mit "Wer" ("Wer jetzt noch …", "Wer heute …", "Wer sein X für Y hält, …", "Wer X baut/plant, sollte …"), forme ihn in eine direkte Aussage um — die Konsequenz als Statement ohne "Wer"-Rahmen (aus "Wer heute noch auf X setzt, verliert Y" wird "X kostet ab jetzt Y."). Diese Belehr-Formel stand in über der Hälfte aller Takes am Schluss; pro Artikel darf sie höchstens EINMAL überleben, und nur wenn die Umformung die Aussage verfälschen würde.

NICHT VERÄNDERN:
8. Englische Fachbegriffe (Token, Reasoning, API, Fine-Tuning, Open Source, Benchmark, Model, Inference, Training) NICHT eindeutschen. Firmen-, Produkt- und Eigennamen unverändert lassen.
9. Markdown-Formatierung (##, **, {Company}, →, Synthszr Take:) unverändert lassen.
10. Ansonsten Stil, Ton, Argument und Inhalt LASSEN — greife nur die oben gelisteten Tells an.

Gib NUR den korrigierten Text zurück, keine Erklärungen oder Kommentare.`

export async function proofreadText(text: string, model: AIModel): Promise<string> {
  const corrected = await callModelNonStreaming(
    text,
    PROOFREADING_PROMPT,
    model,
    // 64000 = Haiku-4.5 Output-Cap. 32000 reichte für lange manuelle Artikel
    // NICHT — der korrigierte Output wurde mitten im Satz abgeschnitten und
    // ersetzte den vollständigen Artikel (der Aufrufer prüft zusätzlich via
    // isLikelyTruncated). Streamt (Bedingung > 16384). temperature niedrig,
    // weil Korrektur deterministisch sein soll, nicht kreativ.
    { maxTokens: 64000, temperature: 0.1 },
  )
  return corrected.trim()
}
